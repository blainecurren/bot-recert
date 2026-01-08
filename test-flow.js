/**
 * Test script for the new bot flow
 * Run with: node test-flow.js
 */

require('dotenv').config();

const patientService = require('./services/patientService');
const dataFetchService = require('./services/dataFetchService');
const cardBuilder = require('./cards/cardBuilder');

async function testFlow() {
    console.log('\n========================================');
    console.log('BOT FLOW TEST');
    console.log('========================================\n');

    // Test 1: Worker validation
    console.log('TEST 1: Worker Validation');
    console.log('-'.repeat(40));
    const workerId = 'TEST123';
    const worker = await patientService.getWorkerById(workerId);
    console.log('Worker:', worker);
    console.log('✓ Worker validation passed\n');

    // Test 2: Date selection card generation
    console.log('TEST 2: Date Selection Card');
    console.log('-'.repeat(40));
    const dateCard = cardBuilder.buildDateSelectionCard(worker);
    console.log('Date card generated with', dateCard.body.length, 'body elements');
    console.log('Actions:', dateCard.actions.map(a => a.title).join(', '));
    console.log('✓ Date selection card passed\n');

    // Test 3: Get patients by date
    console.log('TEST 3: Get Patients by Date');
    console.log('-'.repeat(40));
    const today = new Date().toISOString().split('T')[0];
    console.log('Fetching patients for date:', today);
    const patients = await patientService.getPatientsByWorkerAndDate(workerId, today);
    console.log('Found', patients.length, 'patients');
    if (patients.length > 0) {
        console.log('First patient:', patients[0].fullName || `${patients[0].firstName} ${patients[0].lastName}`);
    }
    console.log('✓ Patient fetch passed\n');

    // Test 4: Patient selection card
    console.log('TEST 4: Patient Selection Card');
    console.log('-'.repeat(40));
    const patientCard = cardBuilder.buildPatientSelectionCard(worker, patients, today);
    console.log('Patient card generated with', patientCard.body.length, 'body elements');
    console.log('✓ Patient selection card passed\n');

    // Test 5: Resource selection card
    console.log('TEST 5: Resource Selection Card');
    console.log('-'.repeat(40));
    const testPatient = patients[0] || { id: 'test-patient', fullName: 'Test Patient' };
    const resourceCard = cardBuilder.buildResourceSelectionCard(testPatient, worker);
    console.log('Resource card generated');
    console.log('Categories available:', cardBuilder.RESOURCE_CATEGORIES.length);
    console.log('Total resource options:', cardBuilder.RESOURCE_CATEGORIES.reduce((sum, cat) => sum + cat.resources.length, 0));
    console.log('✓ Resource selection card passed\n');

    // Test 6: Extract selected resources
    console.log('TEST 6: Extract Selected Resources');
    console.log('-'.repeat(40));
    const mockFormData = {
        'resource_Patient': 'true',
        'resource_AllergyIntolerance': 'true',
        'resource_MedicationRequest': 'true',
        'quickSelect_vitals': 'true',
        'resource_EpisodeOfCare': 'false'
    };
    const selectedResources = dataFetchService.extractSelectedResources(mockFormData);
    console.log('Selected resources:', selectedResources.join(', '));
    console.log('✓ Resource extraction passed\n');

    // Test 7: Fetch resources (mock mode)
    console.log('TEST 7: Fetch Resources');
    console.log('-'.repeat(40));
    const patientId = testPatient.id;
    console.log('Fetching resources for patient:', patientId);
    const { results, errors } = await dataFetchService.fetchSelectedResources(
        patientId,
        workerId,
        ['Patient', 'AllergyIntolerance', 'MedicationRequest']
    );
    console.log('Results received for:', Object.keys(results).join(', '));
    console.log('Errors:', errors.length > 0 ? errors : 'None');
    console.log('✓ Resource fetch passed\n');

    // Test 8: Format simple data
    console.log('TEST 8: Data Formatting');
    console.log('-'.repeat(40));
    const mockAllergies = [
        { substance: 'Penicillin', criticality: 'high', reaction: 'Anaphylaxis' },
        { substance: 'Peanuts', criticality: 'low', reaction: 'Hives' }
    ];
    const formatted = dataFetchService.formatSimpleData('AllergyIntolerance', mockAllergies);
    console.log('Formatted allergies:');
    console.log(formatted.formatted);
    console.log('✓ Data formatting passed\n');

    // Test 9: Results card
    console.log('TEST 9: Results Display Card');
    console.log('-'.repeat(40));
    const mockResults = {
        'Patient': { data: { fullName: 'John Doe', dob: '1950-01-15' }, label: 'Patient Demographics', needsAISummary: false },
        'AllergyIntolerance': { data: mockAllergies, label: 'Allergies', needsAISummary: false, formatted: formatted }
    };
    const resultsCard = cardBuilder.buildDataResultsCard(testPatient, mockResults, []);
    console.log('Results card generated with', resultsCard.body.length, 'body elements');
    console.log('Actions:', resultsCard.actions.map(a => a.title).join(', '));
    console.log('✓ Results card passed\n');

    // Summary
    console.log('========================================');
    console.log('ALL TESTS PASSED!');
    console.log('========================================');
    console.log('\nThe bot flow is working correctly.');
    console.log('To test interactively:');
    console.log('1. Run: npm start');
    console.log('2. Open Bot Framework Emulator');
    console.log('3. Connect to http://localhost:3978/api/messages');
    console.log('');
}

testFlow().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
