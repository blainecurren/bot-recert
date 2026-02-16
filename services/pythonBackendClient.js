/**
 * Python Backend Client
 * HTTP client for calling the Python HCHB FHIR Backend API
 */

const axios = require('axios');

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8000/api/v1';
const PYTHON_BACKEND_TIMEOUT = parseInt(process.env.PYTHON_BACKEND_TIMEOUT) || 30000;

const client = axios.create({
    baseURL: PYTHON_BACKEND_URL,
    timeout: PYTHON_BACKEND_TIMEOUT,
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    }
});

// Request interceptor for logging
client.interceptors.request.use(
    request => {
        console.log(`[PythonBackend] ${request.method.toUpperCase()} ${request.url}`);
        return request;
    },
    error => {
        console.error('[PythonBackend] Request error:', error.message);
        return Promise.reject(error);
    }
);

// Response interceptor for error handling
client.interceptors.response.use(
    response => {
        console.log(`[PythonBackend] Response: ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`);
        return response;
    },
    error => {
        if (error.response) {
            console.error(`[PythonBackend] Error ${error.response.status}:`, error.response.data?.detail || error.message);
        } else if (error.request) {
            console.error('[PythonBackend] No response received:', error.message);
        } else {
            console.error('[PythonBackend] Error:', error.message);
        }
        return Promise.reject(error);
    }
);

/**
 * Check if Python backend is available
 */
async function healthCheck() {
    try {
        const response = await client.get('/health');
        return response.data;
    } catch (error) {
        return { status: 'unavailable', error: error.message };
    }
}

/**
 * Resource ID to Python endpoint mapping
 */
const RESOURCE_ENDPOINT_MAP = {
    // Patient Info
    'Patient': (patientId) => `/patients/${patientId}`,
    'RelatedPerson': (patientId) => `/patients/${patientId}/related-persons`,

    // Allergies
    'AllergyIntolerance': (patientId) => `/patients/${patientId}/allergies`,

    // Conditions
    'Condition-Diagnoses': (patientId) => `/patients/${patientId}/conditions`,
    'Condition-Wound': (patientId) => `/patients/${patientId}/conditions/wounds`,

    // Vitals
    'Observation-Temperature': (patientId) => `/patients/${patientId}/vitals/temperature`,
    'Observation-BloodPressure': (patientId) => `/patients/${patientId}/vitals/blood-pressure`,
    'Observation-BodyMass': (patientId) => `/patients/${patientId}/vitals/body-mass`,
    'Observation-BodyWeight': (patientId) => `/patients/${patientId}/vitals/body-weight`,
    'Observation-HeadCircumference': (patientId) => `/patients/${patientId}/vitals/head-circumference`,
    'Observation-HeartRate': (patientId) => `/patients/${patientId}/vitals/heart-rate`,
    'Observation-OxygenSaturation': (patientId) => `/patients/${patientId}/vitals/oxygen-saturation`,
    'Observation-RespiratoryRate': (patientId) => `/patients/${patientId}/vitals/respiratory-rate`,
    'Observation-LivingArrangement': (patientId) => `/patients/${patientId}/vitals/living-arrangement`,
    'Observation-WoundAssessment': (patientId) => `/patients/${patientId}/vitals/wound-assessment`,

    // Documents
    'DocumentReference-CoordinationNote': (patientId) => `/patients/${patientId}/documents/coordination-note`,
    'DocumentReference-EpisodeDocument': (patientId) => `/patients/${patientId}/documents/episode-document`,
    'DocumentReference-IDGMeetingNote': (patientId) => `/patients/${patientId}/documents/idg-meeting-note`,
    'DocumentReference-PatientDocument': (patientId) => `/patients/${patientId}/documents/patient-document`,
    'DocumentReference-PatientSignature': (patientId) => `/patients/${patientId}/documents/patient-signature`,
    'DocumentReference-TherapyGoalsStatus': (patientId) => `/patients/${patientId}/documents/therapy-goals-status`,
    'DocumentReference-VisitDocument': (patientId) => `/patients/${patientId}/documents/visit-document`,

    // Care Plans
    'CarePlan-AideHomecare': (patientId) => `/patients/${patientId}/care-plans/aide-homecare`,
    'CarePlan-PersonalCare': (patientId) => `/patients/${patientId}/care-plans/personal-care`,
    'CareTeam': (patientId) => `/patients/${patientId}/care-team`,

    // Episodes & Encounters
    'EpisodeOfCare': (patientId) => `/patients/${patientId}/episodes`,
    'Encounter': (patientId) => `/patients/${patientId}/encounters`,

    // Medications
    'MedicationRequest': (patientId) => `/patients/${patientId}/medications`,

    // Appointments
    'Appointment-Visit': (patientId) => `/patients/${patientId}/appointments/visit`,
    'Appointment-Schedule': (patientId) => `/patients/${patientId}/appointments/schedule`,
    'Appointment-IDG': (patientId) => `/patients/${patientId}/appointments/idg`,

    // Organizations (no patient ID needed)
    'Organization-Agency': () => `/organizations/agency`,
    'Organization-Branch': () => `/organizations/branches`,
    'Organization-Team': (patientId) => `/patients/${patientId}/care-team`,
    'Organization-PayorSource': () => `/organizations/payor-sources`,
    'Coverage': (patientId) => `/patients/${patientId}/coverage`,

    // Practitioners
    'Practitioner-Physician': (patientId) => `/patients/${patientId}/physician`,
    'Practitioner-Worker': (_, workerId) => `/workers/${workerId}`,

    // Locations
    'Location-ServiceLocation': (patientId) => `/patients/${patientId}/service-location`,
    'Location-WorkerLocation': (_, workerId) => `/workers/${workerId}/location`,

    // Referrals & Billing
    'ServiceRequest-ReferralOrder': (patientId) => `/patients/${patientId}/referrals`,
    'Account': (patientId) => `/patients/${patientId}/account`
};

/**
 * Fetch a resource from the Python backend
 */
async function fetchResource(resourceId, patientId, workerId) {
    const endpointFn = RESOURCE_ENDPOINT_MAP[resourceId];
    if (!endpointFn) {
        throw new Error(`Unknown resource type: ${resourceId}`);
    }

    const endpoint = endpointFn(patientId, workerId);
    try {
        const response = await client.get(endpoint);
        return response.data;
    } catch (error) {
        if (error.response?.status === 404) {
            return { data: [], count: 0 };
        }
        throw error;
    }
}

/**
 * Validate a worker ID
 */
async function validateWorker(workerId) {
    try {
        const response = await client.get(`/workers/${workerId}/validate`);
        return response.data;
    } catch (error) {
        return {
            valid: false,
            worker: null,
            message: error.response?.data?.detail || error.message
        };
    }
}

/**
 * Get patients for a worker on a specific date
 */
async function getWorkerPatients(workerId, date) {
    try {
        const response = await client.get(`/workers/${workerId}/patients`, {
            params: { visit_date: date }
        });
        return response.data;
    } catch (error) {
        console.error('[PythonBackend] Get worker patients failed:', error.message);
        return { data: [], count: 0 };
    }
}

/**
 * Batch fetch multiple resources for a patient
 */
async function batchFetch(patientId, resourceIds) {
    try {
        const response = await client.post(`/patients/${patientId}/batch`, resourceIds);
        return response.data;
    } catch (error) {
        console.error('[PythonBackend] Batch fetch failed:', error.message);
        return { results: {}, errors: resourceIds.map(r => ({ resource: r, error: error.message })) };
    }
}

module.exports = {
    client,
    healthCheck,
    fetchResource,
    validateWorker,
    getWorkerPatients,
    batchFetch,
    RESOURCE_ENDPOINT_MAP
};
