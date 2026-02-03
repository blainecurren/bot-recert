# Services Reference

This document provides detailed documentation for all 8 services in the Bot-Recert application.

## Table of Contents

1. [fhirClient.js](#fhirclientjs)
2. [fhirService.js](#fhirservicejs)
3. [patientService.js](#patientservicejs)
4. [dataFetchService.js](#datafetchservicejs)
5. [documentService.js](#documentservicejs)
6. [azureOpenAIService.js](#azureopenaiservicejs)
7. [summaryService.js](#summaryservicejs)
8. [pythonBackendClient.js](#pythonbackendclientjs)

---

## fhirClient.js

**Purpose**: OAuth2 authentication and HTTP client for HCHB FHIR R4 API.

**Lines**: ~240

### Token Management

The client implements token caching with automatic refresh:

```javascript
let tokenCache = {
    accessToken: null,
    expiresAt: null
};
```

### Functions

#### `getAccessToken()`

Obtains OAuth2 access token from HCHB IDP.

```javascript
async function getAccessToken(): Promise<string>
```

- Uses `agency_auth` grant type
- Caches tokens with 5-minute buffer before expiry
- Required env vars: `HCHB_TOKEN_URL`, `HCHB_CLIENT_ID`, `HCHB_AGENCY_SECRET`, `HCHB_RESOURCE_SECURITY_ID`

**Returns**: Access token string

---

#### `fhirGet(endpoint, params)`

Makes authenticated GET request to FHIR API.

```javascript
async function fhirGet(endpoint: string, params?: object): Promise<object>
```

**Parameters**:
- `endpoint` - API endpoint (e.g., `/Patient`)
- `params` - Query parameters object

**Returns**: FHIR response data

**Features**:
- Automatic token refresh on 401
- Logging of requests

---

#### `fhirPost(endpoint, data)`

Makes authenticated POST request to FHIR API.

```javascript
async function fhirPost(endpoint: string, data: object): Promise<object>
```

**Parameters**:
- `endpoint` - API endpoint
- `data` - Request body

**Returns**: FHIR response data

---

#### `testConnection()`

Tests FHIR API connectivity.

```javascript
async function testConnection(): Promise<boolean>
```

**Returns**: `true` if connection successful

---

#### `clearTokenCache()`

Clears the cached token (useful for testing).

```javascript
function clearTokenCache(): void
```

---

#### `getTokenStatus()`

Returns current token status for debugging.

```javascript
function getTokenStatus(): { status: string, message: string, expiresIn?: number }
```

---

## fhirService.js

**Purpose**: High-level functions for querying patient data, episodes, and documents.

**Lines**: ~1,411

### Configuration

```javascript
const USE_PYTHON_BACKEND = process.env.USE_PYTHON_BACKEND !== 'false';
```

### Visit Type Codes

Validates HCHB visit type codes for filtering appointments:

```javascript
const VALID_VISIT_TYPE_CODES = new Set([
    'SN11', 'RN10', 'PT11', 'OT11', 'ST11', 'LVN11', ...
]);
```

### Core Functions

#### Patient & Worker Functions

| Function | Parameters | Returns | Description |
|----------|------------|---------|-------------|
| `searchPatients(searchTerm)` | `string` | `Patient[]` | Search patients by name |
| `getPatientById(patientId)` | `string` | `Patient` | Get single patient by FHIR ID |
| `getWorkerById(workerId)` | `string` | `Worker` | Get practitioner by ID |
| `getRecertPatients(workerId?, daysAhead?)` | `string, number` | `Patient[]` | Get patients with upcoming recerts |

#### Episode & Encounter Functions

| Function | Parameters | Returns | Description |
|----------|------------|---------|-------------|
| `getPatientEpisodes(patientId)` | `string` | `Episode[]` | Get active episodes |
| `getEncounters(patientId, limit?)` | `string, number` | `Encounter[]` | Get visits/encounters |

#### Clinical Data Functions

| Function | Parameters | Returns | Description |
|----------|------------|---------|-------------|
| `getConditions(patientId)` | `string` | `Condition[]` | Get diagnoses |
| `getWounds(patientId)` | `string` | `Condition[]` | Get wound conditions |
| `getMedications(patientId)` | `string` | `Medication[]` | Get active medications |
| `getAllergyIntolerances(patientId)` | `string` | `Allergy[]` | Get allergies |

#### Vital Signs Functions

| Function | LOINC Code | Description |
|----------|------------|-------------|
| `getBodyTemperature(patientId)` | 8310-5 | Body temperature |
| `getBloodPressure(patientId)` | 85354-9 | Blood pressure panel |
| `getBodyMass(patientId)` | 39156-5 | BMI |
| `getBodyWeight(patientId)` | 29463-7 | Body weight |
| `getHeartRate(patientId)` | 8867-4 | Heart rate |
| `getOxygenSaturation(patientId)` | 2708-6 | O2 saturation |
| `getRespiratoryRate(patientId)` | 9279-1 | Respiratory rate |
| `getHeadCircumference(patientId)` | 9843-4 | Head circumference |

#### Care Plan Functions

| Function | Parameters | Returns | Description |
|----------|------------|---------|-------------|
| `getAideHomecarePlan(patientId)` | `string` | `CarePlan[]` | Aide homecare plan |
| `getPersonalCarePlan(patientId)` | `string` | `CarePlan[]` | Personal care plan |
| `getCareTeam(patientId)` | `string` | `CareTeam[]` | Care team members |
| `getCarePlanGoals(patientId)` | `string` | `Goal[]` | Care plan goals |

#### Document Functions

| Function | Parameters | Returns | Description |
|----------|------------|---------|-------------|
| `getDocuments(patientId)` | `string` | `Document[]` | All documents |
| `getCoordinationNotes(patientId)` | `string` | `Document[]` | Coordination notes |
| `getEpisodeDocuments(patientId)` | `string` | `Document[]` | Episode documents |
| `getIDGMeetingNotes(patientId)` | `string` | `Document[]` | IDG meeting notes |
| `getPatientDocuments(patientId)` | `string` | `Document[]` | Patient documents |
| `getVisitDocuments(patientId)` | `string` | `Document[]` | Visit documents |

#### Organization Functions

| Function | Parameters | Returns | Description |
|----------|------------|---------|-------------|
| `getAgency(patientId)` | `string` | `Organization` | Patient's agency |
| `getBranch(patientId)` | `string` | `Organization[]` | Branch info |
| `getPayorSource(patientId)` | `string` | `Coverage[]` | Insurance/payor |

#### Appointment Functions

| Function | Parameters | Returns | Description |
|----------|------------|---------|-------------|
| `getPatientVisits(patientId, filterByValidCodes?)` | `string, boolean` | `Appointment[]` | Patient visits |
| `getSchedule(patientId, filterByValidCodes?)` | `string, boolean` | `Appointment[]` | Schedule |
| `getIDGMeetings(patientId)` | `string` | `Appointment[]` | IDG meetings |

### Fallback Pattern

All functions follow this pattern:

```javascript
async function getXxx(patientId) {
    // Try Python backend first
    const pythonData = await tryPythonBackend('ResourceType', patientId);
    if (pythonData) return pythonData;

    // Fallback to direct FHIR
    const bundle = await fhirGet('/Resource', { patient: patientId });
    return transformResults(bundle);
}
```

---

## patientService.js

**Purpose**: Patient queries and business logic layer.

**Lines**: ~429

### Functions

#### `getWorkerById(workerId)`

Validates and retrieves worker information.

```javascript
async function getWorkerById(workerId: string): Promise<Worker|null>
```

**Search Strategy**:
1. Python backend validation
2. FHIR search by identifier
3. FHIR search by `_id`
4. Direct FHIR fetch
5. FHIR search by name

**Returns**: Worker object or null

---

#### `getRecertPatientsByWorker(workerId, daysAhead?)`

Gets patients with upcoming recertifications.

```javascript
async function getRecertPatientsByWorker(
    workerId: string,
    daysAhead?: number = 30
): Promise<Patient[]>
```

**Parameters**:
- `workerId` - Worker identifier
- `daysAhead` - Days ahead to search (default: 30)

**Returns**: Array of patients sorted by recert due date

---

#### `getPatientsByWorkerAndDate(workerId, dateStr)`

Gets patients scheduled for a worker on a specific date.

```javascript
async function getPatientsByWorkerAndDate(
    workerId: string,
    dateStr: string
): Promise<Patient[]>
```

**Parameters**:
- `workerId` - Worker identifier
- `dateStr` - Date in YYYY-MM-DD format

**Features**:
- Filters by valid visit type codes
- Extracts patient from HCHB extension or participant
- Sorts by visit time

**Returns**: Array of scheduled patients

---

#### `searchPatients(searchTerm)`

Searches patients by name.

```javascript
async function searchPatients(searchTerm: string): Promise<Patient[]>
```

---

#### `getPatientById(patientId)`

Gets a single patient by ID.

```javascript
async function getPatientById(patientId: string): Promise<Patient>
```

---

#### `getPatientEpisode(patientId)`

Gets comprehensive episode details for a patient.

```javascript
async function getPatientEpisode(patientId: string): Promise<EpisodeDetails|null>
```

**Returns**: Object containing:
- Patient info
- Episode dates
- Primary/secondary diagnoses
- Medications
- Recent visits
- Goals
- Alerts

---

## dataFetchService.js

**Purpose**: Orchestrates fetching multiple FHIR resource types and applies formatting.

**Lines**: ~720

### Quick Select Mappings

```javascript
const QUICK_SELECT_RESOURCES = {
    clinical: ['Patient', 'Condition-Diagnoses', 'MedicationRequest', ...],
    vitals: ['Observation-Temperature', 'Observation-BloodPressure', ...],
    documents: ['DocumentReference-CoordinationNote', ...]
};
```

### AI Summary Types

Resources that require AI summarization:

```javascript
const AI_SUMMARY_TYPES = new Set([
    'DocumentReference-*',
    'CarePlan-*',
    'Condition-*',
    'EpisodeOfCare',
    'Encounter'
]);
```

### Resource Method Map

Maps resource IDs to fhirService methods:

```javascript
const RESOURCE_METHOD_MAP = {
    'Patient': { method: 'getPatientById', needsPatientId: true },
    'Observation-BloodPressure': { method: 'getBloodPressure', needsPatientId: true },
    'Practitioner-Worker': { method: 'getWorker', needsWorkerId: true },
    // ... 40+ mappings
};
```

### Functions

#### `extractSelectedResources(formData)`

Extracts selected resources from Adaptive Card form data.

```javascript
function extractSelectedResources(formData: object): string[]
```

**Parameters**:
- `formData` - Form data with `resource_*` and `quickSelect_*` fields

**Returns**: Array of resource IDs

---

#### `fetchSelectedResources(patientId, workerId, selectedResources)`

Fetches data for selected resources in parallel.

```javascript
async function fetchSelectedResources(
    patientId: string,
    workerId: string,
    selectedResources: string[]
): Promise<{ results: object, errors: array }>
```

**Returns**:
- `results` - Map of resourceId → { data, needsAISummary, label }
- `errors` - Array of { resourceId, error }

---

#### `formatSimpleData(resourceId, data)`

Formats raw data for display (non-AI).

```javascript
function formatSimpleData(resourceId: string, data: any): { isEmpty: boolean, formatted: string }
```

Includes formatters for:
- Patient demographics
- Allergies
- Medications
- Vitals
- Care teams
- Diagnoses
- Appointments
- Episodes
- Encounters
- Organizations
- Locations
- Documents

---

#### `getResourceLabel(resourceId)`

Gets display label for a resource ID.

```javascript
function getResourceLabel(resourceId: string): string
```

---

#### `needsAISummary(resourceId)`

Checks if resource type needs AI summarization.

```javascript
function needsAISummary(resourceId: string): boolean
```

---

## documentService.js

**Purpose**: Document retrieval, PDF extraction, and AI summarization.

**Lines**: ~438

### Functions

#### `getPatientDocuments(patientId, options?)`

Gets all documents for a patient.

```javascript
async function getPatientDocuments(
    patientId: string,
    options?: { limit?: number, type?: string, dateFrom?: string }
): Promise<Document[]>
```

**Options**:
- `limit` - Max documents (default: 50)
- `type` - Filter by document type
- `dateFrom` - Filter by date (format: YYYY-MM-DD)

**Returns**: Array of document objects with:
- `id`, `type`, `date`, `description`
- `filename`, `contentType`, `url`
- `hasAttachment` - boolean

---

#### `getDocumentsByType(patientId)`

Gets documents grouped by type.

```javascript
async function getDocumentsByType(patientId: string): Promise<object>
```

**Returns**: Object with type keys and document arrays

---

#### `getRecentDocuments(patientId)`

Gets documents from the last 30 days.

```javascript
async function getRecentDocuments(patientId: string): Promise<Document[]>
```

---

#### `getDownloadableDocuments(patientId)`

Gets documents with PDF attachments.

```javascript
async function getDownloadableDocuments(patientId: string): Promise<Document[]>
```

---

#### `extractDocumentText(attachmentUrl)`

Extracts text content from a PDF attachment.

```javascript
async function extractDocumentText(attachmentUrl: string): Promise<{
    success: boolean,
    text: string,
    page_count: number,
    char_count: number,
    error?: string
}>
```

**Process**:
1. Get FHIR access token
2. Send URL to Python backend
3. Python downloads PDF and extracts text
4. Returns extracted text and metadata

---

#### `extractAndSummarizeDocument(attachmentUrl, options?)`

Extracts PDF text and generates AI summary.

```javascript
async function extractAndSummarizeDocument(
    attachmentUrl: string,
    options?: { documentType?: string, focusAreas?: string[] }
): Promise<{
    success: boolean,
    text: string,
    pageCount: number,
    charCount: number,
    summary: string,
    error?: string,
    usage?: object
}>
```

---

#### `summarizePatientDocuments(patientId, options?)`

Summarizes multiple documents for a patient.

```javascript
async function summarizePatientDocuments(
    patientId: string,
    options?: { limit?: number, documentTypes?: string[], patientContext?: string }
): Promise<{
    success: boolean,
    documentCount: number,
    summary: string,
    error?: string,
    usage?: object
}>
```

---

#### `batchFetchAndSummarizeDocuments(patients, options?)`

Batch processes documents for multiple patients.

```javascript
async function batchFetchAndSummarizeDocuments(
    patients: Patient[],
    options?: {
        maxDocsPerPatient?: number,
        includeConsolidated?: boolean,
        documentTypes?: string[]
    }
): Promise<object>
```

**Parameters**:
- `patients` - Array of patient objects
- `maxDocsPerPatient` - Max docs per patient (default: 5)
- `includeConsolidated` - Generate consolidated summary (default: true)
- `documentTypes` - Filter by types (default: all)

**Concurrency**: Processes 3 patients at a time

**Returns**: Map of patientId → { success, totalDocuments, processedCount, documents, consolidated }

---

## azureOpenAIService.js

**Purpose**: AI-powered text analysis and summarization for clinical documents.

**Lines**: ~343

### Configuration

```javascript
const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_API_KEY;
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';
const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview';
```

### Functions

#### `summarizeDocument(documentText, options?)`

Summarizes a single clinical document.

```javascript
async function summarizeDocument(
    documentText: string,
    options?: { documentType?: string, maxTokens?: number, focusAreas?: string[] }
): Promise<{
    success: boolean,
    summary: string,
    usage: { promptTokens, completionTokens, totalTokens },
    error?: string
}>
```

**System Prompt**: Clinical documentation specialist helping home health nurses

**Temperature**: 0.3 (consistent clinical summaries)

---

#### `summarizeMultipleDocuments(documents, options?)`

Consolidates multiple documents into an episode summary.

```javascript
async function summarizeMultipleDocuments(
    documents: Array<{ text: string, type: string, date: string }>,
    options?: { maxTokens?: number, patientContext?: string }
): Promise<{
    success: boolean,
    summary: string,
    documentCount: number,
    usage: object,
    error?: string
}>
```

**Focus**: Trends, progress toward goals, complications, interventions

---

#### `extractClinicalData(documentText)`

Extracts structured data from clinical text.

```javascript
async function extractClinicalData(documentText: string): Promise<{
    success: boolean,
    data: {
        diagnoses: string[],
        medications: array,
        vitals: object,
        findings: string[],
        interventions: string[],
        patientStatus: string,
        followUpNeeded: string[],
        alerts: string[]
    },
    usage: object,
    error?: string
}>
```

**Response Format**: JSON object

**Temperature**: 0.1 (consistent extraction)

---

#### `generateRecertTalkingPoints(episodeData)`

Generates recertification talking points.

```javascript
async function generateRecertTalkingPoints(episodeData: object): Promise<{
    success: boolean,
    talkingPoints: string,
    usage: object,
    error?: string
}>
```

**Output Sections**:
1. Key talking points for physician signature
2. Goals discussion
3. Homebound status justification
4. Skilled nursing need justification
5. Red flags/concerns

---

#### `checkConfiguration()`

Checks Azure OpenAI configuration and connectivity.

```javascript
async function checkConfiguration(): Promise<{
    configured: boolean,
    endpoint: string,
    deployment: string,
    hasApiKey: boolean,
    accessible: boolean,
    error?: string
}>
```

---

## summaryService.js

**Purpose**: Episode summary generation (rule-based, with AI integration TODO).

**Lines**: ~181

### Functions

#### `generateSummary(patientId)`

Generates comprehensive episode summary.

```javascript
async function generateSummary(patientId: string): Promise<{
    patientSnapshot: {
        id, name, dob, primaryDiagnosis, secondaryDiagnoses, medicationCount
    },
    episodeInfo: {
        startDate, endDate, daysInEpisode, daysRemaining, lastVisitDate
    },
    clinicalAlerts: string[],
    timeline: array,
    goals: array,
    goalStats: { met, inProgress, notMet },
    medications: array,
    recertPriorities: string[]
} | null>
```

---

#### `generateRecertPriorities(episode)`

Generates recertification priority items.

```javascript
function generateRecertPriorities(episode: object): string[]
```

**Includes**:
- Unmet goals count
- Active alerts count
- Medication reconciliation needs
- In-progress goals
- Standard recert items (homebound status, skilled need, OASIS)

---

#### `getBriefSummary(patientId)`

Gets brief summary for search results.

```javascript
async function getBriefSummary(patientId: string): Promise<{
    patientName: string,
    primaryDiagnosis: string,
    episodeDates: string,
    alertCount: number,
    hasAlerts: boolean
} | null>
```

---

## pythonBackendClient.js

**Purpose**: HTTP client for Python HCHB FHIR Backend API.

**Lines**: ~208

### Configuration

```javascript
const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8000/api/v1';
const PYTHON_BACKEND_TIMEOUT = parseInt(process.env.PYTHON_BACKEND_TIMEOUT) || 30000;
```

### Resource Endpoint Map

Maps resource IDs to Python API endpoints:

```javascript
const RESOURCE_ENDPOINT_MAP = {
    'Patient': (patientId) => `/patients/${patientId}`,
    'AllergyIntolerance': (patientId) => `/patients/${patientId}/allergies`,
    'Observation-BloodPressure': (patientId) => `/patients/${patientId}/vitals/blood-pressure`,
    'DocumentReference-VisitDocument': (patientId) => `/patients/${patientId}/documents/visit-document`,
    'Practitioner-Worker': (_, workerId) => `/workers/${workerId}`,
    // ... 30+ mappings
};
```

### Functions

#### `healthCheck()`

Checks Python backend availability.

```javascript
async function healthCheck(): Promise<{ status: string, error?: string }>
```

---

#### `fetchResource(resourceId, patientId, workerId)`

Fetches a resource from Python backend.

```javascript
async function fetchResource(
    resourceId: string,
    patientId: string,
    workerId?: string
): Promise<{ data: any }>
```

**Returns**: `{ data: [], count: 0 }` on 404

---

#### `validateWorker(workerId)`

Validates a worker ID.

```javascript
async function validateWorker(workerId: string): Promise<{
    valid: boolean,
    worker: object | null,
    message: string
}>
```

---

#### `getWorkerPatients(workerId, date)`

Gets patients for a worker on a specific date.

```javascript
async function getWorkerPatients(
    workerId: string,
    date: string
): Promise<{ data: Patient[], count: number }>
```

---

#### `batchFetch(patientId, resourceIds)`

Batch fetches multiple resources for a patient.

```javascript
async function batchFetch(
    patientId: string,
    resourceIds: string[]
): Promise<{ results: object, errors: array }>
```
