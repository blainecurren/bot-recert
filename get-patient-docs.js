require('dotenv').config();
const { fhirGet } = require('./services/fhirClient');

async function getPatientDocs() {
    // Allow passing patient ID directly or name search
    const searchTerm = process.argv[2] || 'BAXTER';
    const isPatientId = searchTerm.match(/^[a-z0-9]+$/i) && searchTerm.length > 5;

    let patientId = null;
    let patientName = null;

    if (isPatientId) {
        patientId = searchTerm;
        console.log('Using patient ID: ' + patientId + '\n');
    } else {
        console.log('Searching for patient: ' + searchTerm + '\n');

        // Find the patient
        console.log('1. Finding patient...');
        try {
            const patients = await fhirGet('/Patient', { name: searchTerm, _count: 20 });
            if (patients.entry && patients.entry.length > 0) {
                console.log('   Found ' + patients.entry.length + ' patients:');
                patients.entry.forEach(function(e, i) {
                    var p = e.resource;
                    var name = p.name && p.name[0] ? (p.name[0].text || (p.name[0].family + ', ' + (p.name[0].given ? p.name[0].given.join(' ') : ''))) : 'unknown';
                    console.log('   ' + (i+1) + '. ' + p.id + ' | ' + name);
                });
                console.log('\n   To get docs for a specific patient, run:');
                console.log('   node get-patient-docs.js <patientId>\n');
                return;
            } else {
                console.log('   No patients found');
                return;
            }
        } catch (e) {
            console.log('   Error: ' + e.message);
            return;
        }
    }

    // Get patient details
    try {
        var patient = await fhirGet('/Patient/' + patientId);
        var name = patient.name && patient.name[0] ? (patient.name[0].text || (patient.name[0].family + ', ' + (patient.name[0].given ? patient.name[0].given.join(' ') : ''))) : 'unknown';
        patientName = name;
        console.log('Patient: ' + patientName + ' (ID: ' + patientId + ')\n');
    } catch (e) {
        console.log('Error fetching patient: ' + e.message);
        return;
    }

    // Get DocumentReference resources
    console.log('Fetching documents...\n');
    try {
        const docs = await fhirGet('/DocumentReference', { patient: patientId, _count: 100, _sort: '-date' });
        var count = docs.entry ? docs.entry.length : 0;
        console.log('Found ' + count + ' documents:\n');

        if (docs.entry) {
            // Group by type
            var byType = {};
            docs.entry.forEach(function(e) {
                var doc = e.resource;
                var type = doc.type ? (doc.type.text || (doc.type.coding && doc.type.coding[0] ? doc.type.coding[0].display : 'OTHER')) : 'OTHER';
                if (!byType[type]) byType[type] = [];
                byType[type].push(doc);
            });

            // Print grouped
            Object.keys(byType).sort().forEach(function(type) {
                console.log('=== ' + type + ' (' + byType[type].length + ') ===');
                byType[type].forEach(function(doc, i) {
                    var date = doc.date ? doc.date.split('T')[0] : 'unknown';
                    var hasAttachment = doc.content && doc.content[0] && doc.content[0].attachment && doc.content[0].attachment.url;
                    var attachmentUrl = hasAttachment ? doc.content[0].attachment.url : '';
                    var filename = doc.content && doc.content[0] && doc.content[0].attachment ? (doc.content[0].attachment.title || '') : '';

                    console.log('  ' + (i+1) + '. [' + date + '] ' + (doc.description || 'No description'));
                    if (filename) console.log('     File: ' + filename);
                    if (attachmentUrl) console.log('     URL: ' + attachmentUrl);
                });
                console.log('');
            });
        }
    } catch (e) {
        console.log('Error: ' + e.message);
    }
}

getPatientDocs().catch(console.error);
