/**
 * Patient Service
 * Handles patient data fetching and search operations.
 * Uses Python backend (preferred), falls back to HCHB FHIR API.
 */

const fhirService = require('./fhirService');
const { fhirGet } = require('./fhirClient');
const pythonBackend = require('./pythonBackendClient');
const { createLogger } = require('./logger');

const log = createLogger('PatientService');

// Use Python backend by default
const USE_PYTHON_BACKEND = process.env.USE_PYTHON_BACKEND !== 'false';

log.info({ usePythonBackend: USE_PYTHON_BACKEND }, 'Backend mode');

/**
 * Get worker by ID
 */
async function getWorkerById(workerId) {
    if (!workerId) return null;

    // Try Python backend first
    if (USE_PYTHON_BACKEND) {
        try {
            log.debug({ workerId }, 'Validating worker via Python backend');
            const result = await pythonBackend.validateWorker(workerId);
            if (result.valid && result.worker) {
                return result.worker;
            }
            log.debug('Worker not found in Python backend, trying FHIR');
        } catch (error) {
            log.debug({ err: error }, 'Python backend unavailable');
        }
    }

    // Fallback to direct FHIR
    try {
        log.debug({ workerId }, 'Looking up worker');

        // Try 1: Search by identifier
        let bundle = await fhirGet('/Practitioner', {
            identifier: workerId,
            _count: 1
        });

        // Try 2: Search by _id (resource ID)
        if (!bundle.entry || bundle.entry.length === 0) {
            log.debug('Not found by identifier, trying _id');
            bundle = await fhirGet('/Practitioner', {
                _id: workerId,
                _count: 1
            });
        }

        // Try 3: Direct fetch by resource ID
        if (!bundle.entry || bundle.entry.length === 0) {
            log.debug('Not found by _id, trying direct fetch');
            try {
                const practitioner = await fhirGet(`/Practitioner/${workerId}`);
                if (practitioner && practitioner.id) {
                    const name = practitioner.name?.[0] || {};
                    return {
                        id: practitioner.id,
                        identifier: workerId,
                        name: name.text || `${name.given?.[0] || ''} ${name.family || ''}`.trim() || workerId,
                        active: practitioner.active
                    };
                }
            } catch (e) {
                // Not found by direct fetch, continue
            }
        }

        // Try 4: Search by name (if workerId looks like a name)
        if (!bundle.entry || bundle.entry.length === 0) {
            log.debug('Not found by ID, trying name search');
            bundle = await fhirGet('/Practitioner', {
                name: workerId,
                _count: 1
            });
        }

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

        log.debug('Worker not found');
        return null;
    } catch (error) {
        log.error({ err: error }, 'Worker lookup failed');
        return null;
    }
}

/**
 * Get patients with upcoming recertifications for a worker
 */
async function getRecertPatientsByWorker(workerId, daysAhead = 30) {
    try {
        log.info({ workerId }, 'Getting recert patients');

        const today = new Date();

        // Query active episodes
        const bundle = await fhirGet('/EpisodeOfCare', {
            status: 'active',
            _count: 100,
            _include: 'EpisodeOfCare:patient'
        });

        if (!bundle.entry || bundle.entry.length === 0) {
            log.debug('No active episodes found');
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
        log.info({ count: recertPatients.length }, 'Recert patients found');
        return recertPatients;

    } catch (error) {
        log.error({ err: error }, 'Get recert patients failed');
        return [];
    }
}

/**
 * Get patients scheduled for a worker on a specific date
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
                    const isValid = fhirService.isValidVisitTypeCode(visitTypeCode);
                    if (!isValid) {
                        log.debug({ visitType: patient.visitType }, 'Filtering out patient with invalid visit type');
                    }
                    return isValid;
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

        // Use 'actor' parameter which works with HCHB API
        log.debug({ workerId, dateStr }, 'Querying appointments');
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
            if (!fhirService.isValidVisitTypeCode(serviceTypeCode)) {
                log.debug({ serviceTypeCode }, 'Skipping appointment with invalid service type');
                skippedCount++;
                continue;
            }

            // HCHB stores patient in extension, not participant
            // Look for extension with url "https://api.hchb.com/fhir/r4/StructureDefinition/subject"
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
                // Format: "SN11 - SN SUBSEQUENT VISIT" or just the display if no code
                const visitType = svcCode && svcDisplay
                    ? `${svcCode} - ${svcDisplay}`
                    : svcDisplay || svcCode || 'Visit';

                log.debug({ patientId: patient.id, hasGiven: !!name.given?.[0], hasFamily: !!name.family, hasText: !!name.text }, 'Patient name fields');

                // Build name with fallbacks
                const firstName = name.given?.[0] || '';
                const lastName = name.family || '';
                let fullName = name.text || `${firstName} ${lastName}`.trim();

                // If no name available, use patient ID as fallback
                if (!fullName) {
                    fullName = `Patient ${patient.id}`;
                    log.warn({ patientId: patient.id }, 'No name found for patient');
                }

                // Extract visit reason from appointment
                const reasonCode = appointment.reasonCode?.[0]?.text
                    || appointment.reasonCode?.[0]?.coding?.[0]?.display || null;

                const patientData = {
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
                };
                log.debug({ patientId: patientData.id }, 'Adding patient');
                scheduledPatients.push(patientData);
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

/**
 * Search patients by name
 */
async function searchPatients(searchTerm) {
    return fhirService.searchPatients(searchTerm);
}

/**
 * Get a single patient by ID
 */
async function getPatientById(patientId) {
    return fhirService.getPatientById(patientId);
}

/**
 * Get episode details for a patient
 */
async function getPatientEpisode(patientId) {
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
        careManager: episode.careManager || null,
        primaryDiagnosis: primaryDx?.display || 'Not specified',
        secondaryDiagnoses: secondaryDx.map(d => d.display),
        episodeDiagnoses: episode.diagnoses || [],
        medications: medications.map(m => ({
            name: m.name,
            dose: m.dosage,
            frequency: m.frequency,
            authoredOn: m.authoredOn || null,
            requester: m.requester || null
        })),
        recentVisits: encounters.map(e => ({
            date: e.date,
            type: e.type || 'Visit',
            summary: e.reasonCode || ''
        })),
        goals: goals.map(g => ({
            goal: g.description,
            status: g.achievementStatus || g.status || 'In Progress',
            notes: (g.notes || []).join('; '),
            targets: g.targets || []
        })),
        alerts: []
    };
}

module.exports = {
    getWorkerById,
    getRecertPatientsByWorker,
    getPatientsByWorkerAndDate,
    searchPatients,
    getPatientById,
    getPatientEpisode
};
