/**
 * FHIR Connection Test Script
 * Usage: node test-fhir.js [workerId]
 */

require('dotenv').config();
const { testConnection, fhirGet } = require('./services/fhirClient');

async function runTests() {
    console.log('========================================');
    console.log('HCHB FHIR Connection Test');
    console.log('========================================\n');

    console.log('1. Testing API connection...');
    const connected = await testConnection();
    if (!connected) {
        console.log('   Connection failed!');
        process.exit(1);
    }
    console.log('   Connected!\n');

    // Show full identifier details for practitioners
    console.log('2. Listing practitioners with FULL identifier details...\n');
    try {
        const list = await fhirGet('/Practitioner', { _count: 5 });

        if (list.entry && list.entry.length > 0) {
            list.entry.forEach((e, i) => {
                const p = e.resource;
                const name = p.name?.[0]?.text || `${p.name?.[0]?.given?.[0] || ''} ${p.name?.[0]?.family || ''}`.trim();
                console.log(`--- Practitioner ${i+1}: ${name} ---`);
                console.log(`Resource ID: ${p.id}`);
                console.log('Identifiers:');
                p.identifier?.forEach((id, j) => {
                    console.log(`  ${j+1}. system: ${id.system || 'none'}`);
                    console.log(`     value: ${id.value}`);
                    console.log(`     type: ${id.type?.coding?.[0]?.code || 'none'}`);
                });
                console.log('');
            });
        }
    } catch (e) {
        console.log('Error:', e.message);
    }

    // If workerId provided, search for it
    const workerId = process.argv[2];
    if (workerId) {
        console.log(`\n3. Searching for: ${workerId}\n`);

        // Try with system prefix
        const systems = [
            null,
            'http://hchb.com/fhir/worker-id',
            'urn:oid:2.16.840.1.113883.4.6',
        ];

        for (const system of systems) {
            const searchParam = system ? `${system}|${workerId}` : workerId;
            console.log(`   Trying identifier=${searchParam}`);
            try {
                const result = await fhirGet('/Practitioner', { identifier: searchParam, _count: 1 });
                console.log(`   Results: ${result.entry?.length || 0}`);
                if (result.entry?.[0]) {
                    const p = result.entry[0].resource;
                    console.log(`   FOUND: ${p.name?.[0]?.text || p.name?.[0]?.family}, ID: ${p.id}`);
                }
            } catch (e) {
                console.log(`   Error: ${e.message}`);
            }
        }
    }

    console.log('\n========================================');
}

runTests().catch(console.error);
