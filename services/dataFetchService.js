/**
 * Data Fetch Service
 * Orchestrates fetching multiple FHIR resource types for a patient
 * and applies appropriate summarization or formatting.
 */

const fhirService = require('./fhirService');
const { RESOURCE_CATEGORIES } = require('../cards/cardBuilder');

// Quick select mappings
const QUICK_SELECT_RESOURCES = {
    clinical: [
        'Patient',
        'Condition-Diagnoses',
        'MedicationRequest',
        'AllergyIntolerance',
        'CarePlan-PersonalCare',
        'EpisodeOfCare'
    ],
    vitals: [
        'Observation-Temperature',
        'Observation-BloodPressure',
        'Observation-BodyMass',
        'Observation-BodyWeight',
        'Observation-HeadCircumference',
        'Observation-HeartRate',
        'Observation-OxygenSaturation',
        'Observation-RespiratoryRate'
    ],
    documents: [
        'DocumentReference-CoordinationNote',
        'DocumentReference-EpisodeDocument',
        'DocumentReference-IDGMeetingNote',
        'DocumentReference-PatientDocument',
        'DocumentReference-PatientSignature',
        'DocumentReference-TherapyGoalsStatus',
        'DocumentReference-VisitDocument'
    ]
};

// Data types that should be AI-summarized vs simply formatted
const AI_SUMMARY_TYPES = new Set([
    'DocumentReference-CoordinationNote',
    'DocumentReference-EpisodeDocument',
    'DocumentReference-IDGMeetingNote',
    'DocumentReference-PatientDocument',
    'DocumentReference-TherapyGoalsStatus',
    'DocumentReference-VisitDocument',
    'CarePlan-AideHomecare',
    'CarePlan-PersonalCare',
    'Condition-Diagnoses',
    'Condition-Wound',
    'Observation-WoundAssessment',
    'Observation-WoundAssessmentDetails',
    'Observation-LivingArrangement',
    'EpisodeOfCare',
    'Encounter'
]);

// Resource ID to FHIR service method mapping
const RESOURCE_METHOD_MAP = {
    // Patient Info
    'Patient': { method: 'getPatientById', needsPatientId: true },
    'RelatedPerson': { method: 'getRelatedPersons', needsPatientId: true },

    // Allergies
    'AllergyIntolerance': { method: 'getAllergyIntolerances', needsPatientId: true },

    // Appointments
    'Appointment-Visit': { method: 'getPatientVisits', needsPatientId: true },
    'Appointment-Schedule': { method: 'getSchedule', needsPatientId: true },
    'Appointment-IDG': { method: 'getIDGMeetings', needsPatientId: true },

    // Vitals
    'Observation-Temperature': { method: 'getBodyTemperature', needsPatientId: true },
    'Observation-BloodPressure': { method: 'getBloodPressure', needsPatientId: true },
    'Observation-BodyMass': { method: 'getBodyMass', needsPatientId: true },
    'Observation-BodyWeight': { method: 'getBodyWeight', needsPatientId: true },
    'Observation-HeadCircumference': { method: 'getHeadCircumference', needsPatientId: true },
    'Observation-HeartRate': { method: 'getHeartRate', needsPatientId: true },
    'Observation-OxygenSaturation': { method: 'getOxygenSaturation', needsPatientId: true },
    'Observation-RespiratoryRate': { method: 'getRespiratoryRate', needsPatientId: true },

    // Care Plans
    'CarePlan-AideHomecare': { method: 'getAideHomecarePlan', needsPatientId: true },
    'CarePlan-PersonalCare': { method: 'getPersonalCarePlan', needsPatientId: true },
    'CareTeam': { method: 'getCareTeam', needsPatientId: true },

    // Conditions
    'Condition-Diagnoses': { method: 'getConditions', needsPatientId: true },
    'Condition-Wound': { method: 'getWounds', needsPatientId: true },

    // Documents
    'DocumentReference-CoordinationNote': { method: 'getCoordinationNotes', needsPatientId: true },
    'DocumentReference-EpisodeDocument': { method: 'getEpisodeDocuments', needsPatientId: true },
    'DocumentReference-IDGMeetingNote': { method: 'getIDGMeetingNotes', needsPatientId: true },
    'DocumentReference-PatientDocument': { method: 'getPatientDocuments', needsPatientId: true },
    'DocumentReference-PatientSignature': { method: 'getPatientSignatures', needsPatientId: true },
    'DocumentReference-TherapyGoalsStatus': { method: 'getTherapyGoalsStatus', needsPatientId: true },
    'DocumentReference-VisitDocument': { method: 'getVisitDocuments', needsPatientId: true },

    // Episodes
    'EpisodeOfCare': { method: 'getPatientEpisodes', needsPatientId: true },
    'Encounter': { method: 'getEncounters', needsPatientId: true },

    // Other Observations
    'Observation-LivingArrangement': { method: 'getLivingArrangement', needsPatientId: true },
    'Observation-WoundAssessment': { method: 'getWoundAssessment', needsPatientId: true },
    'Observation-WoundAssessmentDetails': { method: 'getWoundAssessmentDetails', needsPatientId: true },

    // Medications
    'MedicationRequest': { method: 'getMedications', needsPatientId: true },

    // Organizations
    'Organization-Agency': { method: 'getAgency', needsPatientId: false },
    'Organization-Branch': { method: 'getBranch', needsPatientId: false },
    'Organization-Team': { method: 'getTeam', needsPatientId: true },
    'Organization-PayorSource': { method: 'getPayorSource', needsPatientId: true },

    // Practitioners
    'Practitioner-Physician': { method: 'getPhysician', needsPatientId: true },
    'Practitioner-Worker': { method: 'getWorker', needsWorkerId: true },

    // Locations
    'Location-ServiceLocation': { method: 'getServiceLocation', needsPatientId: true },
    'Location-WorkerLocation': { method: 'getWorkerLocation', needsWorkerId: true },

    // Referrals & Billing
    'ServiceRequest-ReferralOrder': { method: 'getReferralOrders', needsPatientId: true },
    'Account': { method: 'getAccount', needsPatientId: true }
};

/**
 * Extract selected resources from form data
 * @param {Object} formData - The form data from the Adaptive Card
 * @returns {Array} Array of selected resource IDs
 */
function extractSelectedResources(formData) {
    const selectedResources = [];

    // Check for quick selects first
    if (formData.quickSelect_clinical === 'true') {
        selectedResources.push(...QUICK_SELECT_RESOURCES.clinical);
    }
    if (formData.quickSelect_vitals === 'true') {
        selectedResources.push(...QUICK_SELECT_RESOURCES.vitals);
    }
    if (formData.quickSelect_documents === 'true') {
        selectedResources.push(...QUICK_SELECT_RESOURCES.documents);
    }

    // Check individual resource toggles
    for (const key in formData) {
        if (key.startsWith('resource_') && formData[key] === 'true') {
            const resourceId = key.replace('resource_', '');
            if (!selectedResources.includes(resourceId)) {
                selectedResources.push(resourceId);
            }
        }
    }

    return selectedResources;
}

/**
 * Fetch data for selected resources
 * @param {string} patientId - Patient ID
 * @param {string} workerId - Worker ID (for worker-specific resources)
 * @param {Array} selectedResources - Array of resource IDs to fetch
 * @returns {Object} Results object with data for each resource
 */
async function fetchSelectedResources(patientId, workerId, selectedResources) {
    const results = {};
    const errors = [];

    // Fetch all resources in parallel
    const fetchPromises = selectedResources.map(async (resourceId) => {
        const mapping = RESOURCE_METHOD_MAP[resourceId];

        if (!mapping) {
            console.warn(`[DataFetchService] No mapping found for resource: ${resourceId}`);
            errors.push({ resourceId, error: 'Resource type not supported' });
            return;
        }

        try {
            let data;
            const method = fhirService[mapping.method];

            if (!method) {
                // Method not implemented yet - return placeholder
                console.warn(`[DataFetchService] Method not implemented: ${mapping.method}`);
                data = { placeholder: true, message: 'Data fetch not yet implemented' };
            } else if (mapping.needsWorkerId) {
                data = await method(workerId);
            } else if (mapping.needsPatientId) {
                data = await method(patientId);
            } else {
                data = await method();
            }

            results[resourceId] = {
                data,
                needsAISummary: AI_SUMMARY_TYPES.has(resourceId),
                label: getResourceLabel(resourceId)
            };
        } catch (error) {
            console.error(`[DataFetchService] Error fetching ${resourceId}:`, error.message);
            errors.push({ resourceId, error: error.message });
        }
    });

    await Promise.all(fetchPromises);

    return { results, errors };
}

/**
 * Get the display label for a resource ID
 * @param {string} resourceId - Resource ID
 * @returns {string} Display label
 */
function getResourceLabel(resourceId) {
    for (const category of RESOURCE_CATEGORIES) {
        const resource = category.resources.find(r => r.id === resourceId);
        if (resource) {
            return resource.label;
        }
    }
    return resourceId;
}

/**
 * Check if a resource type needs AI summarization
 * @param {string} resourceId - Resource ID
 * @returns {boolean} True if needs AI summary
 */
function needsAISummary(resourceId) {
    return AI_SUMMARY_TYPES.has(resourceId);
}

/**
 * Format simple data for display (non-AI)
 * @param {string} resourceId - Resource ID
 * @param {*} data - Raw data
 * @returns {Object} Formatted data
 */
function formatSimpleData(resourceId, data) {
    if (!data || (Array.isArray(data) && data.length === 0)) {
        return { isEmpty: true, formatted: 'No data available' };
    }

    // Handle different resource types with appropriate formatting
    switch (resourceId) {
        case 'Patient':
            return formatPatientData(data);
        case 'AllergyIntolerance':
            return formatAllergies(data);
        case 'MedicationRequest':
            return formatMedications(data);
        case 'Observation-Temperature':
        case 'Observation-BloodPressure':
        case 'Observation-BodyWeight':
        case 'Observation-HeartRate':
        case 'Observation-OxygenSaturation':
        case 'Observation-RespiratoryRate':
        case 'Observation-HeadCircumference':
        case 'Observation-BodyMass':
            return formatVitals(resourceId, data);
        case 'CareTeam':
            return formatCareTeam(data);
        default:
            return formatGenericData(data);
    }
}

// Formatting helper functions
function formatPatientData(data) {
    if (!data) return { isEmpty: true, formatted: 'No patient data' };

    const lines = [];
    if (data.fullName || data.name) lines.push(`**Name:** ${data.fullName || data.name}`);
    if (data.dob || data.birthDate) lines.push(`**DOB:** ${data.dob || data.birthDate}`);
    if (data.gender) lines.push(`**Gender:** ${data.gender}`);
    if (data.mrn) lines.push(`**MRN:** ${data.mrn}`);
    if (data.address) lines.push(`**Address:** ${data.address}`);
    if (data.phone) lines.push(`**Phone:** ${data.phone}`);

    return { isEmpty: false, formatted: lines.join('\n') };
}

function formatAllergies(data) {
    if (!data || data.length === 0) return { isEmpty: true, formatted: 'No known allergies' };

    const lines = data.map(allergy => {
        const name = allergy.substance || allergy.code?.text || allergy.code?.coding?.[0]?.display || 'Unknown';
        const severity = allergy.criticality || allergy.severity || '';
        const reaction = allergy.reaction?.[0]?.manifestation?.[0]?.text || '';
        return `- **${name}**${severity ? ` (${severity})` : ''}${reaction ? `: ${reaction}` : ''}`;
    });

    return { isEmpty: false, formatted: lines.join('\n') };
}

function formatMedications(data) {
    if (!data || data.length === 0) return { isEmpty: true, formatted: 'No active medications' };

    const lines = data.map(med => {
        const name = med.name || med.medicationCodeableConcept?.text || 'Unknown medication';
        const dosage = med.dosage || med.dosageInstruction?.[0]?.text || '';
        const frequency = med.frequency || '';
        return `- **${name}**${dosage ? ` - ${dosage}` : ''}${frequency ? ` (${frequency})` : ''}`;
    });

    return { isEmpty: false, formatted: lines.join('\n') };
}

function formatVitals(resourceId, data) {
    if (!data || data.length === 0) return { isEmpty: true, formatted: 'No vitals recorded' };

    const vitalName = resourceId.replace('Observation-', '').replace(/([A-Z])/g, ' $1').trim();

    if (Array.isArray(data)) {
        const lines = data.slice(0, 10).map(vital => {
            const value = vital.value || vital.valueQuantity?.value || '';
            const unit = vital.unit || vital.valueQuantity?.unit || '';
            const date = vital.date || vital.effectiveDateTime || '';
            return `- ${date}: **${value}${unit ? ' ' + unit : ''}**`;
        });
        return { isEmpty: false, formatted: `**${vitalName}**\n${lines.join('\n')}` };
    }

    const value = data.value || data.valueQuantity?.value || '';
    const unit = data.unit || data.valueQuantity?.unit || '';
    return { isEmpty: false, formatted: `**${vitalName}:** ${value}${unit ? ' ' + unit : ''}` };
}

function formatCareTeam(data) {
    if (!data || (Array.isArray(data) && data.length === 0)) {
        return { isEmpty: true, formatted: 'No care team assigned' };
    }

    const members = Array.isArray(data) ? data : [data];
    const lines = members.map(member => {
        const name = member.name || member.member?.display || 'Unknown';
        const role = member.role?.[0]?.coding?.[0]?.display || member.role || '';
        return `- **${name}**${role ? ` (${role})` : ''}`;
    });

    return { isEmpty: false, formatted: lines.join('\n') };
}

function formatGenericData(data) {
    if (!data) return { isEmpty: true, formatted: 'No data available' };

    if (Array.isArray(data)) {
        if (data.length === 0) return { isEmpty: true, formatted: 'No data available' };
        return { isEmpty: false, formatted: `${data.length} record(s) found`, data };
    }

    if (typeof data === 'object') {
        return { isEmpty: false, formatted: JSON.stringify(data, null, 2).substring(0, 500) };
    }

    return { isEmpty: false, formatted: String(data) };
}

module.exports = {
    extractSelectedResources,
    fetchSelectedResources,
    formatSimpleData,
    needsAISummary,
    getResourceLabel,
    QUICK_SELECT_RESOURCES,
    AI_SUMMARY_TYPES,
    RESOURCE_METHOD_MAP
};
