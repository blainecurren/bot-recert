/**
 * Resource Map
 * Maps FHIR resource IDs to fhirService methods, organized by category.
 * Provides a generic dispatcher for fetching any resource type.
 */

const fhirService = require('./fhirService');
const { createLogger } = require('./logger');
const log = createLogger('ResourceMap');

/**
 * Maps resource IDs to fhirService method names.
 * Each value is the function name on fhirService that fetches that resource.
 *
 * Signature conventions:
 *   (patientId)           — most resources
 *   (patientId, flag)     — visits/schedule (filterByValidCodes)
 *   (workerId)            — worker-specific resources
 */
const RESOURCE_METHOD_MAP = {
    // Patient Info
    'Patient':                              'getPatientById',
    'RelatedPerson':                        'getRelatedPersons',

    // Allergies
    'AllergyIntolerance':                   'getAllergyIntolerances',

    // Appointments
    'Appointment-Visit':                    'getPatientVisits',
    'Appointment-Schedule':                 'getSchedule',
    'Appointment-IDG':                      'getIDGMeetings',

    // Vitals
    'Observation-Temperature':              'getBodyTemperature',
    'Observation-BloodPressure':            'getBloodPressure',
    'Observation-BodyMass':                 'getBodyMass',
    'Observation-BodyWeight':               'getBodyWeight',
    'Observation-HeadCircumference':        'getHeadCircumference',
    'Observation-HeartRate':                'getHeartRate',
    'Observation-OxygenSaturation':         'getOxygenSaturation',
    'Observation-RespiratoryRate':          'getRespiratoryRate',

    // Care Plans
    'CarePlan-AideHomecare':                'getAideHomecarePlan',
    'CarePlan-PersonalCare':                'getPersonalCarePlan',
    'CareTeam':                             'getCareTeam',

    // Conditions
    'Condition-Diagnoses':                  'getConditions',
    'Condition-Wound':                      'getWounds',

    // Documents
    'DocumentReference-CoordinationNote':   'getCoordinationNotes',
    'DocumentReference-EpisodeDocument':    'getEpisodeDocuments',
    'DocumentReference-IDGMeetingNote':     'getIDGMeetingNotes',
    'DocumentReference-PatientDocument':    'getPatientDocuments',
    'DocumentReference-PatientSignature':   'getPatientSignatures',
    'DocumentReference-TherapyGoalsStatus': 'getTherapyGoalsStatus',
    'DocumentReference-VisitDocument':      'getVisitDocuments',

    // Episodes & Encounters
    'EpisodeOfCare':                        'getPatientEpisodes',
    'Encounter':                            'getEncounters',

    // Observations (non-vital)
    'Observation-LivingArrangement':        'getLivingArrangement',
    'Observation-WoundAssessment':          'getWoundAssessment',
    'Observation-WoundAssessmentDetails':   'getWoundAssessmentDetails',

    // Medications
    'MedicationRequest':                    'getMedications',

    // Organizations
    'Organization-Agency':                  'getAgency',
    'Organization-Branch':                  'getBranch',
    'Organization-Team':                    'getTeam',
    'Organization-PayorSource':             'getPayorSource',

    // Practitioners
    'Practitioner-Physician':               'getPhysician',
    'Practitioner-Worker':                  'getWorker',

    // Locations
    'Location-ServiceLocation':             'getServiceLocation',
    'Location-WorkerLocation':              'getWorkerLocation',

    // Referrals & Billing
    'ServiceRequest-ReferralOrder':         'getReferralOrders',
    'Account':                              'getAccount',

    // Care Plan Goals (standalone)
    'CarePlanGoals':                        'getCarePlanGoals',
};

/**
 * Resource categories — groups of related resource types with display labels.
 * Ported from cards/cardBuilder.js RESOURCE_CATEGORIES, decoupled from Adaptive Cards.
 */
const RESOURCE_CATEGORIES = [
    {
        name: 'Patient Info',
        resources: [
            { id: 'Patient', label: 'Patient Demographics' },
            { id: 'RelatedPerson', label: 'Episode Contact' }
        ]
    },
    {
        name: 'Allergies',
        resources: [
            { id: 'AllergyIntolerance', label: 'Allergy Intolerance' }
        ]
    },
    {
        name: 'Appointments',
        resources: [
            { id: 'Appointment-Visit', label: 'Patient Visit' },
            { id: 'Appointment-Schedule', label: 'Schedule' },
            { id: 'Appointment-IDG', label: 'IDG Meeting' }
        ]
    },
    {
        name: 'Vitals',
        resources: [
            { id: 'Observation-Temperature', label: 'Body Temperature' },
            { id: 'Observation-BloodPressure', label: 'Blood Pressure' },
            { id: 'Observation-BodyMass', label: 'Body Mass' },
            { id: 'Observation-BodyWeight', label: 'Body Weight' },
            { id: 'Observation-HeadCircumference', label: 'Head Circumference' },
            { id: 'Observation-HeartRate', label: 'Heart Rate' },
            { id: 'Observation-OxygenSaturation', label: 'Oxygen Saturation' },
            { id: 'Observation-RespiratoryRate', label: 'Respiratory Rate' }
        ]
    },
    {
        name: 'Care Plans',
        resources: [
            { id: 'CarePlan-AideHomecare', label: 'Aide Homecare Plan' },
            { id: 'CarePlan-PersonalCare', label: 'Personal Care Plan' },
            { id: 'CareTeam', label: 'Care Team' }
        ]
    },
    {
        name: 'Conditions',
        resources: [
            { id: 'Condition-Diagnoses', label: 'Diagnoses' },
            { id: 'Condition-Wound', label: 'Wound' }
        ]
    },
    {
        name: 'Documents',
        resources: [
            { id: 'DocumentReference-CoordinationNote', label: 'Coordination Note' },
            { id: 'DocumentReference-EpisodeDocument', label: 'Episode Document' },
            { id: 'DocumentReference-IDGMeetingNote', label: 'IDG Meeting Note' },
            { id: 'DocumentReference-PatientDocument', label: 'Patient Document' },
            { id: 'DocumentReference-PatientSignature', label: 'Patient Signature' },
            { id: 'DocumentReference-TherapyGoalsStatus', label: 'Therapy Goals Status' },
            { id: 'DocumentReference-VisitDocument', label: 'Visit Document' }
        ]
    },
    {
        name: 'Episodes & Encounters',
        resources: [
            { id: 'EpisodeOfCare', label: 'Episode of Care' },
            { id: 'Encounter', label: 'Encounter' }
        ]
    },
    {
        name: 'Observations',
        resources: [
            { id: 'Observation-LivingArrangement', label: 'Living Arrangement' },
            { id: 'Observation-WoundAssessment', label: 'Wound Assessment' },
            { id: 'Observation-WoundAssessmentDetails', label: 'Wound Assessment Details' }
        ]
    },
    {
        name: 'Medications',
        resources: [
            { id: 'MedicationRequest', label: 'Medication Request' }
        ]
    },
    {
        name: 'Organizations',
        resources: [
            { id: 'Organization-Agency', label: 'Agency' },
            { id: 'Organization-Branch', label: 'Branch' },
            { id: 'Organization-Team', label: 'Team' },
            { id: 'Organization-PayorSource', label: 'Payor Source' }
        ]
    },
    {
        name: 'Practitioners',
        resources: [
            { id: 'Practitioner-Physician', label: 'Physician' },
            { id: 'Practitioner-Worker', label: 'Worker' }
        ]
    },
    {
        name: 'Locations',
        resources: [
            { id: 'Location-ServiceLocation', label: 'Service Location' },
            { id: 'Location-WorkerLocation', label: 'Worker Location' }
        ]
    },
    {
        name: 'Referrals & Billing',
        resources: [
            { id: 'ServiceRequest-ReferralOrder', label: 'Referral Order' },
            { id: 'Account', label: 'Account' }
        ]
    }
];

/**
 * Flat lookup: resource ID → display label
 */
const RESOURCE_LABELS = {};
for (const category of RESOURCE_CATEGORIES) {
    for (const resource of category.resources) {
        RESOURCE_LABELS[resource.id] = resource.label;
    }
}

// Resources that take workerId instead of (or in addition to) patientId
const WORKER_RESOURCES = new Set([
    'Practitioner-Worker',
    'Location-WorkerLocation',
]);

/**
 * Fetch data for a given resource type.
 * Validates the resource ID and dispatches to the correct fhirService method.
 *
 * @param {string} resourceId - Resource type ID (e.g. 'Condition-Diagnoses')
 * @param {string} patientId - FHIR Patient ID
 * @param {string} [workerId] - Worker ID (needed for worker-specific resources)
 * @returns {Promise<Object>} { data, label }
 */
async function fetchResourceData(resourceId, patientId, workerId) {
    const methodName = RESOURCE_METHOD_MAP[resourceId];
    if (!methodName) {
        const err = new Error(`Unknown resource type: ${resourceId}`);
        err.statusCode = 400;
        throw err;
    }

    const fn = fhirService[methodName];
    if (typeof fn !== 'function') {
        const err = new Error(`No handler for resource type: ${resourceId}`);
        err.statusCode = 500;
        throw err;
    }

    log.debug({ resourceId, methodName }, 'Fetching resource');

    // Dispatch with the right argument based on resource type
    let data;
    if (WORKER_RESOURCES.has(resourceId)) {
        data = await fn(workerId || patientId);
    } else {
        data = await fn(patientId);
    }

    return {
        resourceId,
        label: RESOURCE_LABELS[resourceId] || resourceId,
        data
    };
}

module.exports = {
    RESOURCE_METHOD_MAP,
    RESOURCE_CATEGORIES,
    RESOURCE_LABELS,
    fetchResourceData,
};
