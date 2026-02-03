# API Reference

This document describes the external APIs integrated with the Bot-Recert application.

## Table of Contents

1. [HCHB FHIR R4 API](#hchb-fhir-r4-api)
2. [Azure OpenAI API](#azure-openai-api)
3. [Microsoft Bot Framework](#microsoft-bot-framework)

---

## HCHB FHIR R4 API

### Overview

The HCHB FHIR R4 API provides access to clinical data in the Homecare Homebase system. The bot uses this API to retrieve patient information, episodes, documents, and clinical data.

### Base URL

```
https://api.hchb.com/fhir/r4
```

### Authentication

The API uses OAuth2 with the `agency_auth` grant type.

#### Token Request

```http
POST {HCHB_TOKEN_URL}
Content-Type: application/x-www-form-urlencoded

grant_type=agency_auth
&client_id={HCHB_CLIENT_ID}
&scope=openid HCHB.api.scope agency.identity hchb.identity
&resource_security_id={HCHB_RESOURCE_SECURITY_ID}
&agency_secret={HCHB_AGENCY_SECRET}
```

#### Token Response

```json
{
    "access_token": "eyJ...",
    "expires_in": 3600,
    "token_type": "Bearer"
}
```

### FHIR Resources Used

#### Patient

```http
GET /Patient/{id}
GET /Patient?name={searchTerm}&_count=20
GET /Patient?identifier={mrn}
```

**Response Fields:**
- `id` - FHIR resource ID
- `name` - HumanName array
- `birthDate` - Date of birth
- `identifier` - MRN and other identifiers
- `managingOrganization` - Reference to Organization

---

#### Practitioner (Worker)

```http
GET /Practitioner/{id}
GET /Practitioner?identifier={workerId}
GET /Practitioner?_id={workerId}
GET /Practitioner?name={name}
```

**Response Fields:**
- `id` - FHIR resource ID
- `name` - HumanName array
- `active` - Boolean status

---

#### Appointment

```http
GET /Appointment?actor=Practitioner/{workerId}&date={YYYY-MM-DD}&_count=100
GET /Appointment?patient=Patient/{patientId}&_count=50&_sort=-date
```

**HCHB-specific Extensions:**
```javascript
// Patient reference in extension (not participant)
const subjectExt = appointment.extension?.find(ext =>
    ext.url === 'https://api.hchb.com/fhir/r4/StructureDefinition/subject'
);
const patientRef = subjectExt?.valueReference?.reference;
```

**Service Type Codes:**
- `SN11`, `RN10`, `LVN11`, etc. - Discipline-specific visit codes
- Used for filtering valid clinical visits

---

#### EpisodeOfCare

```http
GET /EpisodeOfCare?patient=Patient/{patientId}&status=active
GET /EpisodeOfCare?status=active&_count=100&_include=EpisodeOfCare:patient
```

**Response Fields:**
- `status` - active, finished, cancelled
- `period.start`, `period.end` - Episode dates
- `diagnosis` - Primary diagnosis reference

---

#### DocumentReference

```http
GET /DocumentReference?patient={patientId}&_count=50&_sort=-date
GET /DocumentReference?patient={patientId}&type={typeCode}
GET /DocumentReference?patient={patientId}&date=ge{YYYY-MM-DD}
```

**Response Fields:**
- `type` - Document type (coding)
- `date` - Document date
- `content[0].attachment.url` - PDF download URL
- `content[0].attachment.contentType` - MIME type
- `description` - Document description

---

#### Condition

```http
GET /Condition?subject=Patient/{patientId}&clinical-status=active
GET /Condition?subject=Patient/{patientId}&category=wound
```

**Response Fields:**
- `code.coding[0].code` - ICD-10 code
- `code.coding[0].display` - Diagnosis name
- `clinicalStatus` - active, recurrence, relapse
- `bodySite` - For wound conditions

---

#### MedicationRequest

```http
GET /MedicationRequest?subject=Patient/{patientId}&status=active
```

**Response Fields:**
- `medicationCodeableConcept` - Drug name/code
- `dosageInstruction[0].text` - Dosage text
- `dosageInstruction[0].timing.code.text` - Frequency

---

#### Observation (Vitals)

```http
GET /Observation?subject=Patient/{patientId}&code={loincCode}&_count=10&_sort=-date
```

**LOINC Codes:**
| Code | Vital Sign |
|------|------------|
| 8310-5 | Body Temperature |
| 85354-9 | Blood Pressure Panel |
| 8480-6 | Systolic BP (component) |
| 8462-4 | Diastolic BP (component) |
| 39156-5 | BMI |
| 29463-7 | Body Weight |
| 8867-4 | Heart Rate |
| 2708-6 | Oxygen Saturation |
| 9279-1 | Respiratory Rate |
| 9843-4 | Head Circumference |

---

#### AllergyIntolerance

```http
GET /AllergyIntolerance?patient=Patient/{patientId}
```

**Response Fields:**
- `code` - Substance
- `criticality` - low, high, unable-to-assess
- `reaction[0].manifestation` - Reaction type
- `reaction[0].severity` - mild, moderate, severe

---

#### CareTeam

```http
GET /CareTeam?subject=Patient/{patientId}&status=active
```

**Response Fields:**
- `participant[].member` - Team member reference
- `participant[].role` - Role in care team

---

#### CarePlan

```http
GET /CarePlan?subject=Patient/{patientId}&status=active
```

**Response Fields:**
- `title`, `description` - Plan details
- `period` - Effective dates
- `goal` - References to Goal resources
- `activity` - Planned activities

---

#### Encounter

```http
GET /Encounter?subject=Patient/{patientId}&_count=10&_sort=-date
```

**Response Fields:**
- `period.start` - Visit date
- `type` - Visit type
- `reasonCode` - Visit reason
- `status` - in-progress, finished

---

#### Organization

```http
GET /Organization/{id}
GET /Organization?type=branch&_count=5
```

**Response Fields:**
- `name` - Organization name
- `alias` - Alternative names
- `telecom` - Contact info
- `address` - Physical address

---

#### RelatedPerson

```http
GET /RelatedPerson?patient=Patient/{patientId}
```

**Response Fields:**
- `name` - Contact name
- `relationship` - Relationship to patient
- `telecom` - Phone/email

---

## Azure OpenAI API

### Overview

Azure OpenAI provides AI-powered document summarization and clinical data extraction.

### Configuration

```javascript
const client = new AzureOpenAI({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    apiVersion: "2024-08-01-preview"
});
```

### Chat Completions

```javascript
const response = await client.chat.completions.create({
    model: deployment,  // e.g., "gpt-4o"
    messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
    ],
    max_tokens: 1000,
    temperature: 0.3
});
```

### Usage Patterns

#### Document Summarization

```javascript
// Single document
const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
        {
            role: "system",
            content: `You are a clinical documentation specialist helping home health nurses...`
        },
        {
            role: "user",
            content: `Please summarize this ${documentType}:\n\n${documentText}`
        }
    ],
    max_tokens: 1000,
    temperature: 0.3
});
```

#### Multi-Document Consolidation

```javascript
// Multiple documents
const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
        {
            role: "system",
            content: `You are a clinical documentation specialist... consolidate multiple documents...`
        },
        {
            role: "user",
            content: `Patient Context: ${patientName}\n\n--- Document 1 ---\n${doc1}\n\n--- Document 2 ---\n${doc2}`
        }
    ],
    max_tokens: 1500,
    temperature: 0.3
});
```

#### Clinical Data Extraction

```javascript
// Structured extraction with JSON response
const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
        {
            role: "system",
            content: `You are a clinical data extraction specialist. Return JSON with: diagnoses, medications, vitals...`
        },
        {
            role: "user",
            content: `Extract structured clinical data from:\n\n${documentText}`
        }
    ],
    max_tokens: 1000,
    temperature: 0.1,
    response_format: { type: "json_object" }
});
```

### Vision API (PDF OCR)

Used in Python backend for scanned document OCR:

```python
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {
            "role": "system",
            "content": "You are an OCR assistant. Extract ALL text from this medical document image exactly as written..."
        },
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Extract all text from this medical document page:"},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/png;base64,{img_base64}",
                        "detail": "high"
                    }
                }
            ]
        }
    ],
    max_tokens=4000,
    temperature=0.1
)
```

### Token Usage Tracking

```javascript
const usage = response.usage;
console.log(`Tokens: ${usage.prompt_tokens} prompt + ${usage.completion_tokens} completion = ${usage.total_tokens} total`);
```

---

## Microsoft Bot Framework

### Overview

The Bot Framework SDK provides the infrastructure for the Teams bot, handling messaging, authentication, and activity processing.

### Key Components

#### CloudAdapter

```javascript
const { CloudAdapter, ConfigurationBotFrameworkAuthentication } = require('botbuilder');

const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({
    MicrosoftAppId: process.env.MicrosoftAppId,
    MicrosoftAppPassword: process.env.MicrosoftAppPassword,
    MicrosoftAppType: process.env.MicrosoftAppType,
    MicrosoftAppTenantId: process.env.MicrosoftAppTenantId
});

const adapter = new CloudAdapter(botFrameworkAuth);
```

#### ActivityHandler

```javascript
const { ActivityHandler } = require('botbuilder');

class RecertBot extends ActivityHandler {
    constructor() {
        super();

        this.onMessage(async (context, next) => {
            // Handle messages
            await next();
        });

        this.onMembersAdded(async (context, next) => {
            // Handle new members
            await next();
        });
    }
}
```

#### CardFactory

```javascript
const { CardFactory } = require('botbuilder');

// Create Adaptive Card attachment
const card = CardFactory.adaptiveCard(cardJson);
await context.sendActivity({ attachments: [card] });
```

### Activity Processing

```javascript
app.post('/api/messages', async (req, res) => {
    await adapter.process(req, res, async (context) => {
        await bot.run(context);
    });
});
```

### Activity Properties

```javascript
// Incoming activity
const activity = context.activity;

activity.type           // "message", "conversationUpdate"
activity.text           // Text message content
activity.value          // Adaptive Card submit data
activity.conversation   // { id: "conversation-id" }
activity.from           // { id: "user-id", name: "User Name" }
activity.recipient      // { id: "bot-id", name: "Bot Name" }
```

### Sending Messages

```javascript
// Send text
await context.sendActivity('Hello!');

// Send card
await context.sendActivity({ attachments: [card] });

// Send multiple
await context.sendActivities([
    { type: 'message', text: 'Processing...' },
    { type: 'message', attachments: [card] }
]);
```

### Error Handling

```javascript
adapter.onTurnError = async (context, error) => {
    console.error(`[onTurnError] Error: ${error}`);
    console.error(error.stack);
    await context.sendActivity('Oops. Something went wrong!');
};
```

### App Registration Settings

| Setting | Description |
|---------|-------------|
| `MicrosoftAppId` | Azure AD App ID |
| `MicrosoftAppPassword` | App secret |
| `MicrosoftAppType` | "SingleTenant" for org-only |
| `MicrosoftAppTenantId` | Azure AD Tenant ID |

### Local Debug Mode

```javascript
const LOCAL_DEBUG = process.env.LOCAL_DEBUG === 'true';

if (LOCAL_DEBUG) {
    // Skip authentication for local testing
    const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({});
    adapter = new CloudAdapter(botFrameworkAuth);
}
```

### Teams-Specific Considerations

1. **Adaptive Cards v1.5** - Teams supports version 1.5
2. **ActionSet Limit** - Maximum 6 actions per ActionSet
3. **Card Size** - Keep cards under 28KB
4. **ShowCard** - Nested cards work in Teams
5. **ToggleVisibility** - Supported for collapsible sections
