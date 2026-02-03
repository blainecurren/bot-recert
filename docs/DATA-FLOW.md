# Data Flow Diagrams

This document provides detailed data flow diagrams for the major workflows in the Bot-Recert application.

## Table of Contents

1. [Worker Login Flow](#worker-login-flow)
2. [Patient List Loading](#patient-list-loading)
3. [Document Analysis Pipeline](#document-analysis-pipeline)
4. [Resource Fetching Flow](#resource-fetching-flow)
5. [Python Backend Fallback Pattern](#python-backend-fallback-pattern)

---

## Worker Login Flow

### Sequence Diagram

```
┌────────┐     ┌─────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────┐
│  User  │     │   Bot   │     │patientService│     │pythonBackend│     │ FHIR API │
└───┬────┘     └────┬────┘     └──────┬───────┘     └──────┬──────┘     └────┬─────┘
    │               │                  │                    │                 │
    │ Enter Worker ID                  │                    │                 │
    │──────────────►│                  │                    │                 │
    │               │                  │                    │                 │
    │               │ getWorkerById()  │                    │                 │
    │               │─────────────────►│                    │                 │
    │               │                  │                    │                 │
    │               │                  │ validateWorker()   │                 │
    │               │                  │───────────────────►│                 │
    │               │                  │                    │                 │
    │               │                  │   valid/invalid    │                 │
    │               │                  │◄───────────────────│                 │
    │               │                  │                    │                 │
    │               │                  │    (if invalid)    │                 │
    │               │                  │ GET /Practitioner  │                 │
    │               │                  │───────────────────────────────────── ►│
    │               │                  │                    │                 │
    │               │                  │    Practitioner    │                 │
    │               │                  │◄─────────────────────────────────────│
    │               │                  │                    │                 │
    │               │ Worker object    │                    │                 │
    │               │◄─────────────────│                    │                 │
    │               │                  │                    │                 │
    │  Welcome Card │                  │                    │                 │
    │◄──────────────│                  │                    │                 │
    │               │                  │                    │                 │
```

### State Changes

```
Initial State:
  workerContext = {}

After Validation:
  workerContext = {
    [conversationId]: {
      worker: {
        id: "W001",
        identifier: "W001",
        name: "Sarah Johnson",
        active: true
      },
      selectedDate: null,
      patients: [],
      selectedPatient: null
    }
  }
```

---

## Patient List Loading

### Sequence Diagram

```
┌────────┐     ┌─────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────┐
│  User  │     │   Bot   │     │patientService│     │pythonBackend│     │ FHIR API │
└───┬────┘     └────┬────┘     └──────┬───────┘     └──────┬──────┘     └────┬─────┘
    │               │                  │                    │                 │
    │ Select Date   │                  │                    │                 │
    │──────────────►│                  │                    │                 │
    │               │                  │                    │                 │
    │               │ getPatientsByWorkerAndDate()         │                 │
    │               │─────────────────►│                    │                 │
    │               │                  │                    │                 │
    │               │                  │ getWorkerPatients()│                 │
    │               │                  │───────────────────►│                 │
    │               │                  │                    │                 │
    │               │                  │   patients[]       │                 │
    │               │                  │◄───────────────────│                 │
    │               │                  │                    │                 │
    │               │                  │ Filter by visit    │                 │
    │               │                  │ type codes         │                 │
    │               │                  │                    │                 │
    │               │ patients[]       │                    │                 │
    │               │◄─────────────────│                    │                 │
    │               │                  │                    │                 │
    │ Patient List  │                  │                    │                 │
    │   Card        │                  │                    │                 │
    │◄──────────────│                  │                    │                 │
    │               │                  │                    │                 │
    │               │══════════════════│═══════════════════ │═════════════════│
    │               │      BACKGROUND PROCESS              │                 │
    │               │══════════════════│═══════════════════ │═════════════════│
    │               │                  │                    │                 │
    │               │ preloadDocumentSummaries()           │                 │
    │               │────────────────────────────────────► │ (documentService)
    │               │                  │                    │                 │
    │ "Analyzing    │                  │                    │                 │
    │  documents...│                  │                    │                 │
    │◄──────────────│                  │                    │                 │
    │               │                  │                    │                 │
    │               │     (batch process for each patient) │                 │
    │               │◄───────────────────────────────────── │                 │
    │               │                  │                    │                 │
    │ "AI analysis  │                  │                    │                 │
    │  complete"    │                  │                    │                 │
    │◄──────────────│                  │                    │                 │
```

### Visit Type Filtering

```
Input from Python Backend:
┌──────────────────────────────────────────┐
│ Patient List (6 patients)                │
│ ├─ P001: SN11 (Skilled Nursing)    ✓     │
│ ├─ P002: PT11 (Physical Therapy)   ✓     │
│ ├─ P003: RN11WC (Wound Care)       ✓     │
│ ├─ P004: ADMIN (Administrative)    ✗     │
│ ├─ P005: OT11 (Occupational)       ✓     │
│ └─ P006: PHONE (Phone Call)        ✗     │
└──────────────────────────────────────────┘
                    │
                    ▼ Filter by VALID_VISIT_TYPE_CODES
┌──────────────────────────────────────────┐
│ Filtered List (4 patients)               │
│ ├─ P001: SN11 (Skilled Nursing)          │
│ ├─ P002: PT11 (Physical Therapy)         │
│ ├─ P003: RN11WC (Wound Care)             │
│ └─ P005: OT11 (Occupational)             │
└──────────────────────────────────────────┘
```

---

## Document Analysis Pipeline

### Full Pipeline Flow

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         Document Analysis Pipeline                          │
└────────────────────────────────────────────────────────────────────────────┘

     ┌─────────────┐
     │ Patient IDs │
     │   List      │
     └──────┬──────┘
            │
            ▼
┌───────────────────────┐
│ For each patient      │
│ (3 concurrent)        │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐        ┌──────────────────────┐
│ documentService.      │───────►│ GET /DocumentReference│
│ getRecentDocuments()  │        │ ?patient={id}        │
└───────────┬───────────┘        │ &_sort=-date         │
            │                     │ &_count=50           │
            │                     └──────────────────────┘
            ▼
┌───────────────────────┐
│ Filter: PDF only      │
│ (contentType check)   │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│ Limit: 5 docs/patient │
└───────────┬───────────┘
            │
            ▼
  ┌─────────┴─────────┐
  │ For each document │
  └─────────┬─────────┘
            │
            ▼
┌───────────────────────┐        ┌──────────────────────┐
│ documentService.      │───────►│ Python Backend       │
│ extractDocumentText() │        │ POST /extract-text   │
└───────────┬───────────┘        └──────────┬───────────┘
            │                                │
            │                                ▼
            │                    ┌──────────────────────┐
            │                    │ Fetch PDF from FHIR  │
            │                    │ (with Bearer token)  │
            │                    └──────────┬───────────┘
            │                                │
            │                                ▼
            │                    ┌──────────────────────┐
            │                    │ pdfplumber.extract() │
            │                    └──────────┬───────────┘
            │                                │
            │                    ┌───────────┴───────────┐
            │                    │                       │
            │               Text Found            No Text
            │                    │                       │
            │                    │                       ▼
            │                    │           ┌──────────────────────┐
            │                    │           │ Vision OCR           │
            │                    │           │ (GPT-4o)             │
            │                    │           └──────────┬───────────┘
            │                    │                       │
            │                    └───────────┬───────────┘
            │                                │
            │◄───────────────────────────────┘
            │
            ▼
┌───────────────────────┐        ┌──────────────────────┐
│ azureOpenAIService.   │───────►│ Azure OpenAI         │
│ summarizeDocument()   │        │ GPT-4o               │
└───────────┬───────────┘        └──────────────────────┘
            │
            ▼
┌───────────────────────┐
│ Individual Summary    │
│ stored                │
└───────────┬───────────┘
            │
            ▼
  (After all docs processed)
            │
            ▼
┌───────────────────────┐        ┌──────────────────────┐
│ azureOpenAIService.   │───────►│ Azure OpenAI         │
│ summarizeMultiple()   │        │ GPT-4o               │
└───────────┬───────────┘        └──────────────────────┘
            │
            ▼
┌───────────────────────┐
│ Consolidated Summary  │
│ stored                │
└───────────────────────┘
```

### Data Transformation

```
DocumentReference (FHIR)
{
  "id": "DOC123",
  "type": { "text": "Visit Note" },
  "date": "2025-01-15T10:30:00Z",
  "content": [{
    "attachment": {
      "url": "https://api.hchb.com/fhir/r4/Binary/123",
      "contentType": "application/pdf"
    }
  }]
}
        │
        ▼
PDF Binary (downloaded)
        │
        ▼
Extracted Text
"Patient: John Smith
Date: 01/15/2025
Assessment: Patient stable..."
        │
        ▼
AI Summary
"**Visit Summary (01/15/2025)**
- Patient stable with controlled BP
- Medication compliance good
- Continue current care plan..."
        │
        ▼
Stored in workerContext.documentSummaries
{
  "P001": {
    "success": true,
    "documents": [{
      "documentId": "DOC123",
      "documentType": "Visit Note",
      "summary": "..."
    }],
    "consolidated": {
      "summary": "Episode Overview: ..."
    }
  }
}
```

---

## Resource Fetching Flow

### Request Flow

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         Resource Fetching Flow                              │
└────────────────────────────────────────────────────────────────────────────┘

User selects resources:
┌──────────────────────┐
│ ☑ Patient            │
│ ☑ Diagnoses          │
│ ☑ Blood Pressure     │
│ ☑ Visit Documents    │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────────────────┐
│ dataFetchService.                │
│ extractSelectedResources()       │
│                                  │
│ Returns: [                       │
│   "Patient",                     │
│   "Condition-Diagnoses",         │
│   "Observation-BloodPressure",   │
│   "DocumentReference-VisitDocument│
│ ]                                │
└──────────────────┬───────────────┘
                   │
                   ▼
┌──────────────────────────────────┐
│ dataFetchService.                │
│ fetchSelectedResources()         │
│                                  │
│ Parallel fetch for each resource │
└──────────────────┬───────────────┘
                   │
    ┌──────────────┼──────────────┬──────────────┐
    │              │              │              │
    ▼              ▼              ▼              ▼
┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
│ Patient │  │Condition│  │Observat.│  │Document │
│ fetch   │  │ fetch   │  │ fetch   │  │ fetch   │
└────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘
     │            │            │            │
     ▼            ▼            ▼            ▼
┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
│fhirServ.│  │fhirServ.│  │fhirServ.│  │fhirServ.│
│getPatient│  │getCond. │  │getBloodP│  │getVisitD│
└────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘
     │            │            │            │
     └────────────┴────────────┴────────────┘
                       │
                       ▼
              ┌───────────────┐
              │ Results Map   │
              │ {             │
              │   "Patient":  │
              │     { data...}│
              │   "Condition":│
              │     { data...}│
              │   ...         │
              │ }             │
              └───────┬───────┘
                      │
                      ▼
              ┌───────────────┐
              │ formatSimple- │
              │ Data() for    │
              │ each resource │
              └───────┬───────┘
                      │
                      ▼
              ┌───────────────┐
              │ buildDataRes- │
              │ ultsCard()    │
              └───────────────┘
```

### Resource Method Mapping

```
Resource ID                    → fhirService Method
─────────────────────────────────────────────────────
"Patient"                      → getPatientById(patientId)
"Condition-Diagnoses"          → getConditions(patientId)
"Observation-BloodPressure"    → getBloodPressure(patientId)
"DocumentReference-VisitDoc"   → getVisitDocuments(patientId)
"MedicationRequest"            → getMedications(patientId)
"CareTeam"                     → getCareTeam(patientId)
"EpisodeOfCare"                → getPatientEpisodes(patientId)
"Practitioner-Worker"          → getWorker(workerId)
```

---

## Python Backend Fallback Pattern

### Decision Flow

```
┌──────────────────────────────────────────────────────────────┐
│                   Fallback Pattern                            │
└──────────────────────────────────────────────────────────────┘

┌─────────────────┐
│ fhirService.    │
│ getXxx()        │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│ USE_PYTHON_BACKEND === true │
│ ?                           │
└──────────────┬──────────────┘
               │
      ┌────────┴────────┐
      │                 │
     Yes                No
      │                 │
      ▼                 │
┌─────────────────┐     │
│ pythonBackend.  │     │
│ fetchResource() │     │
└────────┬────────┘     │
         │              │
         ▼              │
┌─────────────────┐     │
│ Response OK?    │     │
└────────┬────────┘     │
         │              │
    ┌────┴────┐         │
    │         │         │
   Yes       No         │
    │         │         │
    ▼         └─────────┼─────┐
┌─────────┐             │     │
│ Return  │             │     │
│ data    │             │     │
└─────────┘             │     │
                        │     │
                        ▼     ▼
               ┌─────────────────┐
               │ Direct FHIR    │
               │ fhirGet()      │
               └────────┬────────┘
                        │
                        ▼
               ┌─────────────────┐
               │ Transform and   │
               │ return data     │
               └─────────────────┘
```

### Example Implementation

```javascript
async function getConditions(patientId) {
    // Try Python backend first
    if (USE_PYTHON_BACKEND) {
        try {
            console.log('[FhirService] Trying Python backend for conditions');
            const result = await pythonBackend.fetchResource('Condition-Diagnoses', patientId);
            if (result && result.data && result.data.length > 0) {
                return result.data;
            }
            console.log('[FhirService] Python backend returned no data, falling back');
        } catch (error) {
            console.log('[FhirService] Python backend error:', error.message);
        }
    }

    // Fallback to direct FHIR
    console.log('[FhirService] Using direct FHIR for conditions');
    const bundle = await fhirGet('/Condition', {
        subject: `Patient/${patientId}`,
        'clinical-status': 'active',
        _count: 50
    });

    if (!bundle.entry || bundle.entry.length === 0) {
        return [];
    }

    return bundle.entry.map(entry => transformCondition(entry.resource));
}
```

### Benefits

```
┌─────────────────────────────────────────────────────────┐
│ Python Backend                                           │
├─────────────────────────────────────────────────────────┤
│ ✓ Mock data for development                             │
│ ✓ PDF text extraction                                   │
│ ✓ Vision OCR for scanned docs                           │
│ ✓ Faster iteration (no FHIR calls)                      │
└─────────────────────────────────────────────────────────┘
                    │
                    │ Fallback
                    ▼
┌─────────────────────────────────────────────────────────┐
│ Direct FHIR API                                          │
├─────────────────────────────────────────────────────────┤
│ ✓ Real production data                                  │
│ ✓ Works without Python backend                          │
│ ✓ Full FHIR resource support                            │
└─────────────────────────────────────────────────────────┘
```

---

## Error Handling Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Error Handling Flow                              │
└─────────────────────────────────────────────────────────────────────────┘

Any Operation
     │
     ▼
┌─────────────────┐
│ try {           │
│   operation()   │
│ }               │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
 Success    Error
    │         │
    ▼         ▼
Continue  ┌─────────────────┐
    │     │ catch (error) { │
    │     │   log error     │
    │     │   build card    │
    │     │ }               │
    │     └────────┬────────┘
    │              │
    │              ▼
    │     ┌─────────────────┐
    │     │ cardBuilder.    │
    │     │ buildErrorCard( │
    │     │   title,        │
    │     │   message       │
    │     │ )               │
    │     └────────┬────────┘
    │              │
    │              ▼
    │     ┌─────────────────┐
    │     │ context.send-   │
    │     │ Activity(card)  │
    │     └─────────────────┘
    │
    ▼
End Flow
```
