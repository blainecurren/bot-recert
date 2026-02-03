/**
 * Test Document Flow - End to End
 *
 * This script tests the complete document summarization pipeline:
 * 1. Fetch documents from HCHB FHIR API
 * 2. Extract PDF text via Python backend
 * 3. Send to Azure OpenAI for summarization
 * 4. Return summary to console
 *
 * Run: node test-document-flow.js [patientId]
 */

require('dotenv').config();

const { fhirGet, testConnection } = require('./services/fhirClient');
const { client: pythonBackend, healthCheck } = require('./services/pythonBackendClient');
const azureOpenAI = require('./services/azureOpenAIService');

// Helper to get access token for PDF download
const { getAccessToken } = require('./services/fhirClient');

async function testDocumentFlow() {
    const patientId = process.argv[2] || 'omblx25bw'; // Default to ROY DAVOULT

    console.log('='.repeat(60));
    console.log('DOCUMENT FLOW TEST');
    console.log('='.repeat(60));
    console.log(`Patient ID: ${patientId}\n`);

    // STEP 1: Test connections
    console.log('STEP 1: Testing connections...');

    console.log('  [1a] FHIR API...');
    const fhirOk = await testConnection();
    if (!fhirOk) {
        console.error('  ❌ FHIR connection failed');
        return;
    }
    console.log('  ✅ FHIR connected\n');

    console.log('  [1b] Python backend...');
    const backendHealth = await healthCheck();
    if (backendHealth.status !== 'healthy') {
        console.error('  ❌ Python backend not running');
        console.error('  Start it with: cd mock-backend && python -m uvicorn main:app --port 8000');
        return;
    }
    console.log('  ✅ Python backend running\n');

    console.log('  [1c] Azure OpenAI...');
    const aiConfig = await azureOpenAI.checkConfiguration();
    if (!aiConfig.accessible) {
        console.error('  ❌ Azure OpenAI not accessible:', aiConfig.error);
        return;
    }
    console.log('  ✅ Azure OpenAI connected');
    console.log(`     Deployment: ${aiConfig.deployment}\n`);

    // STEP 2: Fetch documents from FHIR
    console.log('-'.repeat(60));
    console.log('STEP 2: Fetching documents from FHIR...\n');

    const bundle = await fhirGet('/DocumentReference', {
        subject: `Patient/${patientId}`,
        _count: 50,
        _sort: '-date'
    });

    const allDocs = bundle.entry || [];
    console.log(`  Total documents: ${allDocs.length}`);

    // Find documents with PDF attachments
    const pdfDocs = allDocs.filter(e => {
        const att = e.resource.content?.[0]?.attachment;
        return att?.url && att?.contentType === 'application/pdf';
    });

    console.log(`  Documents with PDFs: ${pdfDocs.length}\n`);

    if (pdfDocs.length === 0) {
        console.log('  ❌ No PDF documents found for this patient');
        return;
    }

    // Show available PDFs
    console.log('  Available PDFs:');
    pdfDocs.slice(0, 10).forEach((e, i) => {
        const d = e.resource;
        const type = d.type?.text || d.type?.coding?.[0]?.display || 'Unknown';
        const date = d.date ? d.date.split('T')[0] : 'N/A';
        console.log(`    ${i + 1}. [${date}] ${type}`);
    });
    console.log('');

    // STEP 3: Select first PDF and extract text
    console.log('-'.repeat(60));
    console.log('STEP 3: Extracting text from first PDF...\n');

    const testDoc = pdfDocs[0].resource;
    const attachment = testDoc.content[0].attachment;
    const docType = testDoc.type?.text || testDoc.type?.coding?.[0]?.display || 'Document';
    const docDate = testDoc.date ? testDoc.date.split('T')[0] : 'N/A';

    console.log(`  Selected: ${docType} (${docDate})`);
    console.log(`  URL: ${attachment.url.substring(0, 60)}...`);
    console.log(`  Content-Type: ${attachment.contentType}\n`);

    // Get access token for PDF download
    const token = await getAccessToken();
    console.log('  Got FHIR access token\n');

    // Call Python backend to extract text
    console.log('  Calling Python backend for text extraction...');
    const startExtract = Date.now();

    let extractResult;
    try {
        const response = await pythonBackend.post('/documents/extract-text', {
            url: attachment.url,
            token: token
        });
        extractResult = response.data;
    } catch (error) {
        console.error('  ❌ Text extraction failed:', error.response?.data?.detail || error.message);
        return;
    }

    const extractTime = ((Date.now() - startExtract) / 1000).toFixed(1);

    if (!extractResult.success || !extractResult.text) {
        console.error('  ❌ No text extracted');
        console.error('  Result:', extractResult);
        return;
    }

    console.log(`  ✅ Text extracted in ${extractTime}s`);
    console.log(`     Pages: ${extractResult.page_count}`);
    console.log(`     Characters: ${extractResult.char_count}`);
    console.log(`     Method: ${extractResult.used_vision_ocr ? 'Vision OCR' : 'pdfplumber'}\n`);

    // Show text preview
    console.log('  Text preview (first 300 chars):');
    console.log('  ' + '-'.repeat(50));
    const preview = extractResult.text.substring(0, 300).replace(/\n/g, '\n  ');
    console.log('  ' + preview);
    console.log('  ' + '-'.repeat(50) + '\n');

    // STEP 4: Send to Azure OpenAI for summarization
    console.log('-'.repeat(60));
    console.log('STEP 4: Sending to Azure OpenAI for summarization...\n');

    const startSummary = Date.now();
    const summaryResult = await azureOpenAI.summarizeDocument(extractResult.text, {
        documentType: docType,
        maxTokens: 1000
    });
    const summaryTime = ((Date.now() - startSummary) / 1000).toFixed(1);

    if (!summaryResult.success) {
        console.error('  ❌ Summarization failed:', summaryResult.error);
        return;
    }

    console.log(`  ✅ Summary generated in ${summaryTime}s`);
    console.log(`     Tokens: ${summaryResult.usage?.totalTokens || 'N/A'}`);
    console.log(`       - Prompt: ${summaryResult.usage?.promptTokens || 'N/A'}`);
    console.log(`       - Completion: ${summaryResult.usage?.completionTokens || 'N/A'}\n`);

    // STEP 5: Display the summary
    console.log('-'.repeat(60));
    console.log('STEP 5: AI SUMMARY');
    console.log('-'.repeat(60));
    console.log('');
    console.log(summaryResult.summary);
    console.log('');

    // Summary
    console.log('='.repeat(60));
    console.log('TEST COMPLETE');
    console.log('='.repeat(60));
    console.log(`Document: ${docType} (${docDate})`);
    console.log(`Extraction: ${extractTime}s, ${extractResult.char_count} chars`);
    console.log(`Summarization: ${summaryTime}s, ${summaryResult.usage?.totalTokens} tokens`);
}

testDocumentFlow().catch(err => {
    console.error('\n❌ Test failed:', err.message);
    console.error(err.stack);
});
