/**
 * FHIR Service for HCHB
 * High-level functions for querying patient data, episodes, and documents
 *
 * Can use either:
 * - Python backend (opt-in) - set USE_PYTHON_BACKEND=true
 * - Direct FHIR calls (default)
 */

const { fhirGet } = require('./fhirClient');
const pythonBackend = require('./pythonBackendClient');
const { createLogger } = require('./logger');
const log = createLogger('FHIR');

// Python backend is OFF by default — opt in via env var
const USE_PYTHON_BACKEND = process.env.USE_PYTHON_BACKEND === 'true';

/**
 * Valid HCHB Visit Type Codes for filtering appointments
 * Format: [Discipline][Visit#][Modifier]
 * - Disciplines: RN, SN, LVN, PT, OT, ST, MS, HH, HS, PA, CH, BE, BSW, CT, VC
 * - Modifiers: H=Hospice, N=Non-billable, WC=Wound Care, PRN=As-Needed
 */
const VALID_VISIT_TYPE_CODES = new Set([
    // Bereavement/Behavioral
    'BE72H', 'BE72HP', 'BSW11', 'BSW11H', 'BSW11N', 'BSW72H',
    // Medical Social Worker
    'MS01', 'MS01H', 'MS06', 'MS11', 'MS11H', 'MS11N', 'MS19', 'MS70H', 'MS72H', 'MSIH', 'MS-PRN', 'MSPRNH',
    // Chaplain
    'CH01H', 'CH11H', 'CH72H', 'CHPRNH',
    // Certified Therapy (OTA/PTA)
    'CT11', 'CT11H', 'CT11N', 'CT-PRN',
    // Occupational Therapy
    'OT00', 'OT00 (MOD)', 'OT01', 'OT01H', 'OT02', 'OT03', 'OT05', 'OT06', 'OT10', 'OT10N',
    'OT11', 'OT11H', 'OT15', 'OT17', 'OT18', 'OT19', 'OT33', 'OT88', 'OT99', 'OT-PRN', 'OTACOURT', 'OTCOURTESY',
    // Physical Therapy
    'PT00', 'PT01', 'PT01H', 'PT02', 'PT03', 'PT05', 'PT06', 'PT10', 'PT10N',
    'PT11', 'PT11H', 'PT11N', 'PT15', 'PT17', 'PT18', 'PT19', 'PT19H', 'PT33', 'PT88', 'PT99', 'PT-PRN', 'PTACOURT', 'PTCOURTESY',
    // Physical Therapy Assistant
    'PA11', 'PA11H', 'PA11N', 'PA-PRN',
    // Registered Nurse
    'RN00', 'RN00H', 'RN01', 'RN02', 'RN02H', 'RN03', 'RN05', 'RN06', 'RN10', 'RN10H', 'RN10-WC',
    'RN11', 'RN11H', 'RN11H-HIAC', 'RN11WC', 'RN15', 'RN18', 'RN18H', 'RN19', 'RN26', 'RN70H', 'RN72H',
    'RN88', 'RN88H', 'RN88HN', 'RN-PRN', 'RN-PRNH', 'RN-URPHA', 'RN10N-AIDE',
    // Skilled Nursing
    'SN11', 'SN11H', 'SN11H-HIAC', 'SN11N', 'SN11RS', 'SN11RSHOSP', 'SN11WC', 'SN70H', 'SN88H',
    'SN-PRN', 'SN-PRNH', 'SNCOURTESY', 'SNIH',
    'SN11P', 'SN93', 'SN-FREQREV', 'SN-RECREQ', 'INF-LOG-FU', 'SN-TELECOM',
    // Licensed Vocational Nurse
    'LVN11', 'LVN11WC', 'LVN-PRN', 'LVN11P',
    // Home Health Aide
    'HH11', 'HH11N',
    // Hospice Support/Aide
    'HS11H', 'HS70H',
    // Speech Therapy
    'ST00', 'ST01', 'ST01H', 'ST02', 'ST03', 'ST05', 'ST06', 'ST10', 'ST10N',
    'ST11', 'ST11H', 'ST11N', 'ST15', 'ST17', 'ST18', 'ST19', 'ST33', 'ST88', 'ST99', 'ST-PRN',
    // Virtual Care
    'VC01H', 'VC11H'
]);

/**
 * Check if an appointment type code is valid
 * @param {string} code - The appointment type code
 * @returns {boolean} True if valid
 */
function isValidVisitTypeCode(code) {
    if (!code) return false;
    // Normalize code - trim and uppercase for comparison
    const normalizedCode = code.trim().toUpperCase();
    // Check exact match first
    if (VALID_VISIT_TYPE_CODES.has(code)) return true;
    if (VALID_VISIT_TYPE_CODES.has(normalizedCode)) return true;
    // Check case-insensitive
    for (const validCode of VALID_VISIT_TYPE_CODES) {
        if (validCode.toUpperCase() === normalizedCode) return true;
    }
    return false;
}

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
        const data = result?.data;
        // Return null if no data or empty array so FHIR fallback runs
        if (!data || (Array.isArray(data) && data.length === 0)) return null;
        return data;
    } catch (error) {
        log.debug({ resourceId, err: error }, 'Python backend failed, using fallback');
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
        log.error({ err: error }, 'Patient search failed');
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
 * Get worker/practitioner by ID (simple FHIR lookup)
 * Note: For full validation with Python backend fallbacks, use workerLookup.getWorkerById
 */
async function getWorkerById(workerId) {
    try {
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

        return null;
    } catch (error) {
        log.error({ err: error }, 'Get worker failed');
        return null;
    }
}

/**
 * Get patients with upcoming recertifications
 */
async function getRecertPatients(workerId = null, daysAhead = 30) {
    try {
        log.info({ daysAhead }, 'Getting recert patients');

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
        log.info({ count: recertPatients.length }, 'Found patients with upcoming recerts');
        return recertPatients;

    } catch (error) {
        log.error({ err: error }, 'Get recert patients failed');
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
        log.error({ err: error }, 'Get episodes failed');
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
                category: condition.category?.[0]?.coding?.[0]?.display,
                onsetDateTime: condition.onsetDateTime || null
            };
        });
    } catch (error) {
        log.error({ err: error }, 'Get conditions failed');
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
                frequency: dosage?.timing?.code?.text || '',
                authoredOn: med.authoredOn || null,
                requester: med.requester?.display || med.requester?.reference || null,
                reasonCode: med.reasonCode?.[0]?.text || med.reasonCode?.[0]?.coding?.[0]?.display || null
            };
        });
    } catch (error) {
        log.error({ err: error }, 'Get medications failed');
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
        log.error({ err: error }, 'Get encounters failed');
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
                achievementStatus: goal.achievementStatus?.coding?.[0]?.display,
                targets: (goal.target || []).map(t => ({
                    measure: t.measure?.coding?.[0]?.display || t.measure?.text,
                    dueDate: t.dueDate || null,
                    detailString: t.detailString || null,
                    detailQuantity: t.detailQuantity
                        ? `${t.detailQuantity.value} ${t.detailQuantity.unit || ''}`
                        : null
                })),
                notes: (goal.note || []).map(n => n.text).filter(Boolean)
            };
        });
    } catch (error) {
        log.error({ err: error }, 'Get goals failed');
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

        return bundle.entry.map(entry => transformDocumentReference(entry.resource));
    } catch (error) {
        log.error({ err: error }, 'Get documents failed');
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
                reaction: allergy.reaction?.[0]?.manifestation?.[0]?.coding?.[0]?.display,
                onsetDateTime: allergy.onsetDateTime || null,
                note: allergy.note?.[0]?.text || null
            };
        });
    } catch (error) {
        log.error({ err: error }, 'Get allergies failed');
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
                status: obs.status,
                interpretation: obs.interpretation?.[0]?.coding?.[0]?.display
                    || obs.interpretation?.[0]?.text || null,
                note: obs.note?.[0]?.text || null
            };
        });
    } catch (error) {
        log.error({ err: error }, 'Get observations failed');
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
                value: `${systolic?.valueQuantity?.value || '?'}/${diastolic?.valueQuantity?.value || '?'}`,
                interpretation: obs.interpretation?.[0]?.coding?.[0]?.display
                    || obs.interpretation?.[0]?.text || null,
                note: obs.note?.[0]?.text || null
            };
        });
    } catch (error) {
        log.error({ err: error }, 'Get blood pressure failed');
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
        log.error({ err: error }, 'Get wound assessment failed');
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
                activities: plan.activity?.length || 0,
                activityDetails: (plan.activity || []).slice(0, 10).map(a => ({
                    description: a.detail?.description || a.detail?.code?.text
                        || a.detail?.code?.coding?.[0]?.display || null,
                    status: a.detail?.status || null,
                    scheduledString: a.detail?.scheduledString || null,
                    kind: a.detail?.kind || null,
                    reference: a.reference?.reference || null
                })).filter(a => a.description || a.reference)
            };
        });
    } catch (error) {
        log.error({ err: error }, 'Get care plan failed');
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
        log.error({ err: error }, 'Get care team failed');
        return [];
    }
}

// ============ Document Reference Functions ============

async function getDocumentsByType(patientId, typeCode) {
    // First try querying FHIR with the type filter
    try {
        const bundle = await fhirGet('/DocumentReference', {
            subject: `Patient/${patientId}`,
            type: typeCode,
            _count: 20,
            _sort: '-date'
        });

        if (bundle.entry && bundle.entry.length > 0) {
            return bundle.entry.map(entry => transformDocumentReference(entry.resource));
        }
    } catch (error) {
        log.debug({ typeCode, err: error }, 'Type-filtered query failed, falling back to all docs');
    }

    // Fallback: fetch all documents and return them (HCHB uses numeric type codes, not string codes)
    log.debug({ typeCode }, 'No results with type filter, fetching all documents');
    return getDocuments(patientId);
}

async function getCoordinationNotes(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('DocumentReference-CoordinationNote', patientId);
    if (pythonData) return pythonData;

    // Fallback: fetch all documents and filter for note types with content
    // HCHB uses types like NARRATIVE, COMMUNICATION NOTE, etc. not "coordination-note"
    const allDocs = await getDocuments(patientId);
    const noteTypes = ['NARRATIVE', 'COMMUNICATION NOTE', 'COORDINATION NOTE', 'INTERNAL COMMUNICATION'];
    return allDocs.filter(doc => {
        const hasContent = doc.url || doc.content;
        const isNoteType = !doc.type || noteTypes.some(t => doc.type?.toUpperCase().includes(t));
        return hasContent && isNoteType;
    }).slice(0, 10); // Limit to 10 for performance
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
                clinicalStatus: condition.clinicalStatus?.coding?.[0]?.code,
                onsetDateTime: condition.onsetDateTime || null
            };
        });
    } catch (error) {
        log.error({ err: error }, 'Get wounds failed');
        return [];
    }
}

// ============ Appointment Functions ============

async function getPatientVisits(patientId, filterByValidCodes = true) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Appointment-Visit', patientId);
    if (pythonData) {
        // Filter Python data if needed
        if (filterByValidCodes && Array.isArray(pythonData)) {
            return pythonData.filter(apt => isValidVisitTypeCode(apt.typeCode || apt.code));
        }
        return pythonData;
    }

    // Fallback to direct FHIR
    try {
        const bundle = await fhirGet('/Appointment', {
            patient: `Patient/${patientId}`,
            _count: 50,
            _sort: '-date'
        });

        if (!bundle.entry) return [];

        const appointments = bundle.entry.map(entry => {
            const apt = entry.resource;
            const typeCode = apt.appointmentType?.coding?.[0]?.code || '';
            const typeDisplay = apt.appointmentType?.coding?.[0]?.display || typeCode;
            return {
                id: apt.id,
                status: apt.status,
                start: apt.start,
                end: apt.end,
                typeCode: typeCode,
                type: typeDisplay,
                reasonCode: apt.reasonCode?.[0]?.text
                    || apt.reasonCode?.[0]?.coding?.[0]?.display || null,
                description: apt.description || null
            };
        });

        // Filter to only valid visit type codes
        if (filterByValidCodes) {
            const filtered = appointments.filter(apt => isValidVisitTypeCode(apt.typeCode));
            log.debug({ filtered: filtered.length, total: appointments.length }, 'Filtered appointments by visit type');
            return filtered;
        }

        return appointments;
    } catch (error) {
        log.error({ err: error }, 'Get patient visits failed');
        return [];
    }
}

async function getSchedule(patientId, filterByValidCodes = true) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Appointment-Schedule', patientId);
    if (pythonData) {
        if (filterByValidCodes && Array.isArray(pythonData)) {
            return pythonData.filter(apt => isValidVisitTypeCode(apt.typeCode || apt.code));
        }
        return pythonData;
    }

    // Fallback to direct FHIR
    return getPatientVisits(patientId, filterByValidCodes);
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
        log.error({ err: error }, 'Get IDG meetings failed');
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
        log.error({ err: error }, 'Get related persons failed');
        return [];
    }
}

// ============ Organization Functions ============

async function getAgency(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Organization-Agency', patientId);
    if (pythonData) return pythonData;

    // Get agency from patient's managing organization
    try {
        if (patientId) {
            const patient = await fhirGet(`/Patient/${patientId}`);
            if (patient.managingOrganization?.reference) {
                const orgId = patient.managingOrganization.reference.replace('Organization/', '');
                const org = await fhirGet(`/Organization/${orgId}`);
                return {
                    id: org.id,
                    name: org.name,
                    alias: org.alias?.[0],
                    phone: org.telecom?.find(t => t.system === 'phone')?.value,
                    address: formatAddress(org.address?.[0]),
                    type: org.type?.[0]?.coding?.[0]?.code || 'Agency'
                };
            }
        }

        // Fallback: search for branch type organizations
        const bundle = await fhirGet('/Organization', {
            type: 'branch',
            _count: 1
        });

        if (!bundle.entry || bundle.entry.length === 0) return null;

        const org = bundle.entry[0].resource;
        return {
            id: org.id,
            name: org.name,
            alias: org.alias?.[0],
            phone: org.telecom?.find(t => t.system === 'phone')?.value,
            address: formatAddress(org.address?.[0]),
            type: 'Agency'
        };
    } catch (error) {
        log.error({ err: error }, 'Get agency failed');
        return null;
    }
}

// Helper to format address
function formatAddress(addr) {
    if (!addr) return null;
    const parts = [];
    if (addr.line) parts.push(addr.line.join(', '));
    if (addr.city) parts.push(addr.city);
    if (addr.state) parts.push(addr.state);
    if (addr.postalCode) parts.push(addr.postalCode);
    return parts.join(', ');
}

async function getBranch(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('Organization-Branch', patientId);
    if (pythonData) return pythonData;

    // Get from patient's managing organization first
    try {
        if (patientId) {
            const patient = await fhirGet(`/Patient/${patientId}`);
            if (patient.managingOrganization?.reference) {
                const orgId = patient.managingOrganization.reference.replace('Organization/', '');
                const org = await fhirGet(`/Organization/${orgId}`);
                return [{
                    id: org.id,
                    name: org.name,
                    alias: org.alias?.[0],
                    phone: org.telecom?.find(t => t.system === 'phone')?.value,
                    address: formatAddress(org.address?.[0]),
                    type: 'Branch'
                }];
            }
        }

        // Fallback: search for branch type organizations
        const bundle = await fhirGet('/Organization', {
            type: 'branch',
            _count: 5
        });

        if (!bundle.entry) return [];

        return bundle.entry.map(entry => {
            const org = entry.resource;
            return {
                id: org.id,
                name: org.name,
                alias: org.alias?.[0],
                phone: org.telecom?.find(t => t.system === 'phone')?.value,
                address: formatAddress(org.address?.[0]),
                type: 'Branch'
            };
        });
    } catch (error) {
        log.error({ err: error }, 'Get branch failed');
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
        log.error({ err: error }, 'Get payor source failed');
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
            specialty: practitioner.qualification?.[0]?.code?.coding?.[0]?.display,
            phone: practitioner.telecom?.find(t => t.system === 'phone')?.value || null,
            email: practitioner.telecom?.find(t => t.system === 'email')?.value || null,
            qualifications: (practitioner.qualification || []).map(q =>
                q.code?.coding?.[0]?.display || q.code?.text
            ).filter(Boolean)
        };
    } catch (error) {
        log.error({ err: error }, 'Get physician failed');
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
        log.error({ err: error }, 'Get service location failed');
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
        log.error({ err: error }, 'Get worker location failed');
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
        log.error({ err: error }, 'Get referral orders failed');
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
        log.error({ err: error }, 'Get account failed');
        return [];
    }
}

// ============ Patient Scheduling ============

/**
 * Get patients scheduled for a worker on a specific date
 * Ported from patientService.getPatientsByWorkerAndDate
 */
async function getPatientsByWorkerAndDate(workerId, dateStr) {
    // Try Python backend first
    if (USE_PYTHON_BACKEND) {
        try {
            log.debug({ workerId, dateStr }, 'Getting patients via Python backend');
            const result = await pythonBackend.getWorkerPatients(workerId, dateStr);
            if (result.data && result.data.length > 0) {
                // Filter by valid visit type codes
                const totalCount = result.data.length;
                const filtered = result.data.filter(patient => {
                    const visitTypeCode = patient.visitTypeCode || patient.visitType?.split(' ')?.[0] || '';
                    return isValidVisitTypeCode(visitTypeCode);
                });
                log.info({ filtered: totalCount - filtered.length, total: totalCount }, 'Filtered patients by visit type');
                return filtered;
            }
            log.debug('No patients from Python backend, trying FHIR');
        } catch (error) {
            log.debug({ err: error }, 'Python backend unavailable');
        }
    }

    // Fallback to direct FHIR
    try {
        log.debug({ workerId, dateStr }, 'Getting patients via FHIR');

        let bundle = null;
        try {
            bundle = await fhirGet('/Appointment', {
                actor: `Practitioner/${workerId}`,
                date: dateStr,
                _count: 100
            });
        } catch (e) {
            log.debug({ err: e }, 'Appointment query failed');
        }

        if (!bundle || !bundle.entry || bundle.entry.length === 0) {
            log.debug('No appointments found for this date');
            return [];
        }

        const totalAppointments = bundle.entry.length;
        log.debug({ totalAppointments }, 'Appointments found');

        const scheduledPatients = [];
        const seenPatientIds = new Set();
        let skippedCount = 0;

        for (const entry of bundle.entry) {
            const appointment = entry.resource;

            // Get service type code (discipline-specific: SN11, RN10, LVN11WC, etc.)
            const serviceTypeCode = appointment.serviceType?.[0]?.coding?.[0]?.code || '';
            const serviceTypeDisplay = appointment.serviceType?.[0]?.coding?.[0]?.display || '';
            const appointmentTypeCode = appointment.appointmentType?.coding?.[0]?.code || '';

            log.debug({ appointmentId: appointment.id, serviceTypeCode, serviceTypeDisplay, appointmentTypeCode }, 'Processing appointment');

            // Filter by serviceType code (discipline-specific codes like SN11, RN10, LVN11WC)
            if (!isValidVisitTypeCode(serviceTypeCode)) {
                log.debug({ serviceTypeCode }, 'Skipping appointment with invalid service type');
                skippedCount++;
                continue;
            }

            // HCHB stores patient in extension, not participant
            let patientRef = null;

            // First try extension
            const subjectExt = appointment.extension?.find(ext =>
                ext.url === 'https://api.hchb.com/fhir/r4/StructureDefinition/subject'
            );
            if (subjectExt && subjectExt.valueReference?.reference) {
                patientRef = subjectExt.valueReference.reference;
            }

            // Fallback to participant if no extension
            if (!patientRef) {
                const patientParticipant = appointment.participant?.find(p =>
                    p.actor?.reference?.startsWith('Patient/')
                );
                if (patientParticipant) {
                    patientRef = patientParticipant.actor.reference;
                }
            }

            if (!patientRef) continue;

            const patientId = patientRef.replace('Patient/', '');

            // Skip if we've already added this patient
            if (seenPatientIds.has(patientId)) continue;
            seenPatientIds.add(patientId);

            // Fetch patient details
            let patient = null;
            try {
                patient = await fhirGet(`/Patient/${patientId}`);
            } catch (e) {
                log.debug({ patientId, err: e }, 'Failed to fetch patient');
                continue;
            }

            if (patient) {
                const name = patient.name?.[0] || {};
                // Use serviceType for visit type display (more specific discipline codes)
                const svcCode = appointment.serviceType?.[0]?.coding?.[0]?.code || '';
                const svcDisplay = appointment.serviceType?.[0]?.coding?.[0]?.display || '';
                const visitType = svcCode && svcDisplay
                    ? `${svcCode} - ${svcDisplay}`
                    : svcDisplay || svcCode || 'Visit';

                // Build name with fallbacks
                const firstName = name.given?.[0] || '';
                const lastName = name.family || '';
                let fullName = name.text || `${firstName} ${lastName}`.trim();

                if (!fullName) {
                    fullName = `Patient ${patient.id}`;
                    log.warn({ patientId: patient.id }, 'No name found for patient');
                }

                // Extract visit reason from appointment
                const reasonCode = appointment.reasonCode?.[0]?.text
                    || appointment.reasonCode?.[0]?.coding?.[0]?.display || null;

                scheduledPatients.push({
                    id: patient.id,
                    appointmentId: appointment.id,
                    firstName: firstName || fullName.split(' ')[0] || 'Unknown',
                    lastName: lastName || fullName.split(' ').slice(1).join(' ') || '',
                    fullName: fullName,
                    dob: patient.birthDate,
                    mrn: patient.identifier?.find(id => id.type?.coding?.[0]?.code === 'MR')?.value || patient.id,
                    visitTime: appointment.start ? new Date(appointment.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'TBD',
                    visitType: visitType,
                    visitReason: reasonCode,
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

        log.info({ patientCount: scheduledPatients.length, dateStr, skipped: skippedCount, total: totalAppointments }, 'Patients loaded');
        return scheduledPatients;

    } catch (error) {
        log.error({ err: error }, 'Get patients by date failed');
        return [];
    }
}

// ============ Helper Functions ============

function transformDocumentReference(doc) {
    const attachment = doc.content?.[0]?.attachment || {};
    return {
        id: doc.id,
        type: doc.type?.text || doc.type?.coding?.[0]?.display,
        date: doc.date ? doc.date.split('T')[0] : null,
        author: doc.author?.[0]?.display,
        authors: (doc.author || []).map(a => a.display).filter(Boolean),
        status: doc.status || null,
        description: doc.description,
        content: attachment.data || doc.description,
        url: attachment.url || null,
        contentType: attachment.contentType || null,
        filename: attachment.title || null,
        hasAttachment: !!attachment.url
    };
}

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
        periodEnd: episode.period?.end,
        careManager: episode.careManager?.display || episode.careManager?.reference || null,
        primaryDiagnosis: episode.diagnosis?.[0]?.condition?.display || null,
        diagnoses: (episode.diagnosis || []).map(d => ({
            display: d.condition?.display || d.condition?.reference,
            role: d.role?.coding?.[0]?.display,
            rank: d.rank
        }))
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
    getPatientsByWorkerAndDate,

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

    // Config flags
    USE_PYTHON_BACKEND,

    // Visit Type Code utilities
    isValidVisitTypeCode,
    VALID_VISIT_TYPE_CODES
};
