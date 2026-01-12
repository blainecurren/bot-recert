require('dotenv').config();
const { fhirGet } = require('./services/fhirClient');

async function exploreAPI() {
    console.log('Exploring HCHB FHIR API...\n');

    // Get capability statement (lists all available resources)
    try {
        console.log('1. Fetching API Capability Statement...\n');
        const metadata = await fhirGet('/metadata');

        console.log('Available Resources:');
        if (metadata.rest && metadata.rest[0] && metadata.rest[0].resource) {
            metadata.rest[0].resource.forEach(r => {
                console.log('  - ' + r.type);
            });
        }
    } catch (e) {
        console.log('Error:', e.message);
    }

    // Try searching practitioners by role
    console.log('\n2. Searching for practitioners with role/qualification...\n');

    const searches = [
        { name: 'By role (nurse)', params: { role: 'nurse' } },
        { name: 'By role (rn)', params: { role: 'rn' } },
        { name: 'By qualification', params: { qualification: 'RN' } },
    ];

    for (const search of searches) {
        try {
            console.log('  Trying: ' + search.name);
            const result = await fhirGet('/Practitioner', Object.assign({}, search.params, { _count: 3 }));
            const count = result.entry ? result.entry.length : 0;
            console.log('    Results: ' + count);
            if (result.entry && result.entry[0]) {
                const p = result.entry[0].resource;
                const name = p.name && p.name[0] ? (p.name[0].text || p.name[0].family) : 'unknown';
                console.log('    Sample: ' + name);
            }
        } catch (e) {
            console.log('    Error: ' + e.message);
        }
    }

    // Check PractitionerRole resource
    console.log('\n3. Checking PractitionerRole resource...\n');
    try {
        const roles = await fhirGet('/PractitionerRole', { _count: 10 });
        const count = roles.entry ? roles.entry.length : 0;
        console.log('  Found ' + count + ' PractitionerRoles');
        if (roles.entry) {
            roles.entry.slice(0, 5).forEach((e, i) => {
                const r = e.resource;
                const roleCode = r.code && r.code[0] ? (r.code[0].text || (r.code[0].coding && r.code[0].coding[0] ? r.code[0].coding[0].display : 'unknown')) : 'unknown';
                const practitioner = r.practitioner ? (r.practitioner.display || r.practitioner.reference) : 'unknown';
                console.log('  ' + (i+1) + '. Role: ' + roleCode);
                console.log('     Practitioner: ' + practitioner);
            });
        }
    } catch (e) {
        console.log('  PractitionerRole not available: ' + e.message);
    }

    // Check CareTeam resource
    console.log('\n4. Checking CareTeam resource...\n');
    try {
        const teams = await fhirGet('/CareTeam', { _count: 5 });
        const count = teams.entry ? teams.entry.length : 0;
        console.log('  Found ' + count + ' CareTeams');
    } catch (e) {
        console.log('  CareTeam: ' + e.message);
    }
}

exploreAPI().catch(console.error);
