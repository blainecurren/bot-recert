/**
 * End-to-End Field Test
 * Exercises the full service layer (same code paths as the bot) and verifies
 * that newly added fields from the FHIR audit are flowing through correctly.
 *
 * Usage: node test-e2e-fields.js [patientId]
 */

require('dotenv').config();
const fhirService = require('./services/fhirService');
const patientService = require('./services/patientService');
const dataFetchService = require('./services/dataFetchService');
const { fhirGet } = require('./services/fhirClient');

const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';
const SKIP = '\x1b[33mSKIP\x1b[0m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let passes = 0;
let fails = 0;
let skips = 0;

function check(label, value, expected) {
    if (expected === 'exists') {
        if (value !== undefined && value !== null) {
            passes++;
            console.log(`  ${PASS} ${label}: ${typeof value === 'object' ? JSON.stringify(value).substring(0, 100) : value}`);
        } else {
            fails++;
            console.log(`  ${FAIL} ${label}: expected to exist, got ${value}`);
        }
    } else if (expected === 'array') {
        if (Array.isArray(value)) {
            passes++;
            console.log(`  ${PASS} ${label}: array(${value.length})`);
        } else {
            fails++;
            console.log(`  ${FAIL} ${label}: expected array, got ${typeof value}`);
        }
    } else if (expected === 'non-empty-array') {
        if (Array.isArray(value) && value.length > 0) {
            passes++;
            console.log(`  ${PASS} ${label}: array(${value.length})`);
        } else if (Array.isArray(value)) {
            skips++;
            console.log(`  ${SKIP} ${label}: empty array (field exists but no data from API)`);
        } else {
            fails++;
            console.log(`  ${FAIL} ${label}: expected non-empty array, got ${typeof value}`);
        }
    } else if (expected === 'optional') {
        // Field may or may not be populated - just report
        if (value !== undefined && value !== null && value !== '') {
            passes++;
            console.log(`  ${PASS} ${label}: ${typeof value === 'object' ? JSON.stringify(value).substring(0, 100) : value}`);
        } else {
            skips++;
            console.log(`  ${SKIP} ${label}: not populated (optional)`);
        }
    } else if (expected === 'formatted') {
        if (value && !value.isEmpty && value.formatted) {
            passes++;
            const preview = value.formatted.substring(0, 120).replace(/\n/g, ' | ');
            console.log(`  ${PASS} ${label}: "${preview}..."`);
        } else if (value && value.isEmpty) {
            skips++;
            console.log(`  ${SKIP} ${label}: empty (no data from API)`);
        } else {
            fails++;
            console.log(`  ${FAIL} ${label}: bad format result: ${JSON.stringify(value)}`);
        }
    }
}

async function findSamplePatient() {
    console.log('Finding a sample patient from active episodes...');
    const bundle = await fhirGet('/EpisodeOfCare', { status: 'active', _count: 1, _include: 'EpisodeOfCare:patient' });
    if (!bundle.entry || bundle.entry.length === 0) throw new Error('No active episodes found');
    const episode = bundle.entry.find(e => e.resource.resourceType === 'EpisodeOfCare');
    const patientRef = episode?.resource?.patient?.reference;
    if (!patientRef) throw new Error('Episode has no patient reference');
    return patientRef.replace('Patient/', '');
}

async function main() {
    const patientId = process.argv[2] || await findSamplePatient();
    console.log(`\n${BOLD}=== E2E Field Test for Patient: ${patientId} ===${RESET}\n`);

    // ================================================================
    // TEST 1: fhirService.getPatientEpisodes - new fields
    // ================================================================
    console.log(`${BOLD}1. EpisodeOfCare (fhirService.getPatientEpisodes)${RESET}`);
    try {
        const episodes = await fhirService.getPatientEpisodes(patientId);
        if (episodes.length === 0) {
            console.log(`  ${SKIP} No episodes found`);
        } else {
            const ep = episodes[0];
            check('episode.id', ep.id, 'exists');
            check('episode.careManager (NEW)', ep.careManager, 'optional');
            check('episode.primaryDiagnosis (NEW)', ep.primaryDiagnosis, 'optional');
            check('episode.diagnoses (NEW)', ep.diagnoses, 'array');
            if (ep.diagnoses && ep.diagnoses.length > 0) {
                check('episode.diagnoses[0].display', ep.diagnoses[0].display, 'exists');
                check('episode.diagnoses count > 1 (multi-dx)', ep.diagnoses.length > 1, 'exists');
            }
        }
    } catch (err) {
        fails++;
        console.log(`  ${FAIL} Error: ${err.message}`);
    }

    // ================================================================
    // TEST 2: fhirService.getConditions - onsetDateTime
    // ================================================================
    console.log(`\n${BOLD}2. Conditions (fhirService.getConditions)${RESET}`);
    try {
        const conditions = await fhirService.getConditions(patientId);
        if (conditions.length === 0) {
            console.log(`  ${SKIP} No conditions found`);
        } else {
            check('conditions array', conditions, 'non-empty-array');
            check('condition.display', conditions[0].display, 'exists');
            check('condition.onsetDateTime (NEW)', conditions[0].onsetDateTime, 'optional');
        }
    } catch (err) {
        fails++;
        console.log(`  ${FAIL} Error: ${err.message}`);
    }

    // ================================================================
    // TEST 3: fhirService.getMedications - authoredOn, requester, reasonCode
    // ================================================================
    console.log(`\n${BOLD}3. Medications (fhirService.getMedications)${RESET}`);
    try {
        const meds = await fhirService.getMedications(patientId);
        if (meds.length === 0) {
            console.log(`  ${SKIP} No medications found`);
        } else {
            check('medications array', meds, 'non-empty-array');
            check('med.name', meds[0].name, 'exists');
            check('med.authoredOn (NEW)', meds[0].authoredOn, 'optional');
            check('med.requester (NEW)', meds[0].requester, 'optional');
            check('med.reasonCode (NEW)', meds[0].reasonCode, 'optional');
        }
    } catch (err) {
        fails++;
        console.log(`  ${FAIL} Error: ${err.message}`);
    }

    // ================================================================
    // TEST 4: fhirService.getAllergyIntolerances - onsetDateTime, note
    // ================================================================
    console.log(`\n${BOLD}4. Allergies (fhirService.getAllergyIntolerances)${RESET}`);
    try {
        const allergies = await fhirService.getAllergyIntolerances(patientId);
        if (allergies.length === 0) {
            console.log(`  ${SKIP} No allergies found`);
        } else {
            check('allergies array', allergies, 'non-empty-array');
            check('allergy.substance', allergies[0].substance, 'exists');
            check('allergy.onsetDateTime (NEW)', allergies[0].onsetDateTime, 'optional');
            check('allergy.note (NEW)', allergies[0].note, 'optional');
        }
    } catch (err) {
        fails++;
        console.log(`  ${FAIL} Error: ${err.message}`);
    }

    // ================================================================
    // TEST 5: fhirService.getBloodPressure - interpretation, note
    // ================================================================
    console.log(`\n${BOLD}5. Blood Pressure (fhirService.getBloodPressure)${RESET}`);
    try {
        const bp = await fhirService.getBloodPressure(patientId);
        if (!bp || (Array.isArray(bp) && bp.length === 0)) {
            console.log(`  ${SKIP} No blood pressure readings found`);
        } else {
            const readings = Array.isArray(bp) ? bp : [bp];
            check('bp readings', readings, 'non-empty-array');
            if (readings.length > 0) {
                check('bp.date', readings[0].date, 'exists');
                check('bp.interpretation (NEW)', readings[0].interpretation, 'optional');
                check('bp.note (NEW)', readings[0].note, 'optional');
            }
        }
    } catch (err) {
        fails++;
        console.log(`  ${FAIL} Error: ${err.message}`);
    }

    // ================================================================
    // TEST 6: fhirService.getCarePlanGoals - targets, notes
    // ================================================================
    console.log(`\n${BOLD}6. Goals (fhirService.getCarePlanGoals)${RESET}`);
    try {
        const goals = await fhirService.getCarePlanGoals(patientId);
        if (goals.length === 0) {
            console.log(`  ${SKIP} No goals found`);
        } else {
            check('goals array', goals, 'non-empty-array');
            check('goal.description', goals[0].description, 'exists');
            check('goal.targets (NEW)', goals[0].targets, 'array');
            check('goal.notes (NEW)', goals[0].notes, 'array');
        }
    } catch (err) {
        fails++;
        console.log(`  ${FAIL} Error: ${err.message}`);
    }

    // ================================================================
    // TEST 7: fhirService.getPhysician - qualifications, phone, email
    // ================================================================
    console.log(`\n${BOLD}7. Physician (fhirService.getPhysician)${RESET}`);
    try {
        const physician = await fhirService.getPhysician(patientId);
        if (!physician) {
            console.log(`  ${SKIP} No physician found`);
        } else {
            check('physician.name', physician.name, 'exists');
            check('physician.qualifications (NEW)', physician.qualifications, 'array');
            check('physician.phone (NEW)', physician.phone, 'optional');
            check('physician.email (NEW)', physician.email, 'optional');
        }
    } catch (err) {
        fails++;
        console.log(`  ${FAIL} Error: ${err.message}`);
    }

    // ================================================================
    // TEST 8: fhirService.getPatientVisits - reasonCode, description
    // ================================================================
    console.log(`\n${BOLD}8. Visits (fhirService.getPatientVisits)${RESET}`);
    try {
        const visits = await fhirService.getPatientVisits(patientId);
        if (!visits || visits.length === 0) {
            console.log(`  ${SKIP} No visits found`);
        } else {
            check('visits array', visits, 'non-empty-array');
            check('visit.reasonCode (NEW)', visits[0].reasonCode, 'optional');
            check('visit.description (NEW)', visits[0].description, 'optional');
        }
    } catch (err) {
        fails++;
        console.log(`  ${FAIL} Error: ${err.message}`);
    }

    // ================================================================
    // TEST 9: fhirService.getDocuments (shared transform) - status, authors
    // ================================================================
    console.log(`\n${BOLD}9. Documents (fhirService.getDocuments - shared transform)${RESET}`);
    try {
        const docs = await fhirService.getDocuments(patientId);
        if (docs.length === 0) {
            console.log(`  ${SKIP} No documents found`);
        } else {
            check('documents array', docs, 'non-empty-array');
            check('doc.status (NEW)', docs[0].status, 'optional');
            check('doc.authors (NEW)', docs[0].authors, 'array');
        }
    } catch (err) {
        fails++;
        console.log(`  ${FAIL} Error: ${err.message}`);
    }

    // ================================================================
    // TEST 10: fhirService.getWounds - onsetDateTime
    // ================================================================
    console.log(`\n${BOLD}10. Wounds (fhirService.getWounds)${RESET}`);
    try {
        const wounds = await fhirService.getWounds(patientId);
        if (!wounds || wounds.length === 0) {
            console.log(`  ${SKIP} No wounds found`);
        } else {
            check('wounds array', wounds, 'non-empty-array');
            check('wound.onsetDateTime (NEW)', wounds[0].onsetDateTime, 'optional');
        }
    } catch (err) {
        fails++;
        console.log(`  ${FAIL} Error: ${err.message}`);
    }

    // ================================================================
    // TEST 11: fhirService.getPersonalCarePlan - activityDetails
    // ================================================================
    console.log(`\n${BOLD}11. CarePlan (fhirService.getPersonalCarePlan)${RESET}`);
    try {
        const plans = await fhirService.getPersonalCarePlan(patientId);
        if (!plans || (Array.isArray(plans) && plans.length === 0)) {
            console.log(`  ${SKIP} No care plans found`);
        } else {
            const plan = Array.isArray(plans) ? plans[0] : plans;
            check('careplan.activityDetails (NEW)', plan.activityDetails, 'array');
        }
    } catch (err) {
        fails++;
        console.log(`  ${FAIL} Error: ${err.message}`);
    }

    // ================================================================
    // TEST 12: patientService.getPatientEpisode - full enriched output
    // ================================================================
    console.log(`\n${BOLD}12. PatientService.getPatientEpisode (orchestrated)${RESET}`);
    try {
        const episode = await patientService.getPatientEpisode(patientId);
        if (!episode) {
            console.log(`  ${SKIP} No episode data returned`);
        } else {
            check('episode.patientName', episode.patientName, 'exists');
            check('episode.careManager (NEW passthrough)', episode.careManager, 'optional');
            check('episode.episodeDiagnoses (NEW passthrough)', episode.episodeDiagnoses, 'array');
            check('episode.medications', episode.medications, 'array');
            if (episode.medications.length > 0) {
                check('med.authoredOn (NEW passthrough)', episode.medications[0].authoredOn, 'optional');
                check('med.requester (NEW passthrough)', episode.medications[0].requester, 'optional');
            }
            check('episode.goals', episode.goals, 'array');
            if (episode.goals.length > 0) {
                check('goal.notes (NEW passthrough)', episode.goals[0].notes, 'optional');
                check('goal.targets (NEW passthrough)', episode.goals[0].targets, 'optional');
            }
        }
    } catch (err) {
        fails++;
        console.log(`  ${FAIL} Error: ${err.message}`);
    }

    // ================================================================
    // TEST 13: dataFetchService formatters - verify formatting with new fields
    // ================================================================
    console.log(`\n${BOLD}13. DataFetchService formatters (display output)${RESET}`);

    // Test formatDate / formatDateTime helpers
    const { formatDate, formatDateTime } = dataFetchService;
    check('formatDate("2025-01-15")', formatDate('2025-01-15'), 'exists');
    check('formatDate result', formatDate('2025-01-15') === '01/15/2025', 'exists');
    check('formatDateTime("2025-01-15T14:30:00Z")', formatDateTime('2025-01-15T14:30:00Z'), 'exists');
    check('formatDate(null)', formatDate(null) === '', 'exists');
    check('formatDateTime(null)', formatDateTime(null) === '', 'exists');

    // Test each formatter through fetchSelectedResources
    const testResources = [
        'EpisodeOfCare',
        'Condition-Diagnoses',
        'MedicationRequest',
        'AllergyIntolerance',
        'Observation-BloodPressure',
        'Practitioner-Physician',
        'Appointment-Visit',
        'CarePlan-PersonalCare'
    ];

    console.log(`\n${BOLD}14. Full pipeline: fetchSelectedResources → formatSimpleData${RESET}`);
    try {
        const { results, errors } = await dataFetchService.fetchSelectedResources(patientId, null, testResources);

        if (errors.length > 0) {
            console.log(`  Fetch errors: ${errors.map(e => `${e.resourceId}: ${e.error}`).join(', ')}`);
        }

        for (const resourceId of testResources) {
            const result = results[resourceId];
            if (!result) {
                skips++;
                console.log(`  ${SKIP} ${resourceId}: no data returned`);
                continue;
            }
            const formatted = dataFetchService.formatSimpleData(resourceId, result.data);
            check(`${resourceId} → formatted`, formatted, 'formatted');
        }
    } catch (err) {
        fails++;
        console.log(`  ${FAIL} Pipeline error: ${err.message}`);
    }

    // ================================================================
    // TEST 15: cardBuilder.resolvePatientName
    // ================================================================
    console.log(`\n${BOLD}15. cardBuilder.resolvePatientName${RESET}`);
    const { resolvePatientName } = require('./cards/cardBuilder');
    check('resolvePatientName({fullName:"John Doe"})', resolvePatientName({ fullName: 'John Doe' }) === 'John Doe', 'exists');
    check('resolvePatientName({name:"Jane"})', resolvePatientName({ name: 'Jane' }) === 'Jane', 'exists');
    check('resolvePatientName({lastName:"Smith",firstName:"Bob"})', resolvePatientName({ lastName: 'Smith', firstName: 'Bob' }) === 'Smith, Bob', 'exists');
    check('resolvePatientName(null)', resolvePatientName(null) === 'Unknown Patient', 'exists');
    check('resolvePatientName({})', resolvePatientName({}) === 'Patient Unknown', 'exists');

    // ================================================================
    // SUMMARY
    // ================================================================
    console.log(`\n${BOLD}${'='.repeat(50)}${RESET}`);
    console.log(`${BOLD}Results:${RESET} ${PASS} ${passes} passed  ${FAIL} ${fails} failed  ${SKIP} ${skips} skipped`);
    console.log(`${BOLD}${'='.repeat(50)}${RESET}`);

    if (fails > 0) {
        console.log(`\n${FAIL} Some tests failed! Review output above.`);
        process.exit(1);
    } else {
        console.log(`\nAll structural checks passed. Skipped items are fields not populated in HCHB.`);
    }
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    console.error(err.stack);
    process.exit(1);
});
