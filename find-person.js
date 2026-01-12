require('dotenv').config();
const { fhirGet } = require('./services/fhirClient');

async function findPerson() {
    const searchName = process.argv[2] || 'CURREN';
    console.log('Searching for: ' + searchName + '\n');

    // Search Practitioners by name
    console.log('1. Searching Practitioners by name...');
    try {
        const result = await fhirGet('/Practitioner', { name: searchName, _count: 20 });
        const count = result.entry ? result.entry.length : 0;
        console.log('   Found: ' + count);
        if (result.entry) {
            result.entry.forEach(function(e, i) {
                const p = e.resource;
                const name = p.name && p.name[0] ? (p.name[0].text || (p.name[0].family + ', ' + (p.name[0].given ? p.name[0].given[0] : ''))) : 'unknown';
                const type = p.identifier ? p.identifier.find(function(id) { return id.value && id.value.startsWith('practitioner-'); }) : null;
                const typeStr = type ? type.value.replace('practitioner-', '') : 'unknown';
                console.log('   ' + (i+1) + '. ' + p.id + ' | ' + name + ' | Type: ' + typeStr);
            });
        }
    } catch (e) {
        console.log('   Error: ' + e.message);
    }

    // Search CareTeam for the person
    console.log('\n2. Searching CareTeam members...');
    try {
        const result = await fhirGet('/CareTeam', { _count: 50 });
        const count = result.entry ? result.entry.length : 0;
        console.log('   Found ' + count + ' CareTeams, checking members...');

        var found = [];
        if (result.entry) {
            result.entry.forEach(function(e) {
                var team = e.resource;
                if (team.participant) {
                    team.participant.forEach(function(p) {
                        var memberName = p.member ? (p.member.display || '') : '';
                        if (memberName.toUpperCase().indexOf(searchName.toUpperCase()) >= 0) {
                            found.push({
                                name: memberName,
                                role: p.role && p.role[0] ? (p.role[0].text || (p.role[0].coding && p.role[0].coding[0] ? p.role[0].coding[0].display : '')) : '',
                                reference: p.member ? p.member.reference : ''
                            });
                        }
                    });
                }
            });
        }

        if (found.length > 0) {
            console.log('   Found in CareTeams:');
            found.forEach(function(f, i) {
                console.log('   ' + (i+1) + '. ' + f.name + ' | Role: ' + f.role + ' | Ref: ' + f.reference);
            });
        } else {
            console.log('   Not found in CareTeams');
        }
    } catch (e) {
        console.log('   Error: ' + e.message);
    }

    // Try Person resource
    console.log('\n3. Searching Person resource...');
    try {
        const result = await fhirGet('/Person', { name: searchName, _count: 10 });
        const count = result.entry ? result.entry.length : 0;
        console.log('   Found: ' + count);
        if (result.entry) {
            result.entry.forEach(function(e, i) {
                const p = e.resource;
                const name = p.name && p.name[0] ? (p.name[0].text || (p.name[0].family + ', ' + (p.name[0].given ? p.name[0].given[0] : ''))) : 'unknown';
                console.log('   ' + (i+1) + '. ' + p.id + ' | ' + name);
            });
        }
    } catch (e) {
        console.log('   Error: ' + e.message);
    }
}

findPerson().catch(console.error);
