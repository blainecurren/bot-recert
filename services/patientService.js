/**
 * Patient Service
 * Handles patient data fetching and search operations.
 * Uses HCHB FHIR API when credentials are configured, falls back to mock data otherwise.
 */

const fhirService = require('./fhirService');
const { fhirGet } = require('./fhirClient');
const mockPatients = require('../data/mockPatients.json');

// Determine if we should use live FHIR or mock data
const USE_FHIR = !!(
    process.env.HCHB_CLIENT_ID &&
    process.env.HCHB_AGENCY_SECRET &&
    process.env.HCHB_TOKEN_URL &&
    process.env.HCHB_API_BASE_URL
);

console.log(`[PatientService] Using ${USE_FHIR ? 'LIVE FHIR API' : 'MOCK DATA'}`);

/**
 * Get worker by ID
 */
async function getWorkerById(workerId) {
    if (!workerId) return null;

    if (USE_FHIR) {
        try {
            console.log('[PatientService] Looking up worker:', workerId);
            
            // Try Practitioner resource
            const bundle = await fhirGet('/Practitioner', {
                identifier: workerId,
                _count: 1
            });

            if (bundle.entry && bundle.entry.length > 0) {
                const practitioner = bundle.entry[0].resource;
                const name = practitioner.name?.[0] || {};
                return {
                    id: practitioner.id,
                    identifier: workerId,
                    name: name.text || `${name.given?.[0] || ''} ${name.family || ''}`.trim() || workerId,
                    active: practitioner.active
                };
            }

            // Fallback: accept any worker ID for testing
            console.log('[PatientService] Worker not found in FHIR, using fallback');
            return {
                id: workerId,
                identifier: workerId,
                name: `Nurse ${workerId}`,
                active: true
            };
        } catch (error) {
            console.error('[PatientService] Worker lookup failed:', error.message);
            // Return fallback worker
            return {
                id: workerId,
                identifier: workerId,
                name: `Nurse ${workerId}`,
                active: true
            };
        }
    }

    // Mock fallback
    return {
        id: workerId,
        identifier: workerId,
        name: `Nurse ${workerId}`,
        active: true
    };
}

/**
 * Get patients with upcoming recertifications for a worker
 */
async function getRecertPatientsByWorker(workerId, daysAhead = 30) {
    if (USE_FHIR) {
        try {
            console.log('[PatientService] Getting recert patients for worker:', workerId);

            const today = new Date();
            
            // Query active episodes
            const bundle = await fhirGet('/EpisodeOfCare', {
                status: 'active',
                _count: 100,
                _include: 'EpisodeOfCare:patient'
            });

            if (!bundle.entry || bundle.entry.length === 0) {
                console.log('[PatientService] No active episodes found');
                return [];
            }

            // Separate episodes and patients
            const episodes = bundle.entry.filter(e => e.resource.resourceType === 'EpisodeOfCare');
            const patients = bundle.entry.filter(e => e.resource.resourceType === 'Patient');

            // Create patient lookup
            const patientMap = new Map();
            patients.forEach(p => patientMap.set(`Patient/${p.resource.id}`, p.resource));

            const recertPatients = [];

            for (const entry of episodes) {
                const episode = entry.resource;
                const periodEnd = episode.period?.end;
                if (!periodEnd) continue;

                const endDate = new Date(periodEnd);
                const daysUntilRecert = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
                
                // Include if within recert window (-7 to +daysAhead)
                if (daysUntilRecert >= -7 && daysUntilRecert <= daysAhead) {
                    const patientRef = episode.patient?.reference;
                    let patient = patientMap.get(patientRef);

                    // Fetch patient if not included
                    if (!patient && patientRef) {
                        try {
                            const patientId = patientRef.replace('Patient/', '');
                            patient = await fhirGet(`/Patient/${patientId}`);
                        } catch (e) {
                            continue;
                        }
                    }

                    if (patient) {
                        const name = patient.name?.[0] || {};
                        const primaryDx = episode.diagnosis?.[0]?.condition?.display;

                        recertPatients.push({
                            id: patient.id,
                            episodeId: episode.id,
                            firstName: name.given?.[0] || '',
                            lastName: name.family || '',
                            fullName: name.text || `${name.given?.[0] || ''} ${name.family || ''}`.trim(),
                            dob: patient.birthDate,
                            primaryDiagnosis: primaryDx || 'Not specified',
                            episodeStart: episode.period?.start,
                            episodeEnd: episode.period?.end,
                            recertDue: episode.period?.end,
                            daysUntilRecert: daysUntilRecert,
                            alertCount: 0,
                            attachmentCount: 0
                        });
                    }
                }
            }

            // Sort by recert due date
            recertPatients.sort((a, b) => a.daysUntilRecert - b.daysUntilRecert);
            console.log(`[PatientService] Found ${recertPatients.length} recert patients`);
            return recertPatients;

        } catch (error) {
            console.error('[PatientService] Get recert patients failed:', error.message);
            return [];
        }
    }

    // Mock fallback - return all mock patients as "recert due"
    return mockPatients.map((p, i) => ({
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        fullName: `${p.firstName} ${p.lastName}`,
        dob: p.dob,
        primaryDiagnosis: p.primaryDiagnosis,
        episodeStart: p.episodeStart,
        episodeEnd: p.episodeEnd,
        recertDue: p.episodeEnd,
        daysUntilRecert: 7 + i * 3,
        alertCount: p.alerts?.length || 0,
        attachmentCount: 5
    }));
}

/**
 * Get patients scheduled for a worker on a specific date
 */
async function getPatientsByWorkerAndDate(workerId, dateStr) {
    if (USE_FHIR) {
        try {
            console.log(`[PatientService] Getting patients for worker ${workerId} on ${dateStr}`);

            // Try different practitioner reference formats
            let bundle = null;
            const practitionerFormats = [
                workerId,
                `Practitioner/${workerId}`,
                workerId.toString()
            ];

            for (const practRef of practitionerFormats) {
                console.log(`[PatientService] Trying practitioner format: ${practRef}`);
                try {
                    bundle = await fhirGet('/Appointment', {
                        practitioner: practRef,
                        date: dateStr,
                        _count: 100,
                        _include: 'Appointment:patient'
                    });
                    if (bundle.entry && bundle.entry.length > 0) {
                        console.log(`[PatientService] Found appointments with format: ${practRef}`);
                        break;
                    }
                } catch (e) {
                    console.log(`[PatientService] Format ${practRef} failed: ${e.message}`);
                }
            }

            if (!bundle || !bundle.entry || bundle.entry.length === 0) {
                console.log('[PatientService] No appointments found for this date in FHIR, returning mock data for testing');
                // Return mock data for testing when no real appointments exist
                return getMockPatientsForDate(workerId, dateStr);
            }

            // Separate appointments and patients
            const appointments = bundle.entry.filter(e => e.resource.resourceType === 'Appointment');
            const patients = bundle.entry.filter(e => e.resource.resourceType === 'Patient');

            // Create patient lookup
            const patientMap = new Map();
            patients.forEach(p => patientMap.set(`Patient/${p.resource.id}`, p.resource));

            const scheduledPatients = [];
            const seenPatientIds = new Set();

            for (const entry of appointments) {
                const appointment = entry.resource;

                // Find patient participant
                const patientParticipant = appointment.participant?.find(p =>
                    p.actor?.reference?.startsWith('Patient/')
                );

                if (!patientParticipant) continue;

                const patientRef = patientParticipant.actor.reference;
                const patientId = patientRef.replace('Patient/', '');

                // Skip if we've already added this patient
                if (seenPatientIds.has(patientId)) continue;
                seenPatientIds.add(patientId);

                let patient = patientMap.get(patientRef);

                // Fetch patient if not included
                if (!patient) {
                    try {
                        patient = await fhirGet(`/Patient/${patientId}`);
                    } catch (e) {
                        continue;
                    }
                }

                if (patient) {
                    const name = patient.name?.[0] || {};
                    const appointmentType = appointment.appointmentType?.coding?.[0]?.display ||
                                           appointment.serviceType?.[0]?.coding?.[0]?.display ||
                                           'Visit';

                    scheduledPatients.push({
                        id: patient.id,
                        appointmentId: appointment.id,
                        firstName: name.given?.[0] || '',
                        lastName: name.family || '',
                        fullName: name.text || `${name.given?.[0] || ''} ${name.family || ''}`.trim(),
                        dob: patient.birthDate,
                        mrn: patient.identifier?.find(id => id.type?.coding?.[0]?.code === 'MR')?.value || patient.id,
                        visitTime: appointment.start ? new Date(appointment.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'TBD',
                        visitType: appointmentType,
                        status: appointment.status
                    });
                }
            }

            // Sort by visit time
            scheduledPatients.sort((a, b) => {
                if (a.visitTime === 'TBD') return 1;
                if (b.visitTime === 'TBD') return -1;
                return a.visitTime.localeCompare(b.visitTime);
            });

            console.log(`[PatientService] Found ${scheduledPatients.length} patients for ${dateStr}`);
            return scheduledPatients;

        } catch (error) {
            console.error('[PatientService] Get patients by date failed:', error.message);
            return [];
        }
    }

    // Mock fallback - return all mock patients with mock visit times
    const visitTimes = ['8:00 AM', '9:30 AM', '11:00 AM', '1:00 PM', '2:30 PM', '4:00 PM'];
    const visitTypes = ['Routine Visit', 'Recert Visit', 'Assessment', 'Follow-up', 'Admission'];

    return mockPatients.map((p, i) => ({
        id: p.id,
        appointmentId: `apt-${p.id}`,
        firstName: p.firstName,
        lastName: p.lastName,
        fullName: `${p.firstName} ${p.lastName}`,
        dob: p.dob,
        mrn: p.mrn || p.id,
        visitTime: visitTimes[i % visitTimes.length],
        visitType: visitTypes[i % visitTypes.length],
        status: 'booked'
    }));
}

/**
 * Search patients by name
 */
async function searchPatients(searchTerm) {
    if (USE_FHIR) {
        return fhirService.searchPatients(searchTerm);
    }

    const term = searchTerm.toLowerCase().trim();
    if (!term) return [];

    const matches = mockPatients.filter(patient => {
        const fullName = `${patient.firstName} ${patient.lastName}`.toLowerCase();
        return fullName.includes(term);
    });

    return matches.map(patient => ({
        id: patient.id,
        firstName: patient.firstName,
        lastName: patient.lastName,
        fullName: `${patient.firstName} ${patient.lastName}`,
        dob: patient.dob,
        primaryDiagnosis: patient.primaryDiagnosis
    }));
}

/**
 * Get a single patient by ID
 */
async function getPatientById(patientId) {
    if (USE_FHIR) {
        return fhirService.getPatientById(patientId);
    }
    return mockPatients.find(p => p.id === patientId) || null;
}

/**
 * Get episode details for a patient
 */
async function getPatientEpisode(patientId) {
    if (USE_FHIR) {
        const episodes = await fhirService.getPatientEpisodes(patientId);
        if (episodes.length === 0) return null;

        const episode = episodes[0];
        const [patient, conditions, medications, encounters, goals] = await Promise.all([
            fhirService.getPatientById(patientId),
            fhirService.getConditions(patientId),
            fhirService.getMedications(patientId),
            fhirService.getEncounters(patientId, 10),
            fhirService.getCarePlanGoals(patientId)
        ]);

        const primaryDx = conditions[0];
        const secondaryDx = conditions.slice(1);

        return {
            patientId: patientId,
            patientName: patient?.fullName || 'Unknown',
            dob: patient?.dob,
            episodeId: episode.id,
            episodeStart: episode.periodStart,
            episodeEnd: episode.periodEnd,
            primaryDiagnosis: primaryDx?.display || 'Not specified',
            secondaryDiagnoses: secondaryDx.map(d => d.display),
            medications: medications.map(m => ({
                name: m.name,
                dose: m.dosage,
                frequency: m.frequency
            })),
            recentVisits: encounters.map(e => ({
                date: e.date,
                type: e.type || 'Visit',
                summary: e.reasonCode || ''
            })),
            goals: goals.map(g => ({
                goal: g.description,
                status: g.achievementStatus || g.status || 'In Progress',
                notes: ''
            })),
            alerts: []
        };
    }

    // Mock fallback
    const patient = mockPatients.find(p => p.id === patientId);
    if (!patient) return null;

    return {
        patientId: patient.id,
        patientName: `${patient.firstName} ${patient.lastName}`,
        dob: patient.dob,
        episodeStart: patient.episodeStart,
        episodeEnd: patient.episodeEnd,
        primaryDiagnosis: patient.primaryDiagnosis,
        secondaryDiagnoses: patient.secondaryDiagnoses || [],
        medications: patient.medications || [],
        recentVisits: patient.recentVisits || [],
        alerts: patient.alerts || [],
        goals: patient.goals || []
    };
}

function isUsingFHIR() {
    return USE_FHIR;
}

/**
 * Get mock patients for testing when FHIR has no appointments
 */
function getMockPatientsForDate(workerId, dateStr) {
    console.log(`[PatientService] Generating mock patients for testing`);

    const visitTimes = ['8:00 AM', '9:30 AM', '11:00 AM', '1:00 PM', '2:30 PM', '4:00 PM'];
    const visitTypes = ['Routine Visit', 'Recert Visit', 'Assessment', 'Follow-up', 'Admission'];

    return mockPatients.slice(0, 4).map((p, i) => ({
        id: p.id,
        appointmentId: `apt-${p.id}-${dateStr}`,
        firstName: p.firstName,
        lastName: p.lastName,
        fullName: `${p.firstName} ${p.lastName}`,
        dob: p.dob,
        mrn: p.mrn || `MRN-${p.id}`,
        visitTime: visitTimes[i % visitTimes.length],
        visitType: visitTypes[i % visitTypes.length],
        status: 'booked',
        isMockData: true
    }));
}

module.exports = {
    getWorkerById,
    getRecertPatientsByWorker,
    getPatientsByWorkerAndDate,
    searchPatients,
    getPatientById,
    getPatientEpisode,
    isUsingFHIR
};
