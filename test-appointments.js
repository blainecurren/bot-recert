require('dotenv').config();
const { fhirGet } = require('./services/fhirClient');

async function testAppointments() {
    const workerId = process.argv[2] || 'xocgql9s1';

    console.log('Getting appointments for worker: ' + workerId + '\n');

    // Check for today
    var today = new Date().toISOString().split('T')[0];
    console.log('Today: ' + today);

    // Get one full appointment to see structure
    console.log('\n1. Fetching one appointment with full details...\n');
    try {
        const appts = await fhirGet('/Appointment', {
            actor: 'Practitioner/' + workerId,
            date: 'ge2025-12-01',
            _count: 1
        });

        if (appts.entry && appts.entry[0]) {
            console.log(JSON.stringify(appts.entry[0].resource, null, 2));
        }
    } catch (e) {
        console.log('Error: ' + e.message);
    }

    // Check for appointments today
    console.log('\n\n2. Checking appointments for TODAY (' + today + ')...');
    try {
        const todayAppts = await fhirGet('/Appointment', {
            actor: 'Practitioner/' + workerId,
            date: today,
            _count: 20
        });
        var count = todayAppts.entry ? todayAppts.entry.length : 0;
        console.log('   Found: ' + count);
    } catch (e) {
        console.log('   Error: ' + e.message);
    }

    // Check for future appointments
    console.log('\n3. Checking appointments from today forward...');
    try {
        const futureAppts = await fhirGet('/Appointment', {
            actor: 'Practitioner/' + workerId,
            date: 'ge' + today,
            _count: 20
        });
        var count = futureAppts.entry ? futureAppts.entry.length : 0;
        console.log('   Found: ' + count);
        if (futureAppts.entry) {
            futureAppts.entry.slice(0, 10).forEach(function(e, i) {
                var a = e.resource;
                // Find patient
                var patient = 'No patient';
                if (a.participant) {
                    a.participant.forEach(function(p) {
                        if (p.actor && p.actor.reference && p.actor.reference.startsWith('Patient/')) {
                            patient = p.actor.display || p.actor.reference;
                        }
                    });
                }
                console.log('   ' + (i+1) + '. ' + (a.start || 'no date') + ' | ' + patient + ' | Status: ' + a.status);
            });
        }
    } catch (e) {
        console.log('   Error: ' + e.message);
    }

    // Check ALL appointments (most recent)
    console.log('\n4. Most recent appointments (any date)...');
    try {
        const allAppts = await fhirGet('/Appointment', {
            actor: 'Practitioner/' + workerId,
            _sort: '-date',
            _count: 10
        });
        var count = allAppts.entry ? allAppts.entry.length : 0;
        console.log('   Found: ' + count);
        if (allAppts.entry) {
            allAppts.entry.slice(0, 10).forEach(function(e, i) {
                var a = e.resource;
                var patient = 'No patient';
                if (a.participant) {
                    a.participant.forEach(function(p) {
                        if (p.actor && p.actor.reference && p.actor.reference.startsWith('Patient/')) {
                            patient = p.actor.display || p.actor.reference;
                        }
                    });
                }
                console.log('   ' + (i+1) + '. ' + (a.start || 'no date') + ' | ' + patient);
            });
        }
    } catch (e) {
        console.log('   Error: ' + e.message);
    }
}

testAppointments().catch(console.error);
