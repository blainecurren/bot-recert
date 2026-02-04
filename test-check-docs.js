/**
 * Quick check for what documents exist for patients
 */
require('dotenv').config();
const { fhirGet, testConnection } = require('./services/fhirClient');
const patientService = require('./services/patientService');

async function checkDocs() {
    console.log('Checking documents...\n');

    await testConnection();

    const patients = await patientService.getPatientsByWorkerAndDate('xocgql9s1', new Date().toISOString().split('T')[0]);
    console.log(`Found ${patients.length} patients\n`);

    // Check first 3 patients
    for (const patient of patients.slice(0, 3)) {
        console.log(`\n--- ${patient.fullName || patient.name} (${patient.id}) ---`);

        const bundle = await fhirGet('/DocumentReference', {
            subject: `Patient/${patient.id}`,
            _count: 20
        });

        if (!bundle.entry || bundle.entry.length === 0) {
            console.log('  No documents found');
            continue;
        }

        console.log(`  Found ${bundle.entry.length} documents:`);

        bundle.entry.forEach((entry, i) => {
            const doc = entry.resource;
            const type = doc.type?.text || doc.type?.coding?.[0]?.display || 'Unknown';
            const date = doc.date ? doc.date.split('T')[0] : 'N/A';
            const attachment = doc.content?.[0]?.attachment;
            const hasUrl = !!attachment?.url;
            const contentType = attachment?.contentType || 'none';

            console.log(`    ${i+1}. [${type}] ${date} - URL: ${hasUrl ? 'YES' : 'NO'}, Type: ${contentType}`);
        });
    }
}

checkDocs().catch(console.error);
