/**
 * FHIR Field Audit Script
 * One-time validation script to probe HCHB FHIR API for each resource type
 * and report which fields are present, null, or absent.
 *
 * Usage: node test-field-audit.js [patientId]
 *   - If no patientId provided, fetches one from the first active EpisodeOfCare
 *
 * Output: JSON report to stdout with field availability per resource type
 */

require('dotenv').config();
const { fhirGet } = require('./services/fhirClient');

const FIELDS_TO_CHECK = {
    Appointment: {
        endpoint: '/Appointment',
        query: (pid) => ({ patient: `Patient/${pid}`, _count: 5, _sort: '-date' }),
        fields: [
            { path: 'reasonCode', extract: (r) => r.reasonCode },
            { path: 'end', extract: (r) => r.end },
            { path: 'description', extract: (r) => r.description },
            { path: 'comment', extract: (r) => r.comment },
            { path: 'start', extract: (r) => r.start },
            { path: 'status', extract: (r) => r.status },
            { path: 'appointmentType', extract: (r) => r.appointmentType },
            { path: 'serviceType', extract: (r) => r.serviceType },
            { path: 'participant', extract: (r) => r.participant },
            { path: 'extension', extract: (r) => r.extension }
        ]
    },
    EpisodeOfCare: {
        endpoint: '/EpisodeOfCare',
        query: (pid) => ({ patient: `Patient/${pid}`, _count: 5 }),
        fields: [
            { path: 'careManager', extract: (r) => r.careManager },
            { path: 'diagnosis (count)', extract: (r) => r.diagnosis?.length },
            { path: 'diagnosis[0]', extract: (r) => r.diagnosis?.[0] },
            { path: 'diagnosis[1+]', extract: (r) => r.diagnosis?.slice(1) },
            { path: 'team[]', extract: (r) => r.team },
            { path: 'account[]', extract: (r) => r.account },
            { path: 'type', extract: (r) => r.type },
            { path: 'status', extract: (r) => r.status },
            { path: 'period', extract: (r) => r.period },
            { path: 'managingOrganization', extract: (r) => r.managingOrganization }
        ]
    },
    DocumentReference: {
        endpoint: '/DocumentReference',
        query: (pid) => ({ subject: `Patient/${pid}`, _count: 10, _sort: '-date' }),
        fields: [
            { path: 'status', extract: (r) => r.status },
            { path: 'author (count)', extract: (r) => r.author?.length },
            { path: 'author[0]', extract: (r) => r.author?.[0] },
            { path: 'author[1+]', extract: (r) => r.author?.slice(1) },
            { path: 'type', extract: (r) => r.type },
            { path: 'date', extract: (r) => r.date },
            { path: 'description', extract: (r) => r.description },
            { path: 'content[0].attachment', extract: (r) => r.content?.[0]?.attachment ? { url: !!r.content[0].attachment.url, contentType: r.content[0].attachment.contentType, title: r.content[0].attachment.title } : null },
            { path: 'category', extract: (r) => r.category },
            { path: 'context', extract: (r) => r.context }
        ]
    },
    Condition: {
        endpoint: '/Condition',
        query: (pid) => ({ subject: `Patient/${pid}`, 'clinical-status': 'active', _count: 10 }),
        fields: [
            { path: 'onsetDateTime', extract: (r) => r.onsetDateTime },
            { path: 'onsetPeriod', extract: (r) => r.onsetPeriod },
            { path: 'recorder', extract: (r) => r.recorder },
            { path: 'asserter', extract: (r) => r.asserter },
            { path: 'code', extract: (r) => r.code },
            { path: 'clinicalStatus', extract: (r) => r.clinicalStatus },
            { path: 'verificationStatus', extract: (r) => r.verificationStatus },
            { path: 'category', extract: (r) => r.category },
            { path: 'bodySite', extract: (r) => r.bodySite },
            { path: 'note', extract: (r) => r.note }
        ]
    },
    AllergyIntolerance: {
        endpoint: '/AllergyIntolerance',
        query: (pid) => ({ patient: `Patient/${pid}`, _count: 10 }),
        fields: [
            { path: 'onsetDateTime', extract: (r) => r.onsetDateTime },
            { path: 'onsetString', extract: (r) => r.onsetString },
            { path: 'note[]', extract: (r) => r.note },
            { path: 'code', extract: (r) => r.code },
            { path: 'criticality', extract: (r) => r.criticality },
            { path: 'reaction', extract: (r) => r.reaction },
            { path: 'clinicalStatus', extract: (r) => r.clinicalStatus },
            { path: 'verificationStatus', extract: (r) => r.verificationStatus },
            { path: 'type', extract: (r) => r.type },
            { path: 'category', extract: (r) => r.category }
        ]
    },
    MedicationRequest: {
        endpoint: '/MedicationRequest',
        query: (pid) => ({ subject: `Patient/${pid}`, status: 'active', _count: 10 }),
        fields: [
            { path: 'authoredOn', extract: (r) => r.authoredOn },
            { path: 'requester', extract: (r) => r.requester },
            { path: 'reasonCode[]', extract: (r) => r.reasonCode },
            { path: 'reasonReference[]', extract: (r) => r.reasonReference },
            { path: 'medicationCodeableConcept', extract: (r) => r.medicationCodeableConcept },
            { path: 'dosageInstruction', extract: (r) => r.dosageInstruction },
            { path: 'status', extract: (r) => r.status },
            { path: 'intent', extract: (r) => r.intent },
            { path: 'recorder', extract: (r) => r.recorder },
            { path: 'note', extract: (r) => r.note }
        ]
    },
    Observation: {
        endpoint: '/Observation',
        query: (pid) => ({ subject: `Patient/${pid}`, code: '85354-9', _count: 5, _sort: '-date' }), // Blood pressure
        fields: [
            { path: 'interpretation[]', extract: (r) => r.interpretation },
            { path: 'note[]', extract: (r) => r.note },
            { path: 'effectiveDateTime', extract: (r) => r.effectiveDateTime },
            { path: 'status', extract: (r) => r.status },
            { path: 'valueQuantity', extract: (r) => r.valueQuantity },
            { path: 'component', extract: (r) => r.component?.map(c => ({ code: c.code?.coding?.[0]?.code, value: c.valueQuantity?.value, interpretation: c.interpretation })) },
            { path: 'referenceRange', extract: (r) => r.referenceRange },
            { path: 'category', extract: (r) => r.category },
            { path: 'dataAbsentReason', extract: (r) => r.dataAbsentReason }
        ]
    },
    Goal: {
        endpoint: '/Goal',
        query: (pid) => ({ subject: `Patient/${pid}`, 'lifecycle-status': 'active', _count: 10 }),
        fields: [
            { path: 'target[]', extract: (r) => r.target },
            { path: 'note[]', extract: (r) => r.note },
            { path: 'description', extract: (r) => r.description },
            { path: 'lifecycleStatus', extract: (r) => r.lifecycleStatus },
            { path: 'achievementStatus', extract: (r) => r.achievementStatus },
            { path: 'startDate', extract: (r) => r.startDate },
            { path: 'statusDate', extract: (r) => r.statusDate },
            { path: 'expressedBy', extract: (r) => r.expressedBy },
            { path: 'addresses[]', extract: (r) => r.addresses },
            { path: 'category', extract: (r) => r.category }
        ]
    },
    CarePlan: {
        endpoint: '/CarePlan',
        query: (pid) => ({ subject: `Patient/${pid}`, status: 'active', _count: 5 }),
        fields: [
            { path: 'activity (count)', extract: (r) => r.activity?.length },
            { path: 'activity[0].detail', extract: (r) => r.activity?.[0]?.detail },
            { path: 'activity[0].reference', extract: (r) => r.activity?.[0]?.reference },
            { path: 'title', extract: (r) => r.title },
            { path: 'description', extract: (r) => r.description },
            { path: 'status', extract: (r) => r.status },
            { path: 'period', extract: (r) => r.period },
            { path: 'goal[]', extract: (r) => r.goal },
            { path: 'category', extract: (r) => r.category },
            { path: 'careTeam[]', extract: (r) => r.careTeam }
        ]
    },
    Practitioner: {
        endpoint: '/Practitioner',
        query: () => ({ _count: 5 }),
        fields: [
            { path: 'telecom[]', extract: (r) => r.telecom },
            { path: 'qualification[]', extract: (r) => r.qualification },
            { path: 'identifier[]', extract: (r) => r.identifier },
            { path: 'name', extract: (r) => r.name },
            { path: 'active', extract: (r) => r.active },
            { path: 'gender', extract: (r) => r.gender },
            { path: 'address', extract: (r) => r.address },
            { path: 'communication', extract: (r) => r.communication }
        ]
    }
};

function classifyValue(val) {
    if (val === undefined) return 'absent';
    if (val === null) return 'null';
    if (Array.isArray(val) && val.length === 0) return 'empty_array';
    if (Array.isArray(val)) return `array(${val.length})`;
    if (typeof val === 'object') return 'object';
    if (typeof val === 'string' && val.length === 0) return 'empty_string';
    return 'present';
}

function sampleValue(val) {
    if (val === undefined || val === null) return null;
    const str = JSON.stringify(val);
    return str.length > 200 ? str.substring(0, 200) + '...' : str;
}

async function findSamplePatient() {
    console.error('No patientId provided, finding a sample patient from active episodes...');
    const bundle = await fhirGet('/EpisodeOfCare', { status: 'active', _count: 1, _include: 'EpisodeOfCare:patient' });
    if (!bundle.entry || bundle.entry.length === 0) {
        throw new Error('No active episodes found. Provide a patientId as argument.');
    }
    const episode = bundle.entry.find(e => e.resource.resourceType === 'EpisodeOfCare');
    const patientRef = episode?.resource?.patient?.reference;
    if (!patientRef) throw new Error('Episode has no patient reference');
    return patientRef.replace('Patient/', '');
}

async function auditResource(resourceName, config, patientId) {
    const result = {
        resource: resourceName,
        endpoint: config.endpoint,
        recordCount: 0,
        fields: {},
        error: null
    };

    try {
        const bundle = await fhirGet(config.endpoint, config.query(patientId));
        const entries = bundle.entry || [];
        result.recordCount = entries.length;

        if (entries.length === 0) {
            for (const field of config.fields) {
                result.fields[field.path] = { status: 'no_records', sample: null };
            }
            return result;
        }

        // Check each field across all returned records
        for (const field of config.fields) {
            let foundPopulated = false;
            let firstSample = null;
            let statuses = [];

            for (const entry of entries) {
                const val = field.extract(entry.resource);
                const status = classifyValue(val);
                statuses.push(status);
                if (!foundPopulated && status !== 'absent' && status !== 'null' && status !== 'empty_array' && status !== 'empty_string') {
                    foundPopulated = true;
                    firstSample = sampleValue(val);
                }
            }

            const populated = statuses.filter(s => s !== 'absent' && s !== 'null' && s !== 'empty_array' && s !== 'empty_string').length;

            result.fields[field.path] = {
                status: foundPopulated ? 'POPULATED' : 'empty_or_absent',
                populatedCount: `${populated}/${entries.length}`,
                sample: firstSample
            };
        }
    } catch (error) {
        result.error = error.message;
    }

    return result;
}

async function main() {
    const patientId = process.argv[2] || await findSamplePatient();
    console.error(`Auditing FHIR fields for patient: ${patientId}\n`);

    const report = {
        patientId,
        timestamp: new Date().toISOString(),
        resources: {}
    };

    for (const [name, config] of Object.entries(FIELDS_TO_CHECK)) {
        console.error(`  Probing ${name}...`);
        report.resources[name] = await auditResource(name, config, patientId);
    }

    // Summary
    const summary = { populated: [], emptyOrAbsent: [], noRecords: [], errors: [] };
    for (const [name, result] of Object.entries(report.resources)) {
        if (result.error) {
            summary.errors.push(`${name}: ${result.error}`);
            continue;
        }
        for (const [field, info] of Object.entries(result.fields)) {
            const key = `${name}.${field}`;
            if (info.status === 'POPULATED') summary.populated.push(key);
            else if (info.status === 'no_records') summary.noRecords.push(key);
            else summary.emptyOrAbsent.push(key);
        }
    }
    report.summary = summary;

    console.log(JSON.stringify(report, null, 2));
    console.error(`\nAudit complete. ${summary.populated.length} populated, ${summary.emptyOrAbsent.length} empty/absent, ${summary.noRecords.length} no records, ${summary.errors.length} errors.`);
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
