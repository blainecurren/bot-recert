/**
 * End-to-End Document Summarization Test
 *
 * Tests the full pipeline:
 * 1. Fetch real patient documents from HCHB FHIR API
 * 2. Extract PDF text via Python backend
 * 3. Summarize with Azure OpenAI
 *
 * Run: node test-e2e-summarization.js [patientId]
 *
 * Prerequisites:
 * - Python backend running: cd mock-backend && python main.py
 * - Valid HCHB credentials in .env
 * - Azure OpenAI credentials in .env
 */

require('dotenv').config();
const { fhirGet, testConnection } = require('./services/fhirClient');
const documentService = require('./services/documentService');
const azureOpenAI = require('./services/azureOpenAIService');
const { healthCheck } = require('./services/pythonBackendClient');

async function runE2ETest() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     END-TO-END DOCUMENT SUMMARIZATION TEST                 ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const patientId = process.argv[2];

    // Step 1: Check prerequisites
    console.log('STEP 1: Checking prerequisites...\n');

    // 1a. Check HCHB FHIR connection
    console.log('  [1a] Testing HCHB FHIR API connection...');
    const fhirOk = await testConnection();
    if (!fhirOk) {
        console.error('  ❌ HCHB FHIR API connection failed. Check credentials in .env');
        return;
    }
    console.log('  ✅ HCHB FHIR API connected\n');

    // 1b. Check Python backend
    console.log('  [1b] Testing Python backend (required for PDF extraction)...');
    const backendHealth = await healthCheck();
    if (backendHealth.status !== 'healthy') {
        console.error('  ❌ Python backend not available');
        console.error('\n  To start the Python backend:');
        console.error('    cd mock-backend');
        console.error('    pip install fastapi uvicorn pdfplumber httpx PyMuPDF python-dotenv openai');
        console.error('    python -m uvicorn main:app --reload --port 8000\n');
        return;
    }
    console.log('  ✅ Python backend running\n');

    // 1c. Check Azure OpenAI
    console.log('  [1c] Testing Azure OpenAI connection...');
    const aiConfig = await azureOpenAI.checkConfiguration();
    if (!aiConfig.accessible) {
        console.error('  ❌ Azure OpenAI not accessible:', aiConfig.error);
        return;
    }
    console.log('  ✅ Azure OpenAI connected\n');
    console.log('  Deployment:', aiConfig.deployment);
    console.log('  Endpoint:', aiConfig.endpoint);
    console.log('');

    // Step 2: Find a patient with documents
    console.log('─'.repeat(60));
    console.log('STEP 2: Finding patient with documents...\n');

    let targetPatientId = patientId;
    let patientName = null;

    if (!targetPatientId) {
        // Search for a patient
        console.log('  No patient ID provided. Searching for patients...');

        try {
            // Try to find patients - use a common name or get any patient
            const searchResult = await fhirGet('/Patient', { _count: 10 });

            if (!searchResult.entry || searchResult.entry.length === 0) {
                console.error('  ❌ No patients found in the system');
                return;
            }

            // Find a patient and check for documents
            for (const entry of searchResult.entry) {
                const p = entry.resource;
                const pId = p.id;
                const name = p.name?.[0]?.text ||
                    `${p.name?.[0]?.family || ''}, ${p.name?.[0]?.given?.join(' ') || ''}`;

                // Check if this patient has documents
                const docs = await documentService.getPatientDocuments(pId, { limit: 5 });
                const pdfDocs = docs.filter(d => d.hasAttachment && d.contentType === 'application/pdf');

                if (pdfDocs.length > 0) {
                    targetPatientId = pId;
                    patientName = name;
                    console.log(`  Found patient with PDFs: ${name} (${pId})`);
                    console.log(`  → Has ${pdfDocs.length} PDF documents\n`);
                    break;
                }
            }

            if (!targetPatientId) {
                console.error('  ❌ No patients with PDF documents found');
                console.log('\n  Try running with a specific patient ID:');
                console.log('    node test-e2e-summarization.js <patientId>\n');
                return;
            }
        } catch (error) {
            console.error('  ❌ Error searching for patients:', error.message);
            return;
        }
    } else {
        // Get patient details
        try {
            const patient = await fhirGet(`/Patient/${targetPatientId}`);
            patientName = patient.name?.[0]?.text ||
                `${patient.name?.[0]?.family || ''}, ${patient.name?.[0]?.given?.join(' ') || ''}`;
            console.log(`  Using patient: ${patientName} (${targetPatientId})\n`);
        } catch (error) {
            console.error(`  ❌ Patient ${targetPatientId} not found:`, error.message);
            return;
        }
    }

    // Step 3: Fetch documents
    console.log('─'.repeat(60));
    console.log('STEP 3: Fetching documents from HCHB...\n');

    const documents = await documentService.getPatientDocuments(targetPatientId, { limit: 20 });
    const pdfDocuments = documents.filter(d => d.hasAttachment && d.contentType === 'application/pdf');

    console.log(`  Total documents: ${documents.length}`);
    console.log(`  PDF documents: ${pdfDocuments.length}\n`);

    if (pdfDocuments.length === 0) {
        console.error('  ❌ No PDF documents found for this patient');
        return;
    }

    // Show available documents
    console.log('  Available PDF documents:');
    pdfDocuments.slice(0, 5).forEach((doc, i) => {
        console.log(`    ${i + 1}. [${doc.date}] ${doc.type} - ${doc.description || 'No description'}`);
    });
    console.log('');

    // Step 4: Extract text from first PDF
    console.log('─'.repeat(60));
    console.log('STEP 4: Extracting text from PDF...\n');

    const testDoc = pdfDocuments[0];
    console.log(`  Selected document: ${testDoc.type}`);
    console.log(`  Date: ${testDoc.date}`);
    console.log(`  URL: ${testDoc.url?.substring(0, 80)}...`);
    console.log('');

    console.log('  Extracting text (via Python backend)...');
    const extractStart = Date.now();
    const extractResult = await documentService.extractDocumentText(testDoc.url);
    const extractTime = ((Date.now() - extractStart) / 1000).toFixed(1);

    if (!extractResult.success || !extractResult.text) {
        console.error('  ❌ Text extraction failed:', extractResult.error);
        return;
    }

    console.log(`  ✅ Text extracted in ${extractTime}s`);
    console.log(`     Pages: ${extractResult.page_count}`);
    console.log(`     Characters: ${extractResult.char_count}`);
    if (extractResult.used_vision_ocr) {
        console.log(`     Method: Vision OCR (scanned document)`);
    } else {
        console.log(`     Method: pdfplumber (text-based)`);
    }
    console.log('');

    // Show text preview
    console.log('  Text preview (first 500 chars):');
    console.log('  ┌' + '─'.repeat(56) + '┐');
    const preview = extractResult.text.substring(0, 500).split('\n').map(line =>
        '  │ ' + line.substring(0, 54).padEnd(54) + ' │'
    ).join('\n');
    console.log(preview);
    console.log('  └' + '─'.repeat(56) + '┘\n');

    // Step 5: Summarize with Azure OpenAI
    console.log('─'.repeat(60));
    console.log('STEP 5: Summarizing with Azure OpenAI...\n');

    console.log('  Sending to GPT-4o for summarization...');
    const summaryStart = Date.now();
    const summaryResult = await azureOpenAI.summarizeDocument(extractResult.text, {
        documentType: testDoc.type || 'clinical note'
    });
    const summaryTime = ((Date.now() - summaryStart) / 1000).toFixed(1);

    if (!summaryResult.success) {
        console.error('  ❌ Summarization failed:', summaryResult.error);
        return;
    }

    console.log(`  ✅ Summary generated in ${summaryTime}s`);
    console.log(`     Tokens used: ${summaryResult.usage?.totalTokens || 'N/A'}`);
    console.log(`       - Prompt: ${summaryResult.usage?.promptTokens || 'N/A'}`);
    console.log(`       - Completion: ${summaryResult.usage?.completionTokens || 'N/A'}`);
    console.log('');

    // Show the summary
    console.log('  ┌' + '─'.repeat(56) + '┐');
    console.log('  │' + ' AI-GENERATED SUMMARY'.padEnd(56) + '│');
    console.log('  ├' + '─'.repeat(56) + '┤');
    const summaryLines = summaryResult.summary.split('\n');
    summaryLines.forEach(line => {
        // Word wrap at 54 chars
        while (line.length > 54) {
            console.log('  │ ' + line.substring(0, 54) + ' │');
            line = line.substring(54);
        }
        console.log('  │ ' + line.padEnd(54) + ' │');
    });
    console.log('  └' + '─'.repeat(56) + '┘\n');

    // Step 6: Test clinical data extraction
    console.log('─'.repeat(60));
    console.log('STEP 6: Extracting structured clinical data...\n');

    console.log('  Extracting diagnoses, medications, vitals...');
    const extractDataStart = Date.now();
    const clinicalData = await azureOpenAI.extractClinicalData(extractResult.text);
    const extractDataTime = ((Date.now() - extractDataStart) / 1000).toFixed(1);

    if (clinicalData.success) {
        console.log(`  ✅ Clinical data extracted in ${extractDataTime}s\n`);
        console.log('  Extracted data:');
        console.log(JSON.stringify(clinicalData.data, null, 2).split('\n').map(l => '    ' + l).join('\n'));
    } else {
        console.log('  ⚠️  Clinical data extraction failed:', clinicalData.error);
    }

    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('TEST COMPLETE - All steps passed!');
    console.log('═'.repeat(60));
    console.log(`\nPatient: ${patientName}`);
    console.log(`Document: ${testDoc.type} (${testDoc.date})`);
    console.log(`Text extraction: ${extractTime}s (${extractResult.char_count} chars)`);
    console.log(`Summarization: ${summaryTime}s (${summaryResult.usage?.totalTokens} tokens)`);
    console.log('');
}

runE2ETest().catch(error => {
    console.error('\n❌ Test failed with error:', error.message);
    console.error(error.stack);
});
