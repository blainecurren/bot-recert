/**
 * Check document types and content availability
 */
require('dotenv').config();
const { fhirGet } = require('./services/fhirClient');

async function checkDocTypes() {
    const patientId = process.argv[2] || 'omblx25bw';

    console.log(`Checking document types for patient: ${patientId}\n`);

    const r = await fhirGet('/DocumentReference', {
        subject: `Patient/${patientId}`,
        _count: 100,
        _sort: '-date'
    });

    // Group by type and check content
    const types = {};
    (r.entry || []).forEach(e => {
        const d = e.resource;
        const type = d.type?.text || d.type?.coding?.[0]?.display || 'UNKNOWN';
        const att = d.content?.[0]?.attachment || {};
        const hasContent = att.url || att.data || d.description;

        if (!types[type]) {
            types[type] = { total: 0, withContent: 0, sample: null };
        }
        types[type].total++;
        if (hasContent) {
            types[type].withContent++;
            if (!types[type].sample) {
                types[type].sample = {
                    hasUrl: !!att.url,
                    hasData: !!att.data,
                    dataLen: att.data?.length || 0,
                    contentType: att.contentType || 'none'
                };
            }
        }
    });

    console.log('Document types with content:\n');
    Object.entries(types)
        .sort((a, b) => b[1].withContent - a[1].withContent)
        .forEach(([type, info]) => {
            const pct = Math.round(info.withContent / info.total * 100);
            console.log(`${type}: ${info.withContent}/${info.total} (${pct}%) have content`);
            if (info.sample) {
                console.log(`  → URL: ${info.sample.hasUrl} | Data: ${info.sample.hasData} (${info.sample.dataLen} chars) | Type: ${info.sample.contentType}`);
            }
        });
}

checkDocTypes().catch(console.error);
