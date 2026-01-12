require('dotenv').config();
const { fhirGet } = require('./services/fhirClient');

async function testPatientSearch() {
    const workerId = process.argv[2] || 'xocgql9s1';
    const dateStr = process.argv[3] || new Date().toISOString().split('T')[0];

    console.log('Testing patient search for worker: ' + workerId);
    console.log('Date: ' + dateStr + '\n');

    // 1. Check if Appointments exist at all
    console.log('1. Checking for ANY appointments...');
    try {
        const appts = await fhirGet('/Appointment', { _count: 5 });
        const count = appts.entry ? appts.entry.length : 0;
        console.log('   Total appointments found: ' + (appts.total || count));
        if (appts.entry && appts.entry.length > 0) {
            console.log('   Sample appointment:');
            const a = appts.entry[0].resource;
            console.log('     ID: ' + a.id);
            console.log('     Status: ' + a.status);
            console.log('     Start: ' + a.start);
            console.log('     Participants:');
            if (a.participant) {
                a.participant.forEach(function(p) {
                    console.log('       - ' + (p.actor ? (p.actor.display || p.actor.reference) : 'unknown'));
                });
            }
        }
    } catch (e) {
        console.log('   Error: ' + e.message);
    }

    // 2. Check for Appointments with this practitioner
    console.log('\n2. Checking appointments for practitioner ' + workerId + '...');
    var formats = [workerId, 'Practitioner/' + workerId];
    for (var i = 0; i < formats.length; i++) {
        try {
            console.log('   Trying actor=' + formats[i]);
            const appts = await fhirGet('/Appointment', { actor: formats[i], _count: 5 });
            const count = appts.entry ? appts.entry.length : 0;
            console.log('   Found: ' + count);
        } catch (e) {
            console.log('   Error: ' + e.message);
        }
    }

    // 3. Check Schedule resource
    console.log('\n3. Checking Schedule resource...');
    try {
        const schedules = await fhirGet('/Schedule', { actor: 'Practitioner/' + workerId, _count: 5 });
        const count = schedules.entry ? schedules.entry.length : 0;
        console.log('   Schedules found: ' + count);
    } catch (e) {
        console.log('   Error: ' + e.message);
    }

    // 4. Check Encounter resource (visits)
    console.log('\n4. Checking Encounter resource...');
    try {
        const encounters = await fhirGet('/Encounter', { _count: 5 });
        const count = encounters.entry ? encounters.entry.length : 0;
        console.log('   Total encounters: ' + (encounters.total || count));
        if (encounters.entry && encounters.entry.length > 0) {
            console.log('   Sample encounter:');
            const enc = encounters.entry[0].resource;
            console.log('     ID: ' + enc.id);
            console.log('     Status: ' + enc.status);
            console.log('     Class: ' + (enc.class ? enc.class.code : 'unknown'));
            console.log('     Period: ' + (enc.period ? enc.period.start : 'unknown'));
            if (enc.participant) {
                console.log('     Participants:');
                enc.participant.forEach(function(p) {
                    console.log('       - ' + (p.individual ? (p.individual.display || p.individual.reference) : 'unknown'));
                });
            }
        }
    } catch (e) {
        console.log('   Error: ' + e.message);
    }

    // 5. Check Encounter for this practitioner
    console.log('\n5. Checking encounters for practitioner...');
    try {
        const encounters = await fhirGet('/Encounter', { practitioner: workerId, _count: 5 });
        const count = encounters.entry ? encounters.entry.length : 0;
        console.log('   Encounters found: ' + count);
        if (encounters.entry) {
            encounters.entry.forEach(function(e, i) {
                var enc = e.resource;
                var patient = enc.subject ? (enc.subject.display || enc.subject.reference) : 'unknown';
                console.log('   ' + (i+1) + '. Patient: ' + patient + ' | Date: ' + (enc.period ? enc.period.start : 'unknown'));
            });
        }
    } catch (e) {
        console.log('   Error: ' + e.message);
    }

    // 6. Check EpisodeOfCare
    console.log('\n6. Checking EpisodeOfCare resource...');
    try {
        const episodes = await fhirGet('/EpisodeOfCare', { _count: 5, status: 'active' });
        const count = episodes.entry ? episodes.entry.length : 0;
        console.log('   Active episodes: ' + count);
        if (episodes.entry && episodes.entry.length > 0) {
            console.log('   Sample episode:');
            var ep = episodes.entry[0].resource;
            console.log('     ID: ' + ep.id);
            console.log('     Patient: ' + (ep.patient ? (ep.patient.display || ep.patient.reference) : 'unknown'));
            console.log('     Period: ' + (ep.period ? (ep.period.start + ' to ' + ep.period.end) : 'unknown'));
            if (ep.careManager) {
                console.log('     Care Manager: ' + (ep.careManager.display || ep.careManager.reference));
            }
        }
    } catch (e) {
        console.log('   Error: ' + e.message);
    }

    // 7. Try EpisodeOfCare with care-manager filter
    console.log('\n7. Checking episodes where worker is care manager...');
    try {
        const episodes = await fhirGet('/EpisodeOfCare', { 'care-manager': 'Practitioner/' + workerId, _count: 10 });
        const count = episodes.entry ? episodes.entry.length : 0;
        console.log('   Episodes found: ' + count);
        if (episodes.entry) {
            episodes.entry.forEach(function(e, i) {
                var ep = e.resource;
                var patient = ep.patient ? (ep.patient.display || ep.patient.reference) : 'unknown';
                console.log('   ' + (i+1) + '. Patient: ' + patient);
            });
        }
    } catch (e) {
        console.log('   Error: ' + e.message);
    }
}

testPatientSearch().catch(console.error);
