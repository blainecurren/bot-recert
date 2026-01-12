/**
 * Pull All Workers from HCHB FHIR API
 * Exports to CSV and JSON for easy lookup
 *
 * Usage: node pull-workers.js
 */

require('dotenv').config();
const fs = require('fs');
const { testConnection, fhirGet } = require('./services/fhirClient');

async function pullAllWorkers() {
    console.log('========================================');
    console.log('Pulling All Workers from HCHB FHIR');
    console.log('========================================\n');

    // Test connection first
    const connected = await testConnection();
    if (!connected) {
        console.log('Connection failed!');
        process.exit(1);
    }

    const allWorkers = [];
    let page = 1;
    const pageSize = 100;
    let hasMore = true;
    let offset = 0;

    console.log('Fetching practitioners and filtering for workers...\n');

    // Paginate through all results
    while (hasMore && page <= 200) {
        console.log(`Page ${page} (offset ${offset})...`);

        try {
            const bundle = await fhirGet('/Practitioner', {
                _count: pageSize,
                _offset: offset
            });

            if (!bundle.entry || bundle.entry.length === 0) {
                hasMore = false;
                break;
            }

            // Filter for workers (those with practitioner-worker identifier)
            bundle.entry.forEach(e => {
                const p = e.resource;
                const isWorker = p.identifier?.some(id => id.value === 'practitioner-worker');

                if (isWorker) {
                    const name = p.name?.[0] || {};
                    const fullName = name.text || `${name.family || ''}, ${name.given?.[0] || ''}`.trim();

                    const resourceId = p.id;
                    const npi = p.identifier?.find(id => id.system === 'http://hl7.org/fhir/sid/us-npi')?.value || '';

                    allWorkers.push({
                        resourceId,
                        name: fullName,
                        firstName: name.given?.[0] || '',
                        lastName: name.family || '',
                        npi,
                        active: p.active
                    });
                }
            });

            console.log(`  Found ${allWorkers.length} workers so far...`);

            // Check if we got less than pageSize (last page)
            if (bundle.entry.length < pageSize) {
                hasMore = false;
            }

            offset += pageSize;
            page++;

        } catch (error) {
            console.error('Error fetching page:', error.message);
            break;
        }
    }

    console.log(`\nTotal workers found: ${allWorkers.length}`);

    // Save to JSON
    const jsonFile = 'workers-only.json';
    fs.writeFileSync(jsonFile, JSON.stringify({ workers: allWorkers, exportDate: new Date().toISOString() }, null, 2));
    console.log(`Saved to ${jsonFile}`);

    // Save workers to CSV
    const csvFile = 'workers-only.csv';
    const csvHeader = 'Resource ID,Name,First Name,Last Name,NPI,Active\n';
    const csvRows = allWorkers.map(p =>
        `"${p.resourceId}","${p.name}","${p.firstName}","${p.lastName}","${p.npi}","${p.active}"`
    ).join('\n');
    fs.writeFileSync(csvFile, csvHeader + csvRows);
    console.log(`Saved to ${csvFile}`);

    // Print all workers
    console.log('\n--- All Workers ---\n');
    console.log('Resource ID    | Name                           | NPI');
    console.log('---------------|--------------------------------|------------');
    allWorkers.forEach((w) => {
        console.log(`${w.resourceId.padEnd(14)} | ${w.name.padEnd(30)} | ${w.npi || 'N/A'}`);
    });

    console.log('\n========================================');
    console.log('To use a worker in the bot, enter their Resource ID');
    console.log('========================================');
}

pullAllWorkers().catch(error => {
    console.error('Failed:', error);
    process.exit(1);
});
