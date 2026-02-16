# PHI Data Flow: bot-recert

**Date:** 2026-02-16
**Scope:** Complete trace of Protected Health Information through every system component
**Classification:** Internal - HIPAA Compliance Documentation

---

## 1. System Architecture & PHI Boundaries

```
                           EXTERNAL SYSTEMS
    ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
    │  HCHB FHIR R4    │  │  Azure OpenAI    │  │ Microsoft Teams  │
    │  API (HTTPS)     │  │  GPT-4o (HTTPS)  │  │  (Bot Framework) │
    │                  │  │                  │  │                  │
    │  Source of all   │  │  Receives:       │  │  Displays:       │
    │  clinical PHI    │  │  - Document text │  │  - Adaptive Cards│
    │                  │  │  - Page images   │  │    with PHI      │
    │                  │  │  - Patient names │  │  - Action data   │
    │                  │  │  - Episode JSON  │  │    with IDs/names│
    └────────┬─────────┘  └────────▲─────────┘  └────────▲─────────┘
             │                     │                     │
    ═════════╪═════════════════════╪═════════════════════╪═════════
             │          SYSTEM BOUNDARY                  │
             ▼                     │                     │
    ┌──────────────────┐  ┌───────┴──────────┐  ┌───────┴──────────┐
    │  fhirClient.js   │  │ azureOpenAI      │  │  cardBuilder.js  │
    │  (HTTP transport) │  │ Service.js       │  │  (card JSON      │
    │                  │  │ (AI integration) │  │   construction)  │
    └────────┬─────────┘  └──────────────────┘  └──────────────────┘
             │                     ▲                     ▲
             ▼                     │                     │
    ┌──────────────────┐  ┌───────┴──────────┐          │
    │  fhirService.js  │  │ documentService  │          │
    │  (40+ FHIR       │  │ .js              │          │
    │   query methods)  │  │ (PDF extract +   │          │
    └────────┬─────────┘  │  summarize)      │          │
             │            └───────┬──────────┘          │
             ▼                    │                      │
    ┌──────────────────┐  ┌───────▼──────────┐          │
    │ patientService   │  │  pdf-service/    │          │
    │ .js              │  │  main.py         │          │
    │ (patient lookup  │  │  (PDF text       ├──► Azure OpenAI
    │  + scheduling)   │  │   extraction +   │   Vision (images)
    └────────┬─────────┘  │   Vision OCR)    │
             │            └──────────────────┘
             ▼
    ┌──────────────────┐  ┌──────────────────┐
    │ dataFetchService │  │ summaryService   │
    │ .js              │  │ .js              │
    │ (resource        │  │ (episode summary │
    │  orchestration   │  │  generation)     │
    │  + formatting)   │  │                  │
    └────────┬─────────┘  └────────┬─────────┘
             │                     │
             ▼                     ▼
    ┌──────────────────────────────────────────────────────┐
    │                     index.js                         │
    │  (Bot orchestration layer)                           │
    │                                                      │
    │  workerContext Map (in-memory, 2hr TTL, max 500)     │
    │  ┌────────────────────────────────────────────────┐  │
    │  │ worker: { name, id }                           │  │
    │  │ patients: [{ name, DOB, MRN, diagnosis, ... }] │  │
    │  │ selectedPatient: { name, id, ... }             │  │
    │  │ documentSummaries: { patientId: { summary } }  │  │
    │  └────────────────────────────────────────────────┘  │
    └──────────────────────────────────────────────────────┘
```

---

## 2. PHI Categories Tracked

| Category | HIPAA Identifier | Examples in This System |
|----------|-----------------|----------------------|
| Patient Names | Name | firstName, lastName, fullName |
| Dates | DOB, service dates | dob, episodeStart, episodeEnd, visitDate |
| Medical Record Numbers | MRN | patient.identifier (MR type) |
| Diagnoses | Clinical data | ICD codes, primaryDiagnosis, conditions |
| Medications | Clinical data | name, dosage, frequency |
| Vital Signs | Clinical data | temperature, BP, O2 sat, heart rate, weight |
| Clinical Notes | Clinical data | document text, AI summaries, care plans |
| Allergies | Clinical data | substance, severity, reaction |
| Goals & Assessments | Clinical data | goal descriptions, wound assessments |
| Contact Info | Address, phone | relatedPersons phone, organization address |
| Insurance | Health plan ID | coverage payor, type, status |
| Practitioner Names | Workforce data | worker name, physician name, care team names |

---

## 3. PHI Flow by Component

### 3.1 fhirClient.js — HTTP Transport Layer

**Role:** Lowest-level HTTP client. Every byte of PHI enters and exits the system through this module.

| Direction | What | Where |
|-----------|------|-------|
| **OUT → FHIR API** | Patient IDs in URL paths, names in search params, date filters | `fhirGet()`, `fhirPost()` |
| **IN ← FHIR API** | Raw FHIR bundles/resources (all PHI types) | Return values to callers |

**Storage:** None. Only OAuth2 tokens cached.

**Logging Risks:**
| Severity | Line | Issue |
|----------|------|-------|
| HIGH | 88 | Logs full URL + params — patient names in search queries, IDs in paths |
| MODERATE | 102, 150 | Error responses may echo patient identifiers in FHIR OperationOutcome |

---

### 3.2 fhirService.js — Data Access Layer (40+ functions)

**Role:** Queries FHIR resources, transforms into structured objects. Heaviest PHI processor in the system.

**PHI Types Processed:**

| Function Group | PHI Output Shape |
|---------------|-----------------|
| `getPatientById`, `searchPatients` | `{ id, firstName, lastName, fullName, dob, mrn, active }` |
| `getRecertPatients` | `{ id, episodeId, firstName, lastName, fullName, dob, primaryDiagnosis, episodeStart, episodeEnd, recertDue, daysUntilRecert }` |
| `getConditions` | `{ id, code, display, clinicalStatus, category }` |
| `getMedications` | `{ id, name, dosage, frequency }` |
| `getObservationsByCode` (all vitals) | `{ id, date, value, unit, status }` |
| `getDocuments` | `{ id, type, date, author, description, content, url }` — **`content` field contains base64-encoded clinical document text** |
| `getAllergyIntolerances` | `{ id, substance, criticality, severity, reaction }` |
| `getCarePlanGoals` | `{ id, description, lifecycleStatus, achievementStatus }` |
| `getCareTeam` | `{ name, role }` for each member |
| `getRelatedPersons` | `{ id, name, relationship, phone }` |
| `getPhysician` | `{ name, specialty }` |
| `getPayorSource` | `{ payor, type, status }` |

**External Transmission:**
- Every function calls HCHB FHIR API via `fhirGet()` with patient/worker IDs
- ~40 functions call Python backend via `tryPythonBackend()` with patient IDs

**Logging Risks:** Error handlers log `error.message` which may contain FHIR diagnostics referencing patient data (LOW risk — error messages only).

---

### 3.3 patientService.js — Patient Lookup & Scheduling

**Role:** Worker validation, patient list retrieval, episode data assembly.

**Key PHI Aggregation:** `getPatientEpisode()` (lines 383-419) builds the most comprehensive single PHI object:

```
{
    patientId, patientName, dob,
    primaryDiagnosis, secondaryDiagnoses,
    medications: [{ name, dose, frequency }],
    recentVisits: [{ date, type, summary }],
    goals: [{ goal, status, notes }],
    alerts: [...]
}
```

**Logging Risks:**
| Severity | Line | Issue |
|----------|------|-------|
| **CRITICAL** | 315 | `console.log` outputs `JSON.stringify(patient.name)` — full FHIR name array |
| **CRITICAL** | 340 | `console.log` outputs `${patientData.lastName}, ${patientData.firstName}` |
| MODERATE | 300, 325 | Logs patient FHIR IDs |

---

### 3.4 dataFetchService.js — Resource Orchestration & Formatting

**Role:** Fetches multiple resource types per request, formats all data into display strings.

**PHI Formatting Functions (24 formatters):**

Each transforms raw FHIR data into markdown strings for Adaptive Card display:

`formatPatientData` (name, DOB, gender, MRN, address, phone) · `formatAllergies` (substance, severity, reaction) · `formatMedications` (name, dosage, frequency) · `formatVitals` (value, unit, date) · `formatCareTeam` (member names, roles) · `formatOrganization` (name, address, phone) · `formatRelatedPerson` (name, relationship, phone) · `formatCarePlan` (title, description, goals) · `formatDiagnoses` (display, code, status) · `formatWoundCondition` (display, body site, status) · `formatPayorSource` (payor, type) · `formatAppointments` (date, type, participants) · `formatEpisodeOfCare` (type, status, period) · `formatEncounters` (date, type, reason) · `formatPhysician` (name, specialty) · `formatDocumentReferences` (type, date, author) · `formatGenericData` (**`JSON.stringify(data).substring(0, 500)`** — unfiltered FHIR dump)

**Broadest Aggregation:** `fetchSelectedResources()` `results` object can hold every PHI type simultaneously when user selects all resources.

---

### 3.5 documentService.js — Document Pipeline

**Role:** Fetches clinical documents, extracts PDF text, sends to AI for summarization.

**PHI Flow Chain:**

```
FHIR API (DocumentReference)
    ↓ attachment URL + bearer token
pdf-service/main.py (text extraction)
    ↓ extracted clinical text (full document content)
azureOpenAIService.js (summarization)
    ↓ AI-generated clinical summary
index.js → cardBuilder.js → Teams (displayed to user)
```

**External Transmissions:**
| Destination | What Is Sent |
|-------------|-------------|
| Python Backend | Attachment URL + Bearer token |
| Azure OpenAI (via azureOpenAIService) | Full extracted clinical text |
| Azure OpenAI (via azureOpenAIService) | Patient name as `patientContext` |

**Batch Processing Risk:** `batchFetchAndSummarizeDocuments()` holds extracted text and AI summaries for **multiple patients simultaneously** in the `results` Map.

---

### 3.6 azureOpenAIService.js — AI Integration (Highest PHI Transmission Risk)

**Role:** Sends clinical content to Azure OpenAI for summarization and analysis.

**Four PHI Transmission Points:**

| Function | Lines | PHI Sent to Azure OpenAI |
|----------|-------|--------------------------|
| `summarizeDocument` | 67-75 | Full clinical document text |
| `summarizeMultipleDocuments` | 143-151 | Multiple documents' text + **patient name** |
| `extractClinicalData` | 204-213 | Full clinical document text |
| `generateRecertTalkingPoints` | 263-271 | **Complete episode JSON** — patient name, DOB, all diagnoses, all medications (names, doses, frequencies), all visit dates and summaries, all goals, all alerts |

**Densest Single Transmission:** `generateRecertTalkingPoints` serializes the entire episode data object with `JSON.stringify(episodeData, null, 2)` and sends it in one prompt.

**Logging:** Clean — logs only character counts and operation statuses, never content.

---

### 3.7 summaryService.js — Episode Summary Generation

**Role:** Aggregates patient episode data into structured summary objects.

**PHI Output:**
```
{
    patientSnapshot: { id, name, dob, primaryDiagnosis, medicationCount },
    episodeInfo: { startDate, endDate, daysInEpisode, lastVisitDate },
    clinicalAlerts: [...],
    timeline: [{ date, event, details }],
    goals: [{ goal, status, notes }],
    medications: [{ name, dose, frequency }],
    recertPriorities: [...]
}
```

**Logging:** None. Cleanest service file.

---

### 3.8 pythonBackendClient.js — Python Backend Transport

**Role:** HTTP client for the HCHB Python backend service.

**Logging Risks:**
| Severity | Line | Issue |
|----------|------|-------|
| HIGH | 23 | Request interceptor logs full URL for **every request** — patient IDs in paths (`/patients/{id}/conditions`) |
| HIGH | 35 | Response interceptor logs full URL for **every response** |
| MODERATE | 40 | Error handler logs `error.response.data?.detail` |

**Transport Risk:** Uses HTTP by default (`http://localhost:8000`). No TLS unless configured externally.

---

### 3.9 pdf-service/main.py — PDF Text Extraction

**Role:** Downloads PDFs from FHIR API, extracts text via pdfplumber, falls back to GPT-4o Vision OCR.

**PHI Flow:**

| Step | Data | Destination |
|------|------|-------------|
| 1. Receive URL + token | Attachment URL, Bearer token | From Node.js bot |
| 2. Fetch PDF | Raw PDF bytes (clinical documents) | From HCHB FHIR API |
| 3a. pdfplumber extract | Full document text | Local processing |
| 3b. Vision OCR fallback | **Page images at 150 DPI** (up to 5 pages) | **Azure OpenAI Vision API** |
| 4. Return text | Complete extracted text + metadata | To Node.js bot |

**Vision OCR is the broadest image-based PHI transmission** — scanned pages may contain handwritten notes, patient signatures, facility letterheads, and stamped information not present in structured text.

**Storage:** Stateless. All PHI exists only in request-scoped local variables. PyMuPDF document explicitly closed at line 142.

**Logging:** Clean — counts and page numbers only. Exception messages from Azure OpenAI at lines 139, 234 are the only risk.

---

### 3.10 index.js — Bot Orchestration Layer

**Role:** Routes user actions, manages conversation state, coordinates services.

**In-Memory PHI Store:** `workerContext` Map (line 85)

| Field | PHI Content | Written By |
|-------|-------------|------------|
| `worker` | Worker name, ID | `handleValidateWorker` |
| `patients` | Array: names, DOBs, MRNs, diagnoses, visit info | `handleLoadPatientsByDate` |
| `selectedPatient` | Name, ID, DOB | `handlePatientSelect` |
| `documentSummaries` | AI clinical summaries per patient | `preloadDocumentSummaries` |
| `selectedDate` | Service date | `handleLoadPatientsByDate` |

**Retention:** 2-hour TTL, max 500 entries, in-process memory only. Lost on restart.

**Logging Risks:**
| Severity | Line | Issue |
|----------|------|-------|
| HIGH | 322, 344 | Worker ID logged |
| HIGH | 488 | Worker name logged |
| HIGH | 555, 630, 885 | Patient ID logged |
| MODERATE | 104, 371, 499, 719, 909, 957 | Error objects may contain FHIR response data with PHI |

---

### 3.11 cardBuilder.js — Adaptive Card Construction

**Role:** Builds Adaptive Card JSON from data objects. Stateless, no logging.

**PHI Displayed to Users:**

| Card | PHI Fields in Card Body |
|------|------------------------|
| `buildDateSelectionCard` | Worker name |
| `buildPatientSelectionCard` | Worker name, patient names, visit times, visit types |
| `buildRecertPatientListCard` | Worker name, patient names, primary diagnoses, recert dates, alert/doc counts |
| `buildPatientListCard` | Patient names, DOBs, primary diagnoses, search term |
| `buildResourceSelectionCard` | Patient name |
| `buildSummaryCard` | Patient name, DOB, primary + secondary diagnoses, medication names/doses/frequencies, episode dates, visit timeline with clinical details, goal descriptions/statuses/notes, clinical alerts, recert priorities |
| `buildDataResultsCard` | Patient name, **all formatted FHIR data** (demographics, allergies, meds, vitals, conditions, care plans, encounters, etc.), AI summaries, **raw JSON fallback up to 1000 chars** |
| `buildDocumentListCard` | Patient name, document types/dates/descriptions/filenames |
| `buildAISummaryCard` | Patient name, consolidated AI clinical summary, individual document summaries |
| `buildErrorCard` | No PHI |

**PHI in Card Action Data (round-tripped through Teams):**

| Card | Action Data Fields |
|------|--------------------|
| `buildDateSelectionCard` | `workerId` |
| `buildPatientSelectionCard` | `patientId`, `patientName` |
| `buildResourceSelectionCard` | `patientId`, `patientName`, `workerId` |
| `buildRecertPatientListCard` | `workerId`, `patientIds` (array of all patient IDs) |
| `buildPatientListCard` | `patientId` |
| `buildAISummaryCard` | `patientId`, `patientName` |

These payloads transit through Microsoft Teams infrastructure and are stored in Teams message history.

---

## 4. External PHI Transmission Summary

| Destination | Protocol | PHI Types Sent | Volume |
|-------------|----------|---------------|--------|
| **HCHB FHIR API** | HTTPS + Bearer token | Patient IDs, worker IDs, names (search), date ranges | Every FHIR query (~50+ per session) |
| **Azure OpenAI API** | HTTPS + API key | Clinical document text, page images (Vision OCR), patient names, DOBs, diagnoses, medications, vitals, goals, visit history, care plans | Per document summarization + episode talking points |
| **Python Backend** | **HTTP** (localhost default) | Patient IDs in URL paths, worker IDs | Every resource fetch when `USE_PYTHON_BACKEND=true` |
| **Microsoft Teams** | HTTPS (Bot Framework) | Adaptive Cards with patient names, DOBs, diagnoses, medications, vitals, AI summaries; action data with patient IDs/names | Every user interaction |

---

## 5. Remaining PHI Logging Violations

Despite the audit fixes, these PHI logging issues remain:

### Critical (Patient names in logs)

| File | Line | Content |
|------|------|---------|
| `patientService.js` | 315 | `JSON.stringify(patient.name)` — full FHIR name array |
| `patientService.js` | 340 | `${patientData.lastName}, ${patientData.firstName}` — plain text name |

### High (IDs and URLs with identifiers)

| File | Line | Content |
|------|------|---------|
| `fhirClient.js` | 88 | Full URL + params for every FHIR GET (patient IDs in paths, names in search) |
| `pythonBackendClient.js` | 23 | Full request URL for every Python backend call (patient IDs in paths) |
| `pythonBackendClient.js` | 35 | Full response URL for every Python backend response |
| `index.js` | 322, 344 | Worker ID |
| `index.js` | 488 | Worker name |
| `index.js` | 555, 630, 885 | Patient FHIR IDs |

### Moderate (Error messages that may contain PHI)

| File | Line | Content |
|------|------|---------|
| `fhirClient.js` | 102, 150 | FHIR OperationOutcome in error.response.data |
| `pythonBackendClient.js` | 40 | Python backend error detail |
| `documentService.js` | 139, 158, 304, 323, 410 | Patient IDs and attachment URLs |
| `patientService.js` | 300 | Patient FHIR ID |
| `index.js` | 104, 371, 499, 719, 909, 957 | Error objects from upstream services |

---

## 6. Risk Matrix

| # | Risk | Severity | Mitigation Status |
|---|------|----------|------------------|
| 1 | Patient names logged in plain text (`patientService.js`) | **Critical** | **Not fixed** |
| 2 | Full URLs with patient IDs logged for every FHIR/Python request | **High** | **Not fixed** |
| 3 | Full clinical text sent to Azure OpenAI (including patient names) | **High** | Covered by Azure BAA — verify BAA is in place |
| 4 | Document page images sent to Azure OpenAI Vision | **High** | Covered by Azure BAA — verify BAA is in place |
| 5 | Episode JSON with all PHI sent to Azure OpenAI in one payload | **High** | Covered by Azure BAA — verify BAA is in place |
| 6 | Python backend uses HTTP (no TLS) by default | **High** | OK if localhost only; risk if deployed separately |
| 7 | Raw FHIR JSON displayed in cards (up to 1000 chars, unfiltered) | **Medium** | Controlled by user resource selection |
| 8 | Patient names/IDs in Adaptive Card action data (round-trip through Teams) | **Medium** | Covered by Teams/Microsoft BAA |
| 9 | workerContext holds up to 500 sessions of PHI in plaintext heap memory | **Medium** | 2-hour TTL eviction in place |
| 10 | Error messages from FHIR/Azure may echo PHI | **Low** | Generic user messages in place; server logs still expose |

---

## 7. Recommendations

### Immediate

1. **Remove the two critical patient name log statements** in `patientService.js` (lines 315, 340)
2. **Sanitize URL logging** in `fhirClient.js` and `pythonBackendClient.js` — log the resource path pattern (e.g., `/Patient/{id}`) without actual IDs
3. **Verify Azure BAA** covers the Azure OpenAI endpoint being used for document summarization and Vision OCR

### Short-Term

4. **Add TLS to Python backend** if deployed on a separate host
5. **Remove or redact the raw JSON fallback** in `buildDataResultsCard` (line 1416-1418) — filter sensitive fields before display
6. **Implement structured logging** with a PHI redaction layer (replace `console.log` with a logger that masks known PHI patterns)

### Long-Term

7. **Evaluate whether patient names need to be sent to Azure OpenAI** — `patientContext` in multi-document summarization includes full name; consider using a de-identified reference instead
8. **Encrypt workerContext at rest** or migrate to Bot Framework ConversationState with Azure Blob/CosmosDB (encrypted storage)
9. **Add audit logging** for PHI access events (who viewed which patient's data, when)
10. **Implement data minimization** — only fetch and display the PHI fields actually needed for each card, rather than full FHIR resources
