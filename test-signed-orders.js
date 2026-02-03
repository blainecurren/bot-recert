/**
 * Test SIGNED ORDERS document extraction and summarization
 */
require('dotenv').config();
const { fhirGet, getAccessToken } = require('./services/fhirClient');
const { client: pythonBackend } = require('./services/pythonBackendClient');
const azureOpenAI = require('./services/azureOpenAIService');

async function test() {
    console.log('Testing with SIGNED ORDERS document...\n');

    // Get documents for YARBRO, PENNY
    const r = await fhirGet('/DocumentReference', {
        subject: 'Patient/mrbrz4jfq',
        _count: 50,
        _sort: '-date'
    });

    // Find SIGNED ORDERS with PDF
    const signedOrders = (r.entry || []).find(e => {
        const d = e.resource;
        const type = d.type?.text || d.type?.coding?.[0]?.display || '';
        const att = d.content?.[0]?.attachment;
        return type === 'SIGNED ORDERS' && att?.url && att?.contentType === 'application/pdf';
    });

    if (!signedOrders) {
        console.log('No SIGNED ORDERS PDF found');
        return;
    }

    const d = signedOrders.resource;
    const att = d.content[0].attachment;
    console.log('Found: SIGNED ORDERS');
    console.log('Date:', d.date?.split('T')[0]);
    console.log('URL:', att.url.substring(0, 60) + '...\n');

    // Extract text
    console.log('Extracting text via Python backend...');
    const token = await getAccessToken();
    const response = await pythonBackend.post('/documents/extract-text', {
        url: att.url,
        token: token
    });

    const result = response.data;
    console.log('Success:', result.success);
    console.log('Pages:', result.page_count);
    console.log('Characters:', result.char_count);
    console.log('Used Vision OCR:', result.used_vision_ocr);

    if (!result.text || result.text.length === 0) {
        console.log('\n❌ No text extracted');
        return;
    }

    console.log('\n--- TEXT PREVIEW (first 500 chars) ---');
    console.log(result.text.substring(0, 500));
    console.log('--- END PREVIEW ---\n');

    // Summarize with Azure OpenAI
    console.log('Sending to Azure OpenAI for summarization...');
    const summary = await azureOpenAI.summarizeDocument(result.text, {
        documentType: 'SIGNED ORDERS',
        maxTokens: 1000
    });

    if (summary.success) {
        console.log('\n✅ SUMMARY GENERATED');
        console.log('Tokens used:', summary.usage?.totalTokens);
        console.log('\n' + '='.repeat(50));
        console.log('AI SUMMARY:');
        console.log('='.repeat(50));
        console.log(summary.summary);
    } else {
        console.log('\n❌ Summarization failed:', summary.error);
    }
}

test().catch(err => {
    console.error('Error:', err.message);
});
