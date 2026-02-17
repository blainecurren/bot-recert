/**
 * Data Fetch Service
 * Orchestrates fetching multiple FHIR resource types for a patient
 * and applies appropriate summarization or formatting.
 */

const fhirService = require('./fhirService');
const { RESOURCE_CATEGORIES } = require('../cards/cardBuilder');
const { createLogger } = require('./logger');

const log = createLogger('DataFetchService');

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
    'Organization-Agency': { method: 'getAgency', needsPatientId: true },
    'Organization-Branch': { method: 'getBranch', needsPatientId: true },
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
            log.warn({ resourceId }, 'No mapping found for resource');
            errors.push({ resourceId, error: 'Resource type not supported' });
            return;
        }

        try {
            let data;
            const method = fhirService[mapping.method];

            if (!method) {
                // Method not implemented yet - return placeholder
                log.warn({ method: mapping.method }, 'Method not implemented');
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
            log.error({ err: error, resourceId }, 'Error fetching resource');
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
        case 'RelatedPerson':
            return formatRelatedPerson(data);
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
        case 'Observation-LivingArrangement':
            return formatLivingArrangement(data);
        case 'Observation-WoundAssessment':
        case 'Observation-WoundAssessmentDetails':
            return formatWoundAssessment(data);
        case 'CareTeam':
        case 'Organization-Team':
            return formatCareTeam(data);
        case 'CarePlan-AideHomecare':
        case 'CarePlan-PersonalCare':
            return formatCarePlan(data);
        case 'Condition-Diagnoses':
            return formatDiagnoses(data);
        case 'Condition-Wound':
            return formatWoundCondition(data);
        case 'Organization-Agency':
        case 'Organization-Branch':
            return formatOrganization(data);
        case 'Organization-PayorSource':
            return formatPayorSource(data);
        case 'Appointment-Visit':
        case 'Appointment-Schedule':
        case 'Appointment-IDG':
            return formatAppointments(data);
        case 'EpisodeOfCare':
            return formatEpisodeOfCare(data);
        case 'Encounter':
            return formatEncounters(data);
        case 'Practitioner-Physician':
            return formatPhysician(data);
        case 'Practitioner-Worker':
            return formatWorker(data);
        case 'Location-ServiceLocation':
        case 'Location-WorkerLocation':
            return formatLocation(data);
        case 'ServiceRequest-ReferralOrder':
            return formatReferralOrders(data);
        case 'Account':
            return formatAccount(data);
        case 'DocumentReference-CoordinationNote':
        case 'DocumentReference-EpisodeDocument':
        case 'DocumentReference-IDGMeetingNote':
        case 'DocumentReference-PatientDocument':
        case 'DocumentReference-PatientSignature':
        case 'DocumentReference-TherapyGoalsStatus':
        case 'DocumentReference-VisitDocument':
            return formatDocumentReferences(data);
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

function formatOrganization(data) {
    if (!data) return { isEmpty: true, formatted: 'No organization data' };

    // Handle array of organizations
    const orgs = Array.isArray(data) ? data : [data];

    if (orgs.length === 0) return { isEmpty: true, formatted: 'No organization data' };

    const lines = [];
    orgs.forEach(org => {
        if (org.name) lines.push(`**${org.name}**${org.alias ? ` (${org.alias})` : ''}`);
        if (org.phone) lines.push(`Phone: ${org.phone}`);
        if (org.address) lines.push(`Address: ${org.address}`);
        if (org.type && org.type !== 'Agency' && org.type !== 'Branch' && org.type !== 'branch') {
            lines.push(`Type: ${org.type}`);
        }
    });

    return { isEmpty: false, formatted: lines.join('\n\n') };
}

function formatRelatedPerson(data) {
    if (!data || (Array.isArray(data) && data.length === 0)) {
        return { isEmpty: true, formatted: 'No contacts found' };
    }

    const persons = Array.isArray(data) ? data : [data];
    const lines = persons.map(person => {
        const parts = [`**${person.name || 'Unknown'}**`];
        if (person.relationship) parts.push(`Relationship: ${person.relationship}`);
        if (person.phone) parts.push(`Phone: ${person.phone}`);
        return parts.join('\n');
    });

    return { isEmpty: false, formatted: lines.join('\n\n') };
}

function formatCarePlan(data) {
    if (!data || (Array.isArray(data) && data.length === 0)) {
        return { isEmpty: true, formatted: 'No care plan found' };
    }

    const plans = Array.isArray(data) ? data : [data];
    const lines = plans.map(plan => {
        const parts = [];
        if (plan.title || plan.description) parts.push(`**${plan.title || plan.description}**`);
        if (plan.status) parts.push(`Status: ${plan.status}`);
        if (plan.period) {
            const start = plan.period.start || plan.periodStart || '';
            const end = plan.period.end || plan.periodEnd || '';
            if (start || end) parts.push(`Period: ${start} to ${end}`);
        }
        if (plan.activities) parts.push(`Activities: ${plan.activities}`);
        return parts.join('\n');
    });

    return { isEmpty: false, formatted: lines.join('\n\n') };
}

function formatDiagnoses(data) {
    if (!data || (Array.isArray(data) && data.length === 0)) {
        return { isEmpty: true, formatted: 'No diagnoses found' };
    }

    const conditions = Array.isArray(data) ? data : [data];
    const lines = conditions.map(cond => {
        const name = cond.display || cond.code?.text || cond.code?.coding?.[0]?.display || 'Unknown';
        const code = cond.code?.coding?.[0]?.code || cond.code || '';
        const status = cond.clinicalStatus || '';
        return `- **${name}**${code ? ` (${code})` : ''}${status ? ` - ${status}` : ''}`;
    });

    return { isEmpty: false, formatted: lines.join('\n') };
}

function formatWoundCondition(data) {
    if (!data || (Array.isArray(data) && data.length === 0)) {
        return { isEmpty: true, formatted: 'No wounds documented' };
    }

    const wounds = Array.isArray(data) ? data : [data];
    const lines = wounds.map(wound => {
        const parts = [];
        const name = wound.display || wound.code?.text || 'Wound';
        parts.push(`**${name}**`);
        if (wound.bodySite) parts.push(`Location: ${wound.bodySite}`);
        if (wound.clinicalStatus) parts.push(`Status: ${wound.clinicalStatus}`);
        return parts.join('\n');
    });

    return { isEmpty: false, formatted: lines.join('\n\n') };
}

function formatPayorSource(data) {
    if (!data || (Array.isArray(data) && data.length === 0)) {
        return { isEmpty: true, formatted: 'No payor information found' };
    }

    const payors = Array.isArray(data) ? data : [data];
    const lines = payors.map(payor => {
        const parts = [];
        if (payor.payor) parts.push(`**${payor.payor}**`);
        if (payor.type) parts.push(`Type: ${payor.type}`);
        if (payor.status) parts.push(`Status: ${payor.status}`);
        return parts.join('\n');
    });

    return { isEmpty: false, formatted: lines.join('\n\n') };
}

function formatAppointments(data) {
    if (!data || (Array.isArray(data) && data.length === 0)) {
        return { isEmpty: true, formatted: 'No appointments found' };
    }

    const appointments = Array.isArray(data) ? data : [data];
    const lines = appointments.slice(0, 10).map(apt => {
        const parts = [];
        const date = apt.start || apt.date || '';
        const type = apt.type || apt.appointmentType?.coding?.[0]?.display || '';
        const status = apt.status || '';
        parts.push(`- **${date}**${type ? ` - ${type}` : ''}${status ? ` (${status})` : ''}`);
        if (apt.participants) parts.push(`  Participants: ${apt.participants.join(', ')}`);
        return parts.join('\n');
    });

    return { isEmpty: false, formatted: lines.join('\n') };
}

function formatEpisodeOfCare(data) {
    if (!data || (Array.isArray(data) && data.length === 0)) {
        return { isEmpty: true, formatted: 'No episodes found' };
    }

    const episodes = Array.isArray(data) ? data : [data];
    const lines = episodes.map(ep => {
        const parts = [];
        if (ep.type) parts.push(`**${ep.type}**`);
        if (ep.status) parts.push(`Status: ${ep.status}`);
        const start = ep.periodStart || ep.period?.start || '';
        const end = ep.periodEnd || ep.period?.end || '';
        if (start || end) parts.push(`Period: ${start} to ${end}`);
        return parts.join('\n');
    });

    return { isEmpty: false, formatted: lines.join('\n\n') };
}

function formatEncounters(data) {
    if (!data || (Array.isArray(data) && data.length === 0)) {
        return { isEmpty: true, formatted: 'No encounters found' };
    }

    const encounters = Array.isArray(data) ? data : [data];
    const lines = encounters.slice(0, 10).map(enc => {
        const date = enc.date || enc.period?.start || '';
        const type = enc.type || '';
        const status = enc.status || '';
        const reason = enc.reasonCode || '';
        return `- **${date}**${type ? ` - ${type}` : ''}${status ? ` (${status})` : ''}${reason ? `\n  Reason: ${reason}` : ''}`;
    });

    return { isEmpty: false, formatted: lines.join('\n') };
}

function formatPhysician(data) {
    if (!data) return { isEmpty: true, formatted: 'No physician assigned' };

    const lines = [];
    if (data.name) lines.push(`**${data.name}**`);
    if (data.specialty) lines.push(`Specialty: ${data.specialty}`);
    if (data.phone) lines.push(`Phone: ${data.phone}`);

    return { isEmpty: lines.length === 0, formatted: lines.join('\n') || 'No physician data' };
}

function formatWorker(data) {
    if (!data) return { isEmpty: true, formatted: 'No worker information' };

    const lines = [];
    if (data.name) lines.push(`**${data.name}**`);
    if (data.identifier) lines.push(`ID: ${data.identifier}`);
    if (data.active !== undefined) lines.push(`Status: ${data.active ? 'Active' : 'Inactive'}`);

    return { isEmpty: lines.length === 0, formatted: lines.join('\n') || 'No worker data' };
}

function formatLocation(data) {
    if (!data || (Array.isArray(data) && data.length === 0)) {
        return { isEmpty: true, formatted: 'No location data' };
    }

    const locations = Array.isArray(data) ? data : [data];
    const lines = locations.map(loc => {
        const parts = [];
        if (loc.name) parts.push(`**${loc.name}**`);
        if (loc.type) parts.push(`Type: ${loc.type}`);
        if (loc.address) parts.push(`Address: ${loc.address}`);
        return parts.join('\n');
    });

    return { isEmpty: false, formatted: lines.join('\n\n') };
}

function formatReferralOrders(data) {
    if (!data || (Array.isArray(data) && data.length === 0)) {
        return { isEmpty: true, formatted: 'No referral orders found' };
    }

    const orders = Array.isArray(data) ? data : [data];
    const lines = orders.map(order => {
        const parts = [];
        if (order.code) parts.push(`**${order.code}**`);
        if (order.status) parts.push(`Status: ${order.status}`);
        if (order.intent) parts.push(`Intent: ${order.intent}`);
        if (order.authoredOn) parts.push(`Date: ${order.authoredOn}`);
        if (order.requester) parts.push(`Requester: ${order.requester}`);
        return parts.join('\n');
    });

    return { isEmpty: false, formatted: lines.join('\n\n') };
}

function formatAccount(data) {
    if (!data || (Array.isArray(data) && data.length === 0)) {
        return { isEmpty: true, formatted: 'No account information' };
    }

    const accounts = Array.isArray(data) ? data : [data];
    const lines = accounts.map(acct => {
        const parts = [];
        if (acct.name) parts.push(`**${acct.name}**`);
        if (acct.type) parts.push(`Type: ${acct.type}`);
        if (acct.status) parts.push(`Status: ${acct.status}`);
        if (acct.servicePeriod) {
            const start = acct.servicePeriod.start || '';
            const end = acct.servicePeriod.end || '';
            if (start || end) parts.push(`Service Period: ${start} to ${end}`);
        }
        return parts.join('\n');
    });

    return { isEmpty: false, formatted: lines.join('\n\n') };
}

function formatDocumentReferences(data) {
    if (!data || (Array.isArray(data) && data.length === 0)) {
        return { isEmpty: true, formatted: 'No documents found' };
    }

    const docs = Array.isArray(data) ? data : [data];
    const lines = docs.slice(0, 15).map(doc => {
        const parts = [];
        const type = doc.type || 'Document';
        const date = doc.date || '';
        parts.push(`- **${type}**${date ? ` (${date})` : ''}`);
        if (doc.author) parts.push(`  Author: ${doc.author}`);
        return parts.join('\n');
    });

    return { isEmpty: false, formatted: lines.join('\n') };
}

function formatLivingArrangement(data) {
    if (!data || (Array.isArray(data) && data.length === 0)) {
        return { isEmpty: true, formatted: 'No living arrangement data' };
    }

    const items = Array.isArray(data) ? data : [data];
    const lines = items.map(item => {
        const value = item.value || item.valueString || item.valueCodeableConcept?.text || '';
        const date = item.date || item.effectiveDateTime || '';
        return `- ${date ? `${date}: ` : ''}**${value || 'Unknown'}**`;
    });

    return { isEmpty: false, formatted: lines.join('\n') };
}

function formatWoundAssessment(data) {
    if (!data || (Array.isArray(data) && data.length === 0)) {
        return { isEmpty: true, formatted: 'No wound assessments found' };
    }

    const assessments = Array.isArray(data) ? data : [data];
    const lines = assessments.map(assess => {
        const parts = [];
        const type = assess.type || 'Assessment';
        const date = assess.date || assess.effectiveDateTime || '';
        parts.push(`**${type}**${date ? ` (${date})` : ''}`);
        if (assess.value) parts.push(`Result: ${assess.value}`);
        return parts.join('\n');
    });

    return { isEmpty: false, formatted: lines.join('\n\n') };
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
