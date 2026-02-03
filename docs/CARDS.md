# Adaptive Cards Reference

This document provides a comprehensive reference for all Adaptive Cards in the Bot-Recert application.

## Table of Contents

1. [Card Builder Functions](#card-builder-functions)
2. [Resource Categories](#resource-categories)
3. [Card Structures](#card-structures)
4. [Action Payloads](#action-payloads)

---

## Card Builder Functions

The `cardBuilder.js` module exports 12 card builder functions:

| Function | Purpose | Actions |
|----------|---------|---------|
| `getWelcomeCard()` | Login/welcome screen | validateWorker |
| `buildDateSelectionCard(worker)` | Date picker | loadPatientsByDate, newSearch |
| `buildPatientSelectionCard(worker, patients, date)` | Patient list | selectPatient, backToDateSelection, newSearch |
| `buildResourceSelectionCard(patient, worker)` | FHIR resource picker | fetchResources, viewDocuments, backToPatients |
| `buildDataResultsCard(patient, results, errors)` | Display fetched data | backToResourceSelection, backToPatients, newSearch |
| `buildDocumentListCard(patient, documents, worker)` | Document list | backToResourceSelection, backToPatients, newSearch |
| `buildAISummaryCard(patient, summaryData, worker)` | AI summary display | selectPatient, viewDocuments, backToPatients |
| `buildRecertPatientListCard(worker, patients)` | Legacy recert list | generateSummaries, newSearch |
| `buildProcessingCard(patientCount, workerId)` | Processing status | (none) |
| `buildPatientListCard(searchTerm, patients)` | Search results | selectPatient, newSearch |
| `buildSummaryCard(summary)` | Episode summary | backToPatients, OpenUrl |
| `buildErrorCard(title, message)` | Error display | newSearch |

---

## Resource Categories

The resource selection card organizes 40+ FHIR resources into 14 categories:

### 1. Patient Info
| Resource ID | Label |
|-------------|-------|
| `Patient` | Patient Demographics |
| `RelatedPerson` | Episode Contact |

### 2. Allergies
| Resource ID | Label |
|-------------|-------|
| `AllergyIntolerance` | Allergy Intolerance |

### 3. Appointments
| Resource ID | Label |
|-------------|-------|
| `Appointment-Visit` | Patient Visit |
| `Appointment-Schedule` | Schedule |
| `Appointment-IDG` | IDG Meeting |

### 4. Vitals
| Resource ID | Label |
|-------------|-------|
| `Observation-Temperature` | Body Temperature |
| `Observation-BloodPressure` | Blood Pressure |
| `Observation-BodyMass` | Body Mass |
| `Observation-BodyWeight` | Body Weight |
| `Observation-HeadCircumference` | Head Circumference |
| `Observation-HeartRate` | Heart Rate |
| `Observation-OxygenSaturation` | Oxygen Saturation |
| `Observation-RespiratoryRate` | Respiratory Rate |

### 5. Care Plans
| Resource ID | Label |
|-------------|-------|
| `CarePlan-AideHomecare` | Aide Homecare Plan |
| `CarePlan-PersonalCare` | Personal Care Plan |
| `CareTeam` | Care Team |

### 6. Conditions
| Resource ID | Label |
|-------------|-------|
| `Condition-Diagnoses` | Diagnoses |
| `Condition-Wound` | Wound |

### 7. Documents
| Resource ID | Label |
|-------------|-------|
| `DocumentReference-CoordinationNote` | Coordination Note |
| `DocumentReference-EpisodeDocument` | Episode Document |
| `DocumentReference-IDGMeetingNote` | IDG Meeting Note |
| `DocumentReference-PatientDocument` | Patient Document |
| `DocumentReference-PatientSignature` | Patient Signature |
| `DocumentReference-TherapyGoalsStatus` | Therapy Goals Status |
| `DocumentReference-VisitDocument` | Visit Document |

### 8. Episodes & Encounters
| Resource ID | Label |
|-------------|-------|
| `EpisodeOfCare` | Episode of Care |
| `Encounter` | Encounter |

### 9. Observations
| Resource ID | Label |
|-------------|-------|
| `Observation-LivingArrangement` | Living Arrangement |
| `Observation-WoundAssessment` | Wound Assessment |
| `Observation-WoundAssessmentDetails` | Wound Assessment Details |

### 10. Medications
| Resource ID | Label |
|-------------|-------|
| `MedicationRequest` | Medication Request |

### 11. Organizations
| Resource ID | Label |
|-------------|-------|
| `Organization-Agency` | Agency |
| `Organization-Branch` | Branch |
| `Organization-Team` | Team |
| `Organization-PayorSource` | Payor Source |

### 12. Practitioners
| Resource ID | Label |
|-------------|-------|
| `Practitioner-Physician` | Physician |
| `Practitioner-Worker` | Worker |

### 13. Locations
| Resource ID | Label |
|-------------|-------|
| `Location-ServiceLocation` | Service Location |
| `Location-WorkerLocation` | Worker Location |

### 14. Referrals & Billing
| Resource ID | Label |
|-------------|-------|
| `ServiceRequest-ReferralOrder` | Referral Order |
| `Account` | Account |

---

## Card Structures

### Welcome Card Structure

```json
{
    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
    "type": "AdaptiveCard",
    "version": "1.5",
    "body": [
        {
            "type": "Container",
            "style": "emphasis",
            "items": [
                { "type": "TextBlock", "text": "Title", "size": "Large", "weight": "Bolder" },
                { "type": "TextBlock", "text": "Subtitle", "size": "Small", "isSubtle": true }
            ]
        },
        {
            "type": "Input.Text",
            "id": "workerId",
            "placeholder": "Enter your Worker ID"
        }
    ],
    "actions": [
        {
            "type": "Action.Submit",
            "title": "Login",
            "data": { "action": "validateWorker" }
        }
    ]
}
```

### Date Selection Card Structure

```json
{
    "body": [
        { "type": "Container", "style": "emphasis", "items": [...] },
        { "type": "TextBlock", "text": "Instructions" },
        {
            "type": "Container",
            "items": [
                { "type": "TextBlock", "text": "Visit Date", "weight": "Bolder" },
                {
                    "type": "Input.Date",
                    "id": "selectedDate",
                    "value": "today"
                }
            ]
        }
    ],
    "actions": [
        {
            "type": "Action.Submit",
            "title": "Load My Patients",
            "style": "positive",
            "data": { "action": "loadPatientsByDate", "workerId": "..." }
        },
        {
            "type": "Action.Submit",
            "title": "Change Worker",
            "data": { "action": "newSearch" }
        }
    ]
}
```

### Patient Selection Card Structure

```json
{
    "body": [
        { "type": "Container", "style": "emphasis", "items": [...] },
        { "type": "TextBlock", "text": "Patient count message" },
        // For each patient:
        {
            "type": "Container",
            "items": [
                {
                    "type": "ActionSet",
                    "actions": [{
                        "type": "Action.Submit",
                        "title": "Patient Name (Visit Time)",
                        "data": {
                            "action": "selectPatient",
                            "patientId": "...",
                            "patientName": "..."
                        }
                    }]
                },
                { "type": "TextBlock", "text": "Visit Type", "size": "Small" }
            ]
        }
    ],
    "actions": [
        { "type": "Action.Submit", "title": "Select Different Date", "data": { "action": "backToDateSelection" } },
        { "type": "Action.Submit", "title": "Change Worker", "data": { "action": "newSearch" } }
    ]
}
```

### Resource Selection Card Structure

```json
{
    "body": [
        { "type": "Container", "style": "emphasis", "items": [...] },
        { "type": "TextBlock", "text": "Instructions" },
        // For each category:
        {
            "type": "Container",
            "style": "emphasis",
            "selectAction": {
                "type": "Action.ToggleVisibility",
                "targetElements": ["category-content"]
            },
            "items": [{ "type": "ColumnSet", "columns": [...] }]
        },
        {
            "type": "Container",
            "id": "category-content",
            "isVisible": false,
            "items": [
                // Toggle inputs for each resource
                {
                    "type": "ColumnSet",
                    "columns": [
                        {
                            "type": "Column",
                            "width": "auto",
                            "items": [{
                                "type": "Input.Toggle",
                                "id": "resource_ResourceId",
                                "value": "false"
                            }]
                        },
                        {
                            "type": "Column",
                            "width": "stretch",
                            "items": [{ "type": "TextBlock", "text": "Resource Label" }]
                        }
                    ]
                }
            ]
        },
        // Quick select section
        {
            "type": "Container",
            "items": [
                { "type": "TextBlock", "text": "Quick Select:" },
                { "type": "ColumnSet", "columns": [/* clinical, vitals, documents toggles */] }
            ]
        }
    ],
    "actions": [
        { "type": "Action.Submit", "title": "Fetch Selected Data", "style": "positive", "data": { "action": "fetchResources", ... } },
        { "type": "Action.Submit", "title": "View All Documents", "data": { "action": "viewDocuments", ... } },
        { "type": "Action.Submit", "title": "Back to Patients", "data": { "action": "backToPatients" } }
    ]
}
```

### Data Results Card Structure

```json
{
    "body": [
        { "type": "Container", "style": "emphasis", "items": [...] },
        { "type": "TextBlock", "text": "Retrieved X data type(s)" },
        // Expandable sections for each resource
        {
            "type": "ActionSet",
            "actions": [{
                "type": "Action.ShowCard",
                "title": "Resource Label",
                "card": {
                    "type": "AdaptiveCard",
                    "body": [{ "type": "TextBlock", "text": "formatted data" }]
                }
            }]
        },
        // Errors section (if any)
        {
            "type": "Container",
            "style": "attention",
            "items": [...]
        },
        // Legend
        { "type": "TextBlock", "text": "* AI summarized content" }
    ],
    "actions": [
        { "type": "Action.Submit", "title": "Select More Data", "data": { "action": "backToResourceSelection" } },
        { "type": "Action.Submit", "title": "Back to Patients", "data": { "action": "backToPatients" } },
        { "type": "Action.Submit", "title": "New Search", "data": { "action": "newSearch" } }
    ]
}
```

### AI Summary Card Structure

```json
{
    "body": [
        { "type": "Container", "style": "emphasis", "items": [/* Title + Patient Name */] },
        // Stats row
        {
            "type": "ColumnSet",
            "columns": [
                { "type": "Column", "items": [/* Total Docs */] },
                { "type": "Column", "items": [/* Analyzed */] },
                { "type": "Column", "items": [/* Summaries */] }
            ]
        },
        // Consolidated summary
        {
            "type": "Container",
            "style": "good",
            "items": [
                { "type": "TextBlock", "text": "Consolidated Clinical Summary", "weight": "Bolder" },
                { "type": "TextBlock", "text": "summary text", "wrap": true }
            ]
        },
        // Individual document summaries
        { "type": "TextBlock", "text": "Individual Document Summaries" },
        {
            "type": "ActionSet",
            "actions": [
                {
                    "type": "Action.ShowCard",
                    "title": "Document Type (Date)",
                    "card": { "type": "AdaptiveCard", "body": [...] }
                }
            ]
        }
    ],
    "actions": [
        { "type": "Action.Submit", "title": "View All Data", "style": "positive", "data": { "action": "selectPatient", "skipSummary": true, ... } },
        { "type": "Action.Submit", "title": "View Documents", "data": { "action": "viewDocuments", ... } },
        { "type": "Action.Submit", "title": "Back to Patients", "data": { "action": "backToPatients" } }
    ]
}
```

### Document List Card Structure

```json
{
    "body": [
        { "type": "Container", "style": "emphasis", "items": [...] },
        { "type": "TextBlock", "text": "Found X document(s)" },
        // Expandable sections by document type
        {
            "type": "ActionSet",
            "actions": [{
                "type": "Action.ShowCard",
                "title": "Type Name (count)",
                "card": {
                    "type": "AdaptiveCard",
                    "body": [
                        // For each document
                        {
                            "type": "Container",
                            "items": [{
                                "type": "ColumnSet",
                                "columns": [
                                    { "type": "Column", "items": [/* description, date */] },
                                    { "type": "Column", "items": [/* PDF badge or "No file" */] }
                                ]
                            }]
                        }
                    ]
                }
            }]
        },
        // Downloadable PDFs count
        {
            "type": "Container",
            "items": [{ "type": "TextBlock", "text": "X downloadable PDF(s) available" }]
        }
    ],
    "actions": [
        { "type": "Action.Submit", "title": "Back to Data Selection", "data": { "action": "backToResourceSelection" } },
        { "type": "Action.Submit", "title": "Back to Patients", "data": { "action": "backToPatients" } },
        { "type": "Action.Submit", "title": "New Search", "data": { "action": "newSearch" } }
    ]
}
```

### Error Card Structure

```json
{
    "body": [{
        "type": "Container",
        "style": "attention",
        "items": [
            { "type": "TextBlock", "text": "Error Title", "weight": "Bolder", "color": "Attention" },
            { "type": "TextBlock", "text": "Error message", "wrap": true }
        ]
    }],
    "actions": [{
        "type": "Action.Submit",
        "title": "Try Again",
        "data": { "action": "newSearch" }
    }]
}
```

---

## Action Payloads

### Standard Action Payloads

| Action | Payload |
|--------|---------|
| `validateWorker` | `{ action: "validateWorker" }` + form input `workerId` |
| `loadPatientsByDate` | `{ action: "loadPatientsByDate", workerId: string }` + form input `selectedDate` |
| `selectPatient` | `{ action: "selectPatient", patientId: string, patientName: string, skipSummary?: boolean }` |
| `fetchResources` | `{ action: "fetchResources", patientId: string, patientName: string, workerId: string }` + form inputs |
| `viewDocuments` | `{ action: "viewDocuments", patientId: string, patientName: string }` |
| `backToPatients` | `{ action: "backToPatients" }` |
| `backToDateSelection` | `{ action: "backToDateSelection" }` |
| `backToResourceSelection` | `{ action: "backToResourceSelection" }` |
| `newSearch` | `{ action: "newSearch" }` |

### Form Data Inputs

#### Resource Selection Form

```javascript
{
    // Quick selects
    "quickSelect_clinical": "true" | "false",
    "quickSelect_vitals": "true" | "false",
    "quickSelect_documents": "true" | "false",

    // Individual resources
    "resource_Patient": "true" | "false",
    "resource_AllergyIntolerance": "true" | "false",
    "resource_Observation-BloodPressure": "true" | "false",
    // ... etc
}
```

### Legacy Action Payloads

| Action | Payload |
|--------|---------|
| `loadPatients` | `{ action: "loadPatients", workerId: string }` |
| `generateSummaries` | `{ action: "generateSummaries", workerId: string, patientIds: string[] }` + toggle inputs |
| `searchPatient` | `{ action: "searchPatient" }` + form input `patientSearch` |

---

## Helper Functions

### `formatDisplayDate(dateStr)`

Formats date for display.

```javascript
function formatDisplayDate(dateStr: string): string
// "2025-01-15" → "Jan 15, 2025"
```

### `getDaysUntil(dateStr)`

Calculates days until a date.

```javascript
function getDaysUntil(dateStr: string): number
// Returns negative if past, positive if future
```

---

## Teams Limitations

### ActionSet Limit

Teams limits ActionSet to 6 actions. The card builder chunks expandable sections:

```javascript
for (let i = 0; i < expandableActions.length; i += 6) {
    const chunk = expandableActions.slice(i, i + 6);
    card.body.push({
        "type": "ActionSet",
        "actions": chunk
    });
}
```

### Card Version

All cards use Adaptive Cards version 1.5:

```json
{
    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
    "type": "AdaptiveCard",
    "version": "1.5"
}
```
