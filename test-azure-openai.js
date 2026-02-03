/**
 * Test Azure OpenAI Integration
 * Run: node test-azure-openai.js
 */

require('dotenv').config();
const azureOpenAI = require('./services/azureOpenAIService');

async function runTests() {
    console.log('=== Azure OpenAI Integration Test ===\n');

    // Test 1: Check configuration
    console.log('1. Checking configuration...');
    const config = await azureOpenAI.checkConfiguration();
    console.log('   Configuration status:', config);

    if (!config.configured) {
        console.error('\n❌ Azure OpenAI not configured. Add these to your .env file:');
        console.error('   AZURE_OPENAI_ENDPOINT=https://YOUR-RESOURCE.openai.azure.com/');
        console.error('   AZURE_OPENAI_API_KEY=your-api-key');
        console.error('   AZURE_OPENAI_DEPLOYMENT=gpt-4o');
        return;
    }

    if (!config.accessible) {
        console.error('\n❌ Azure OpenAI not accessible:', config.error);
        return;
    }

    console.log('   ✅ Azure OpenAI configured and accessible\n');

    // Test 2: Summarize a sample clinical note
    console.log('2. Testing document summarization...');
    const sampleNote = `
    COORDINATION NOTE - 01/10/2025
    Patient: John Smith (DOB: 05/15/1945)
    
    Visit Type: Skilled Nursing Visit
    
    Vitals: BP 138/82, HR 76, Temp 98.4F, O2 Sat 96% on RA
    Weight: 185 lbs (stable from last visit)
    
    Assessment:
    Patient continues to show improvement in wound healing. The sacral wound 
    has decreased in size from 3.5cm x 2.1cm to 2.8cm x 1.6cm. Wound bed is 
    pink with granulation tissue. No signs of infection. Patient reports 
    decreased pain at wound site (3/10 vs 5/10 last visit).
    
    CHF stable - no peripheral edema noted. Patient compliant with fluid 
    restriction and low sodium diet. Daily weights being recorded.
    
    Medications reconciled - no changes. Patient taking Lasix 40mg daily, 
    Lisinopril 10mg daily, Metoprolol 25mg BID.
    
    Interventions:
    - Wound care performed per protocol
    - Reinforced CHF management education
    - Reviewed medication schedule with caregiver
    
    Plan:
    - Continue current wound care regimen
    - Next visit in 3 days for wound assessment
    - Contact MD if wound shows signs of infection
    `;

    const summaryResult = await azureOpenAI.summarizeDocument(sampleNote, {
        documentType: 'coordination note'
    });

    if (summaryResult.success) {
        console.log('   ✅ Summary generated successfully');
        console.log('   Tokens used:', summaryResult.usage);
        console.log('\n   --- Summary ---');
        console.log(summaryResult.summary);
        console.log('   --- End Summary ---\n');
    } else {
        console.error('   ❌ Summary failed:', summaryResult.error);
    }

    // Test 3: Extract structured data
    console.log('3. Testing clinical data extraction...');
    const extractResult = await azureOpenAI.extractClinicalData(sampleNote);

    if (extractResult.success) {
        console.log('   ✅ Data extracted successfully');
        console.log('   Extracted data:', JSON.stringify(extractResult.data, null, 2));
    } else {
        console.error('   ❌ Extraction failed:', extractResult.error);
    }

    // Test 4: Multiple document consolidation
    console.log('\n4. Testing multi-document consolidation...');
    const documents = [
        {
            text: sampleNote,
            type: 'Coordination Note',
            date: '01/10/2025'
        },
        {
            text: `COORDINATION NOTE - 01/07/2025
            Patient: John Smith
            Vitals: BP 142/86, HR 78, O2 Sat 95%
            Wound assessment: 3.5cm x 2.1cm sacral wound, slight improvement.
            Patient reports pain 5/10 at wound site.
            CHF: mild ankle edema noted, reinforced fluid restriction.
            Plan: Continue wound care, monitor CHF symptoms.`,
            type: 'Coordination Note',
            date: '01/07/2025'
        }
    ];

    const consolidatedResult = await azureOpenAI.summarizeMultipleDocuments(documents, {
        patientContext: 'John Smith, 79yo male with CHF and sacral wound'
    });

    if (consolidatedResult.success) {
        console.log('   ✅ Consolidated summary generated');
        console.log('\n   --- Consolidated Summary ---');
        console.log(consolidatedResult.summary);
        console.log('   --- End Consolidated Summary ---\n');
    } else {
        console.error('   ❌ Consolidation failed:', consolidatedResult.error);
    }

    console.log('\n=== Tests Complete ===');
}

runTests().catch(console.error);
