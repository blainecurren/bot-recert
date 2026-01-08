/**
 * FHIR Connection Test Script
 * Run this to verify your HCHB FHIR API connection is working
 * 
 * Usage: node test-fhir.js [patientName]
 * Example: node test-fhir.js Smith
 */

require('dotenv').config();

const { testConnection } = require('./services/fhirClient');
const fhirService = require('./services/fhirService');

async function runTests() {
    console.log('========================================');
    console.log('HCHB FHIR Connection Test');
    console.log('========================================\n');

    // Check environment variables
    console.log('1. Checking environment variables...');
    const requiredVars = [
        'HCHB_CLIENT_ID',
        'HCHB_AGENCY_SECRET',
        'HCHB_TOKEN_URL',
        'HCHB_API_BASE_URL'
    ];

    let missingVars = [];
    requiredVars.forEach(varName => {
        if (!process.env[varName]) {
            missingVars.push(varName);
        } else {
            // Mask secrets in output
            const value = varName.includes('SECRET') 
                ? '***' + process.env[varName].slice(-4) 
                : process.env[varName];
            console.log(`   ✓ ${varName}: ${value}`);
        }
    });

    if (missingVars.length > 0) {
        console.log(`\n   ✗ Missing variables: ${missingVars.join(', ')}`);
        console.log('   Please set these in your .env file');
        process.exit(1);
    }

    console.log('\n2. Testing API connection...');
    const connected = await testConnection();
    
    if (!connected) {
        console.log('   ✗ Connection failed. Check your credentials.');
        process.exit(1);
    }
    console.log('   ✓ Successfully connected to FHIR API\n');

    // If a patient name was provided, search for them
    const searchTerm = process.argv[2];
    
    if (searchTerm) {
        console.log(`3. Searching for patients matching "${searchTerm}"...`);
        try {
            const patients = await fhirService.searchPatients(searchTerm);
            
            if (patients.length === 0) {
                console.log('   No patients found.');
            } else {
                console.log(`   Found ${patients.length} patient(s):\n`);
                
                patients.forEach((patient, i) => {
                    console.log(`   [${i + 1}] ${patient.fullName}`);
                    console.log(`       ID: ${patient.id}`);
                    console.log(`       DOB: ${patient.dob || 'N/A'}`);
                    console.log(`       MRN: ${patient.mrn || 'N/A'}`);
                    console.log('');
                });

                // If we found patients, try to get episodes for the first one
                if (patients.length > 0) {
                    const firstPatient = patients[0];
                    console.log(`4. Getting episodes for ${firstPatient.fullName}...`);
                    
                    try {
                        const episodes = await fhirService.getPatientEpisodes(firstPatient.id);
                        
                        if (episodes.length === 0) {
                            console.log('   No episodes found.');
                        } else {
                            console.log(`   Found ${episodes.length} episode(s):\n`);
                            
                            episodes.forEach((episode, i) => {
                                console.log(`   [${i + 1}] Episode ID: ${episode.id}`);
                                console.log(`       Type: ${episode.type || 'N/A'}`);
                                console.log(`       Status: ${episode.status}`);
                                console.log(`       Period: ${episode.periodStart} to ${episode.periodEnd || 'ongoing'}`);
                                console.log('');
                            });

                            // Get more details for first episode
                            if (episodes.length > 0) {
                                const firstEpisode = episodes[0];
                                console.log(`5. Getting clinical data for episode ${firstEpisode.id}...`);
                                
                                // Get conditions
                                const conditions = await fhirService.getConditions(firstPatient.id);
                                console.log(`   Conditions: ${conditions.length} found`);
                                conditions.slice(0, 3).forEach(c => {
                                    console.log(`     - ${c.display || c.code}`);
                                });

                                // Get medications
                                const meds = await fhirService.getMedications(firstPatient.id);
                                console.log(`   Medications: ${meds.length} found`);
                                meds.slice(0, 3).forEach(m => {
                                    console.log(`     - ${m.name}`);
                                });

                                // Get recent encounters
                                const encounters = await fhirService.getEncounters(firstPatient.id, 5);
                                console.log(`   Recent Visits: ${encounters.length} found`);
                                encounters.slice(0, 3).forEach(e => {
                                    console.log(`     - ${e.date}: ${e.type || 'Visit'}`);
                                });
                            }
                        }
                    } catch (error) {
                        console.log(`   ✗ Error getting episodes: ${error.message}`);
                    }
                }
            }
        } catch (error) {
            console.log(`   ✗ Search failed: ${error.message}`);
        }
    } else {
        console.log('3. To test patient search, run:');
        console.log('   node test-fhir.js <patientLastName>');
        console.log('   Example: node test-fhir.js Smith');
    }

    console.log('\n========================================');
    console.log('Test complete!');
    console.log('========================================');
}

runTests().catch(error => {
    console.error('Test failed with error:', error);
    process.exit(1);
});
