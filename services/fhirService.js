/**
 * FHIR Service for HCHB
 * High-level functions for querying patient data, episodes, and documents
 *
 * Can use either:
 * - Python backend (preferred) - set USE_PYTHON_BACKEND=true
 * - Direct FHIR calls (fallback)
 */

const { fhirGet } = require('./fhirClient');
const pythonBackend = require('./pythonBackendClient');

// Use Python backend by default, can be disabled via env var
const USE_PYTHON_BACKEND = process.env.USE_PYTHON_BACKEND !== 'false';

/**
 * Helper function to try Python backend first
 * @param {string} resourceId - The resource ID for pythonBackendClient
 * @param {string} patientId - Patient ID (optional)
 * @param {string} workerId - Worker ID (optional)
 * @returns {Array|Object|null} Data from Python backend or null if unavailable
 */
async function tryPythonBackend(resourceId, patientId = null, workerId = null) {
    if (!USE_PYTHON_BACKEND) return null;
    try {
        const result = await pythonBackend.fetchResource(resourceId, patientId, workerId);
        return result?.data || null;
    } catch (error) {
        console.log(`[FHIR] Python backend failed for ${resourceId}, using fallback:`, error.message);
        return null;
    }
}

/**
 * Search for patients by name
 */
async function searchPatients(searchTerm) {
    if (!searchTerm || searchTerm.trim().length < 2) {
        return [];
    }

    try {
        const bundle = await fhirGet('/Patient', {
            name: searchTerm,
            _count: 20
        });

        if (!bundle.entry || bundle.entry.length === 0) {
            return [];
        }

        return bundle.entry.map(entry => transformPatient(entry.resource));
    } catch (error) {
        console.error('[FHIR] Patient search failed:', error.message);
        throw error;
    }
}

/**
 * Get a single patient by FHIR ID
 */
async function getPatientById(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Patient', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        const patient = await fhirGet(`/Patient/${patientId}`);
        return transformPatient(patient);
    } catch (error) {
        if (error.response?.status === 404) return null;
        throw error;
    }
}

/**
 * Get worker/practitioner by ID
 */
async function getWorkerById(workerId) {
    // Try Python backend first
    if (USE_PYTHON_BACKEND) {
        try {
            console.log('[PythonBackend] Validating worker:', workerId);
            const result = await pythonBackend.validateWorker(workerId);
            if (result.valid && result.worker) {
                return result.worker;
            }
            console.log('[PythonBackend] Worker not found, trying direct FHIR');
        } catch (error) {
            console.log('[PythonBackend] Unavailable, falling back to direct FHIR:', error.message);
        }
    }

    // Fallback to direct FHIR
    try {
        console.log('[FHIR] Looking up worker:', workerId);

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
                name: name.text || `${name.given?.[0] || ''} ${name.family || ''}`.trim(),
                active: practitioner.active
            };
        }

        console.log('[FHIR] Worker not found');
        return null;

    } catch (error) {
        console.error('[FHIR] Get worker failed:', error.message);
        return null;
    }
}

/**
 * Get patients with upcoming recertifications
 */
async function getRecertPatients(workerId = null, daysAhead = 30) {
    try {
        console.log('[FHIR] Getting recert patients, daysAhead:', daysAhead);

        const today = new Date();
        const bundle = await fhirGet('/EpisodeOfCare', {
            status: 'active',
            _count: 50,
            _include: 'EpisodeOfCare:patient'
        });

        if (!bundle.entry || bundle.entry.length === 0) {
            return [];
        }

        const episodes = bundle.entry.filter(e => e.resource.resourceType === 'EpisodeOfCare');
        const patients = bundle.entry.filter(e => e.resource.resourceType === 'Patient');

        const patientMap = new Map();
        patients.forEach(p => patientMap.set(`Patient/${p.resource.id}`, p.resource));

        const recertPatients = [];

        for (const entry of episodes) {
            const episode = entry.resource;
            const periodEnd = episode.period?.end;
            if (!periodEnd) continue;

            const endDate = new Date(periodEnd);
            const daysUntilRecert = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
            
            if (daysUntilRecert >= -7 && daysUntilRecert <= daysAhead) {
                const patientRef = episode.patient?.reference;
                let patient = patientMap.get(patientRef);

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
                    recertPatients.push({
                        id: patient.id,
                        episodeId: episode.id,
                        firstName: name.given?.[0] || '',
                        lastName: name.family || '',
                        fullName: name.text || `${name.given?.[0] || ''} ${name.family || ''}`.trim(),
                        dob: patient.birthDate,
                        mrn: extractMRN(patient),
                        primaryDiagnosis: episode.diagnosis?.[0]?.condition?.display || 'Not specified',
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

        recertPatients.sort((a, b) => a.daysUntilRecert - b.daysUntilRecert);
        console.log(`[FHIR] Found ${recertPatients.length} patients with upcoming recerts`);
        return recertPatients;

    } catch (error) {
        console.error('[FHIR] Get recert patients failed:', error.message);
        throw error;
    }
}

/**
 * Get active episodes for a patient
 */
async function getPatientEpisodes(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('EpisodeOfCare', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        const bundle = await fhirGet('/EpisodeOfCare', {
            patient: `Patient/${patientId}`,
            status: 'active'
        });

        if (!bundle.entry || bundle.entry.length === 0) {
            const allBundle = await fhirGet('/EpisodeOfCare', {
                patient: `Patient/${patientId}`,
                _count: 10,
                _sort: '-date'
            });
            if (!allBundle.entry) return [];
            return allBundle.entry.map(e => transformEpisode(e.resource));
        }

        return bundle.entry.map(entry => transformEpisode(entry.resource));
    } catch (error) {
        console.error('[FHIR] Get episodes failed:', error.message);
        throw error;
    }
}

/**
 * Get conditions (diagnoses) for a patient
 */
async function getConditions(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Condition-Diagnoses', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        const bundle = await fhirGet('/Condition', {
            subject: `Patient/${patientId}`,
            'clinical-status': 'active'
        });

        if (!bundle.entry) return [];

        return bundle.entry.map(entry => {
            const condition = entry.resource;
            return {
                id: condition.id,
                code: condition.code?.coding?.[0]?.code,
                display: condition.code?.coding?.[0]?.display || condition.code?.text,
                clinicalStatus: condition.clinicalStatus?.coding?.[0]?.code,
                category: condition.category?.[0]?.coding?.[0]?.display
            };
        });
    } catch (error) {
        console.error('[FHIR] Get conditions failed:', error.message);
        return [];
    }
}

/**
 * Get medications for a patient
 */
async function getMedications(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('MedicationRequest', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        const bundle = await fhirGet('/MedicationRequest', {
            subject: `Patient/${patientId}`,
            status: 'active'
        });

        if (!bundle.entry) return [];

        return bundle.entry.map(entry => {
            const med = entry.resource;
            const dosage = med.dosageInstruction?.[0];
            return {
                id: med.id,
                name: med.medicationCodeableConcept?.text ||
                      med.medicationCodeableConcept?.coding?.[0]?.display || 'Unknown',
                dosage: dosage?.text || '',
                frequency: dosage?.timing?.code?.text || ''
            };
        });
    } catch (error) {
        console.error('[FHIR] Get medications failed:', error.message);
        return [];
    }
}

/**
 * Get encounters (visits) for a patient
 */
async function getEncounters(patientId, limit = 10) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Encounter', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        const bundle = await fhirGet('/Encounter', {
            subject: `Patient/${patientId}`,
            _count: limit,
            _sort: '-date'
        });

        if (!bundle.entry) return [];

        return bundle.entry.map(entry => {
            const encounter = entry.resource;
            return {
                id: encounter.id,
                status: encounter.status,
                type: encounter.type?.[0]?.text || encounter.type?.[0]?.coding?.[0]?.display,
                date: encounter.period?.start,
                reasonCode: encounter.reasonCode?.[0]?.text
            };
        });
    } catch (error) {
        console.error('[FHIR] Get encounters failed:', error.message);
        return [];
    }
}

/**
 * Get care plan goals for a patient
 */
async function getCarePlanGoals(patientId) {
    try {
        const bundle = await fhirGet('/Goal', {
            subject: `Patient/${patientId}`,
            'lifecycle-status': 'active'
        });

        if (!bundle.entry) return [];

        return bundle.entry.map(entry => {
            const goal = entry.resource;
            return {
                id: goal.id,
                description: goal.description?.text,
                status: goal.lifecycleStatus,
                achievementStatus: goal.achievementStatus?.coding?.[0]?.display
            };
        });
    } catch (error) {
        console.error('[FHIR] Get goals failed:', error.message);
        return [];
    }
}

/**
 * Get documents for a patient
 */
async function getDocuments(patientId) {
    try {
        const bundle = await fhirGet('/DocumentReference', {
            subject: `Patient/${patientId}`,
            _count: 50,
            _sort: '-date'
        });

        if (!bundle.entry) return [];

        return bundle.entry.map(entry => {
            const doc = entry.resource;
            return {
                id: doc.id,
                type: doc.type?.text || doc.type?.coding?.[0]?.display,
                date: doc.date,
                author: doc.author?.[0]?.display
            };
        });
    } catch (error) {
        console.error('[FHIR] Get documents failed:', error.message);
        return [];
    }
}

// ============ Allergy Functions ============

/**
 * Get allergy intolerances for a patient
 */
async function getAllergyIntolerances(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('AllergyIntolerance', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        const bundle = await fhirGet('/AllergyIntolerance', {
            patient: `Patient/${patientId}`
        });

        if (!bundle.entry) return [];

        return bundle.entry.map(entry => {
            const allergy = entry.resource;
            return {
                id: allergy.id,
                substance: allergy.code?.coding?.[0]?.display || allergy.code?.text,
                criticality: allergy.criticality,
                severity: allergy.reaction?.[0]?.severity,
                reaction: allergy.reaction?.[0]?.manifestation?.[0]?.coding?.[0]?.display
            };
        });
    } catch (error) {
        console.error('[FHIR] Get allergies failed:', error.message);
        return [];
    }
}

// ============ Observation Functions (Vitals) ============

/**
 * Generic function to get observations by LOINC code
 */
async function getObservationsByCode(patientId, loincCode, limit = 10) {
    try {
        const bundle = await fhirGet('/Observation', {
            subject: `Patient/${patientId}`,
            code: loincCode,
            _count: limit,
            _sort: '-date'
        });

        if (!bundle.entry) return [];

        return bundle.entry.map(entry => {
            const obs = entry.resource;
            return {
                id: obs.id,
                date: obs.effectiveDateTime,
                value: obs.valueQuantity?.value,
                unit: obs.valueQuantity?.unit,
                status: obs.status
            };
        });
    } catch (error) {
        console.error('[FHIR] Get observations failed:', error.message);
        return [];
    }
}

async function getBodyTemperature(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Observation-Temperature', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    return getObservationsByCode(patientId, '8310-5'); // Body temperature
}

async function getBloodPressure(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Observation-BloodPressure', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        const bundle = await fhirGet('/Observation', {
            subject: `Patient/${patientId}`,
            code: '85354-9', // Blood pressure panel
            _count: 10,
            _sort: '-date'
        });

        if (!bundle.entry) return [];

        return bundle.entry.map(entry => {
            const obs = entry.resource;
            const systolic = obs.component?.find(c => c.code?.coding?.[0]?.code === '8480-6');
            const diastolic = obs.component?.find(c => c.code?.coding?.[0]?.code === '8462-4');
            return {
                id: obs.id,
                date: obs.effectiveDateTime,
                systolic: systolic?.valueQuantity?.value,
                diastolic: diastolic?.valueQuantity?.value,
                unit: 'mmHg',
                value: `${systolic?.valueQuantity?.value || '?'}/${diastolic?.valueQuantity?.value || '?'}`
            };
        });
    } catch (error) {
        console.error('[FHIR] Get blood pressure failed:', error.message);
        return [];
    }
}

async function getBodyMass(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Observation-BodyMass', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    return getObservationsByCode(patientId, '39156-5'); // BMI
}

async function getBodyWeight(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Observation-BodyWeight', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    return getObservationsByCode(patientId, '29463-7'); // Body weight
}

async function getHeadCircumference(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Observation-HeadCircumference', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    return getObservationsByCode(patientId, '9843-4'); // Head circumference
}

async function getHeartRate(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Observation-HeartRate', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    return getObservationsByCode(patientId, '8867-4'); // Heart rate
}

async function getOxygenSaturation(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Observation-OxygenSaturation', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    return getObservationsByCode(patientId, '2708-6'); // Oxygen saturation
}

async function getRespiratoryRate(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Observation-RespiratoryRate', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    return getObservationsByCode(patientId, '9279-1'); // Respiratory rate
}

async function getLivingArrangement(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Observation-LivingArrangement', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    return getObservationsByCode(patientId, '63512-8'); // Living arrangement
}

async function getWoundAssessment(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Observation-WoundAssessment', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        const bundle = await fhirGet('/Observation', {
            subject: `Patient/${patientId}`,
            category: 'survey', // Wound assessments are often surveys
            _count: 20,
            _sort: '-date'
        });

        if (!bundle.entry) return [];

        return bundle.entry.filter(e =>
            e.resource.code?.coding?.[0]?.display?.toLowerCase().includes('wound')
        ).map(entry => {
            const obs = entry.resource;
            return {
                id: obs.id,
                date: obs.effectiveDateTime,
                type: obs.code?.coding?.[0]?.display,
                value: obs.valueString || obs.valueCodeableConcept?.text
            };
        });
    } catch (error) {
        console.error('[FHIR] Get wound assessment failed:', error.message);
        return [];
    }
}

async function getWoundAssessmentDetails(patientId) {
    return getWoundAssessment(patientId);
}

// ============ Care Plan Functions ============

async function getAideHomecarePlan(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('CarePlan-AideHomecare', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    return getCarePlanByCategory(patientId, 'aide-homecare');
}

async function getPersonalCarePlan(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('CarePlan-PersonalCare', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    return getCarePlanByCategory(patientId, 'personal-care');
}

async function getCarePlanByCategory(patientId, category) {
    try {
        const bundle = await fhirGet('/CarePlan', {
            subject: `Patient/${patientId}`,
            status: 'active'
        });

        if (!bundle.entry) return [];

        return bundle.entry.map(entry => {
            const plan = entry.resource;
            return {
                id: plan.id,
                title: plan.title || plan.description,
                status: plan.status,
                period: plan.period,
                goals: plan.goal?.map(g => g.reference),
                activities: plan.activity?.length || 0
            };
        });
    } catch (error) {
        console.error('[FHIR] Get care plan failed:', error.message);
        return [];
    }
}

async function getCareTeam(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('CareTeam', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        const bundle = await fhirGet('/CareTeam', {
            subject: `Patient/${patientId}`,
            status: 'active'
        });

        if (!bundle.entry) return [];

        const teams = [];
        for (const entry of bundle.entry) {
            const team = entry.resource;
            const members = team.participant?.map(p => ({
                name: p.member?.display,
                role: p.role?.[0]?.coding?.[0]?.display
            })) || [];
            teams.push({
                id: team.id,
                name: team.name,
                members
            });
        }
        return teams;
    } catch (error) {
        console.error('[FHIR] Get care team failed:', error.message);
        return [];
    }
}

// ============ Document Reference Functions ============

async function getDocumentsByType(patientId, typeCode) {
    try {
        const bundle = await fhirGet('/DocumentReference', {
            subject: `Patient/${patientId}`,
            type: typeCode,
            _count: 20,
            _sort: '-date'
        });

        if (!bundle.entry) return [];

        return bundle.entry.map(entry => {
            const doc = entry.resource;
            return {
                id: doc.id,
                type: doc.type?.text || doc.type?.coding?.[0]?.display,
                date: doc.date,
                author: doc.author?.[0]?.display,
                content: doc.content?.[0]?.attachment?.data || doc.description
            };
        });
    } catch (error) {
        console.error('[FHIR] Get documents by type failed:', error.message);
        return [];
    }
}

async function getCoordinationNotes(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('DocumentReference-CoordinationNote', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    return getDocumentsByType(patientId, 'coordination-note');
}

async function getEpisodeDocuments(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('DocumentReference-EpisodeDocument', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    return getDocumentsByType(patientId, 'episode-document');
}

async function getIDGMeetingNotes(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('DocumentReference-IDGMeetingNote', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    return getDocumentsByType(patientId, 'idg-meeting-note');
}

async function getPatientDocuments(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('DocumentReference-PatientDocument', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    return getDocuments(patientId); // Generic documents
}

async function getPatientSignatures(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('DocumentReference-PatientSignature', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    return getDocumentsByType(patientId, 'patient-signature');
}

async function getTherapyGoalsStatus(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('DocumentReference-TherapyGoalsStatus', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    return getDocumentsByType(patientId, 'therapy-goals-status');
}

async function getVisitDocuments(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('DocumentReference-VisitDocument', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    return getDocumentsByType(patientId, 'visit-document');
}

// ============ Condition Functions ============

async function getWounds(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Condition-Wound', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        const bundle = await fhirGet('/Condition', {
            subject: `Patient/${patientId}`,
            category: 'wound'
        });

        if (!bundle.entry) return [];

        return bundle.entry.map(entry => {
            const condition = entry.resource;
            return {
                id: condition.id,
                code: condition.code?.coding?.[0]?.code,
                display: condition.code?.coding?.[0]?.display || condition.code?.text,
                bodySite: condition.bodySite?.[0]?.coding?.[0]?.display,
                clinicalStatus: condition.clinicalStatus?.coding?.[0]?.code
            };
        });
    } catch (error) {
        console.error('[FHIR] Get wounds failed:', error.message);
        return [];
    }
}

// ============ Appointment Functions ============

async function getPatientVisits(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Appointment-Visit', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        const bundle = await fhirGet('/Appointment', {
            patient: `Patient/${patientId}`,
            _count: 20,
            _sort: '-date'
        });

        if (!bundle.entry) return [];

        return bundle.entry.map(entry => {
            const apt = entry.resource;
            return {
                id: apt.id,
                status: apt.status,
                start: apt.start,
                end: apt.end,
                type: apt.appointmentType?.coding?.[0]?.display
            };
        });
    } catch (error) {
        console.error('[FHIR] Get patient visits failed:', error.message);
        return [];
    }
}

async function getSchedule(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Appointment-Schedule', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    return getPatientVisits(patientId);
}

async function getIDGMeetings(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Appointment-IDG', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        const bundle = await fhirGet('/Appointment', {
            patient: `Patient/${patientId}`,
            'appointment-type': 'idg-meeting',
            _count: 10,
            _sort: '-date'
        });

        if (!bundle.entry) return [];

        return bundle.entry.map(entry => {
            const apt = entry.resource;
            return {
                id: apt.id,
                status: apt.status,
                start: apt.start,
                participants: apt.participant?.map(p => p.actor?.display)
            };
        });
    } catch (error) {
        console.error('[FHIR] Get IDG meetings failed:', error.message);
        return [];
    }
}

// ============ Related Person Functions ============

async function getRelatedPersons(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('RelatedPerson', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        const bundle = await fhirGet('/RelatedPerson', {
            patient: `Patient/${patientId}`
        });

        if (!bundle.entry) return [];

        return bundle.entry.map(entry => {
            const person = entry.resource;
            const name = person.name?.[0] || {};
            return {
                id: person.id,
                name: name.text || `${name.given?.[0] || ''} ${name.family || ''}`.trim(),
                relationship: person.relationship?.[0]?.coding?.[0]?.display,
                phone: person.telecom?.find(t => t.system === 'phone')?.value
            };
        });
    } catch (error) {
        console.error('[FHIR] Get related persons failed:', error.message);
        return [];
    }
}

// ============ Organization Functions ============

async function getAgency() {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Organization-Agency', null);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        const bundle = await fhirGet('/Organization', {
            type: 'prov', // Provider organization
            _count: 1
        });

        if (!bundle.entry || bundle.entry.length === 0) return null;

        const org = bundle.entry[0].resource;
        return {
            id: org.id,
            name: org.name,
            type: 'Agency'
        };
    } catch (error) {
        console.error('[FHIR] Get agency failed:', error.message);
        return null;
    }
}

async function getBranch() {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Organization-Branch', null);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        const bundle = await fhirGet('/Organization', {
            type: 'bus', // Business organization
            _count: 5
        });

        if (!bundle.entry) return [];

        return bundle.entry.map(entry => {
            const org = entry.resource;
            return {
                id: org.id,
                name: org.name,
                type: 'Branch'
            };
        });
    } catch (error) {
        console.error('[FHIR] Get branch failed:', error.message);
        return [];
    }
}

async function getTeam(patientId) {
    return getCareTeam(patientId);
}

async function getPayorSource(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Coverage', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        const bundle = await fhirGet('/Coverage', {
            beneficiary: `Patient/${patientId}`
        });

        if (!bundle.entry) return [];

        return bundle.entry.map(entry => {
            const coverage = entry.resource;
            return {
                id: coverage.id,
                payor: coverage.payor?.[0]?.display,
                type: coverage.type?.coding?.[0]?.display,
                status: coverage.status
            };
        });
    } catch (error) {
        console.error('[FHIR] Get payor source failed:', error.message);
        return [];
    }
}

// ============ Practitioner Functions ============

async function getPhysician(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Practitioner-Physician', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        // Get the patient's general practitioner
        const patient = await fhirGet(`/Patient/${patientId}`);
        const gpRef = patient.generalPractitioner?.[0]?.reference;

        if (!gpRef) return null;

        const practitioner = await fhirGet(`/${gpRef}`);
        const name = practitioner.name?.[0] || {};
        return {
            id: practitioner.id,
            name: name.text || `${name.prefix?.[0] || ''} ${name.given?.[0] || ''} ${name.family || ''}`.trim(),
            specialty: practitioner.qualification?.[0]?.code?.coding?.[0]?.display
        };
    } catch (error) {
        console.error('[FHIR] Get physician failed:', error.message);
        return null;
    }
}

async function getWorker(workerId) {
    return getWorkerById(workerId);
}

// ============ Location Functions ============

async function getServiceLocation(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Location-ServiceLocation', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        const bundle = await fhirGet('/Location', {
            'organization.type': 'prov',
            _count: 5
        });

        if (!bundle.entry) return [];

        return bundle.entry.map(entry => {
            const loc = entry.resource;
            return {
                id: loc.id,
                name: loc.name,
                address: loc.address?.text,
                type: loc.type?.[0]?.coding?.[0]?.display
            };
        });
    } catch (error) {
        console.error('[FHIR] Get service location failed:', error.message);
        return [];
    }
}

async function getWorkerLocation(workerId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Location-WorkerLocation', null, workerId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        const bundle = await fhirGet('/PractitionerRole', {
            practitioner: workerId,
            _include: 'PractitionerRole:location'
        });

        if (!bundle.entry) return [];

        const locations = bundle.entry.filter(e => e.resource.resourceType === 'Location');
        return locations.map(entry => {
            const loc = entry.resource;
            return {
                id: loc.id,
                name: loc.name,
                address: loc.address?.text
            };
        });
    } catch (error) {
        console.error('[FHIR] Get worker location failed:', error.message);
        return [];
    }
}

// ============ Referral & Billing Functions ============

async function getReferralOrders(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('ServiceRequest-ReferralOrder', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        const bundle = await fhirGet('/ServiceRequest', {
            subject: `Patient/${patientId}`,
            category: 'referral',
            _count: 20
        });

        if (!bundle.entry) return [];

        return bundle.entry.map(entry => {
            const req = entry.resource;
            return {
                id: req.id,
                status: req.status,
                intent: req.intent,
                code: req.code?.coding?.[0]?.display,
                authoredOn: req.authoredOn,
                requester: req.requester?.display
            };
        });
    } catch (error) {
        console.error('[FHIR] Get referral orders failed:', error.message);
        return [];
    }
}

async function getAccount(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Account', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    try {
        const bundle = await fhirGet('/Account', {
            subject: `Patient/${patientId}`
        });

        if (!bundle.entry) return [];

        return bundle.entry.map(entry => {
            const acct = entry.resource;
            return {
                id: acct.id,
                status: acct.status,
                name: acct.name,
                type: acct.type?.coding?.[0]?.display,
                servicePeriod: acct.servicePeriod
            };
        });
    } catch (error) {
        console.error('[FHIR] Get account failed:', error.message);
        return [];
    }
}

// ============ Helper Functions ============

function transformPatient(patient) {
    const name = patient.name?.[0] || {};
    return {
        id: patient.id,
        firstName: name.given?.[0] || '',
        lastName: name.family || '',
        fullName: name.text || `${name.given?.[0] || ''} ${name.family || ''}`.trim(),
        dob: patient.birthDate,
        mrn: extractMRN(patient),
        active: patient.active
    };
}

function transformEpisode(episode) {
    return {
        id: episode.id,
        status: episode.status,
        type: episode.type?.[0]?.text,
        patientRef: episode.patient?.reference,
        periodStart: episode.period?.start,
        periodEnd: episode.period?.end
    };
}

function extractMRN(patient) {
    const identifiers = patient.identifier || [];
    const mrnId = identifiers.find(id => 
        id.type?.coding?.[0]?.code === 'MR' ||
        id.system?.includes('mrn')
    );
    return mrnId?.value || identifiers[0]?.value;
}

module.exports = {
    // Patient & Worker
    searchPatients,
    getPatientById,
    getWorkerById,
    getWorker,
    getRecertPatients,

    // Episodes & Encounters
    getPatientEpisodes,
    getEncounters,

    // Conditions
    getConditions,
    getWounds,

    // Medications
    getMedications,

    // Allergies
    getAllergyIntolerances,

    // Care Plans & Goals
    getCarePlanGoals,
    getAideHomecarePlan,
    getPersonalCarePlan,
    getCareTeam,

    // Observations / Vitals
    getBodyTemperature,
    getBloodPressure,
    getBodyMass,
    getBodyWeight,
    getHeadCircumference,
    getHeartRate,
    getOxygenSaturation,
    getRespiratoryRate,
    getLivingArrangement,
    getWoundAssessment,
    getWoundAssessmentDetails,

    // Documents
    getDocuments,
    getCoordinationNotes,
    getEpisodeDocuments,
    getIDGMeetingNotes,
    getPatientDocuments,
    getPatientSignatures,
    getTherapyGoalsStatus,
    getVisitDocuments,

    // Appointments
    getPatientVisits,
    getSchedule,
    getIDGMeetings,

    // Related Persons
    getRelatedPersons,

    // Organizations
    getAgency,
    getBranch,
    getTeam,
    getPayorSource,

    // Practitioners
    getPhysician,

    // Locations
    getServiceLocation,
    getWorkerLocation,

    // Referrals & Billing
    getReferralOrders,
    getAccount,

    // Python Backend utilities
    fetchResourceViaPython: pythonBackend.fetchResource,
    getWorkerPatientsViaPython: pythonBackend.getWorkerPatients,
    batchFetchViaPython: pythonBackend.batchFetch,
    pythonBackendHealthCheck: pythonBackend.healthCheck,
    USE_PYTHON_BACKEND
};
