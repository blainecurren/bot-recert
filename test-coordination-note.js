/**
 * Test Coordination Note Summarization
 *
 * Tests the full pipeline for worker xocgql9s1:
 * 1. Get patients for the worker
 * 2. Fetch coordination notes for first patient
 * 3. Extract PDF text
 * 4. Summarize with Azure OpenAI
 */

require('dotenv').config();

const fhirService = require('./services/fhirService');
const patientService = require('./services/patientService');
const documentService = require('./services/documentService');
const azureOpenAI = require('./services/azureOpenAIService');
const { healthCheck } = require('./services/pythonBackendClient');
const { testConnection } = require('./services/fhirClient');

const WORKER_ID = 'xocgql9s1';

async function runTest() {
    console.log('='.repeat(70));
    console.log('COORDINATION NOTE SUMMARIZATION TEST');
    console.log('='.repeat(70));
    console.log(`Worker ID: ${WORKER_ID}\n`);

    // Step 1: Check services
    console.log('STEP 1: Checking services...\n');

    const fhirOk = await testConnection();
    if (!fhirOk) {
        console.error('  ❌ FHIR API not available');
        return;
    }
    console.log('  ✅ FHIR API connected');

    const backendHealth = await healthCheck();
    if (backendHealth.status !== 'healthy') {
        console.error('  ❌ PDF service not running');
        return;
    }
    console.log('  ✅ PDF service running');
    console.log(`     Vision OCR: ${backendHealth.vision_ocr_available ? 'available' : 'not configured'}`);

    const aiConfig = await azureOpenAI.checkConfiguration();
    if (!aiConfig.accessible) {
        console.error('  ❌ Azure OpenAI not accessible:', aiConfig.error);
        return;
    }
    console.log('  ✅ Azure OpenAI connected\n');

    // Step 2: Get patients for worker
    console.log('-'.repeat(70));
    console.log('STEP 2: Getting patients for worker...\n');

    const today = new Date().toISOString().split('T')[0];
    const patients = await patientService.getPatientsByWorkerAndDate(WORKER_ID, today);

    if (!patients || patients.length === 0) {
        console.error('  ❌ No patients found for this worker');
        return;
    }

    console.log(`  Found ${patients.length} patient(s):`);
    patients.slice(0, 5).forEach((p, i) => {
        console.log(`    ${i + 1}. ${p.fullName || p.name} (ID: ${p.id})`);
    });
    console.log('');

    // Step 3: Get any documents with PDFs
    console.log('-'.repeat(70));
    console.log('STEP 3: Finding documents with PDFs...\n');

    const { fhirGet } = require('./services/fhirClient');

    let selectedPatient = null;
    let selectedDoc = null;

    for (let i = 0; i < Math.min(patients.length, 3); i++) {
        const patient = patients[i];
        console.log(`  Checking ${patient.fullName || patient.name}...`);

        // Get ALL documents for this patient
        const bundle = await fhirGet('/DocumentReference', {
            subject: `Patient/${patient.id}`,
            _count: 20
        });

        if (!bundle.entry || bundle.entry.length === 0) {
            console.log(`    No documents found`);
            continue;
        }

        // Find a PDF document (prefer clinical docs over signature forms)
        const skipTypes = ['SIGNATURE FORMS', 'BILLING DOCUMENTS', 'SIGNED ORDERS'];
        const preferredTypes = ['H&P', 'DOCUMENTATION', 'FACE-TO-FACE', 'ER/HOSPITALIZATION'];

        // First pass: look for preferred clinical types
        for (const entry of bundle.entry) {
            const doc = entry.resource;
            const docType = doc.type?.text || doc.type?.coding?.[0]?.display || 'Document';
            const attachment = doc.content?.[0]?.attachment;

            if (attachment?.url && attachment?.contentType === 'application/pdf' && preferredTypes.includes(docType)) {
                selectedPatient = patient;
                selectedDoc = {
                    id: doc.id,
                    type: docType,
                    date: doc.date ? doc.date.split('T')[0] : 'N/A',
                    description: doc.description || docType,
                    url: attachment.url,
                    contentType: attachment.contentType,
                    hasAttachment: true
                };
                console.log(`    ✅ Found clinical PDF: ${selectedDoc.type} (${selectedDoc.date})`);
                break;
            }
        }

        // Second pass: any PDF except skip types
        if (!selectedDoc) {
            for (const entry of bundle.entry) {
                const doc = entry.resource;
                const docType = doc.type?.text || doc.type?.coding?.[0]?.display || 'Document';
                const attachment = doc.content?.[0]?.attachment;

                if (attachment?.url && attachment?.contentType === 'application/pdf' && !skipTypes.includes(docType)) {
                    selectedPatient = patient;
                    selectedDoc = {
                        id: doc.id,
                        type: docType,
                        date: doc.date ? doc.date.split('T')[0] : 'N/A',
                        description: doc.description || docType,
                        url: attachment.url,
                        contentType: attachment.contentType,
                        hasAttachment: true
                    };
                    console.log(`    ✅ Found PDF: ${selectedDoc.type} (${selectedDoc.date})`);
                    break;
                }
            }
        }

        if (selectedDoc) break;
        console.log(`    No PDF documents found`);
    }

    if (!selectedPatient || !selectedDoc) {
        console.error('\n  ❌ No documents with PDFs found for any patient');
        return;
    }

    console.log('');
    await processNote(selectedPatient, selectedDoc);
}

async function processNote(patient, note) {
    console.log('-'.repeat(70));
    console.log('STEP 4: Extracting text from PDF...\n');

    console.log(`  Document: ${note.description || note.type}`);
    console.log(`  Date: ${note.date}`);
    console.log(`  URL: ${note.url.substring(0, 70)}...`);
    console.log('');

    const startExtract = Date.now();
    const extractResult = await documentService.extractDocumentText(note.url);
    const extractTime = ((Date.now() - startExtract) / 1000).toFixed(1);

    if (!extractResult.success || !extractResult.text) {
        console.error('  ❌ Text extraction failed:', extractResult.error);
        return;
    }

    console.log(`  ✅ Text extracted in ${extractTime}s`);
    console.log(`     Pages: ${extractResult.page_count}`);
    console.log(`     Characters: ${extractResult.char_count}`);
    console.log(`     Method: ${extractResult.used_vision_ocr ? 'Vision OCR' : 'pdfplumber'}`);
    console.log('');

    // Show text preview
    console.log('  --- Text Preview (first 500 chars) ---');
    console.log(extractResult.text.substring(0, 500));
    console.log('  --- End Preview ---\n');

    // Step 5: Summarize with Azure OpenAI
    console.log('-'.repeat(70));
    console.log('STEP 5: Summarizing with Azure OpenAI...\n');

    const startSummary = Date.now();
    const summaryResult = await azureOpenAI.summarizeDocument(extractResult.text, {
        documentType: 'Coordination Note',
        maxTokens: 1000
    });
    const summaryTime = ((Date.now() - startSummary) / 1000).toFixed(1);

    if (!summaryResult.success) {
        console.error('  ❌ Summarization failed:', summaryResult.error);
        return;
    }

    console.log(`  ✅ Summary generated in ${summaryTime}s`);
    console.log(`     Tokens: ${summaryResult.usage?.totalTokens || 'N/A'}`);
    console.log('');

    // Show the summary
    console.log('='.repeat(70));
    console.log('AI SUMMARY');
    console.log('='.repeat(70));
    console.log('');
    console.log(summaryResult.summary);
    console.log('');
    console.log('='.repeat(70));
    console.log('TEST COMPLETE');
    console.log('='.repeat(70));
    console.log(`Patient: ${patient.fullName || patient.name}`);
    console.log(`Document: ${note.type} (${note.date})`);
    console.log(`Extraction: ${extractTime}s (${extractResult.char_count} chars, ${extractResult.used_vision_ocr ? 'Vision OCR' : 'pdfplumber'})`);
    console.log(`Summary: ${summaryTime}s (${summaryResult.usage?.totalTokens} tokens)`);
}

runTest().catch(err => {
    console.error('\n❌ Test failed:', err.message);
    console.error(err.stack);
});
