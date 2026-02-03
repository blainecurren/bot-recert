# Bot Flow Documentation

This document describes the conversation flow, action handlers, and session state management in the Bot-Recert application.

## Table of Contents

1. [Entry Points](#entry-points)
2. [RecertBot Class](#recertbot-class)
3. [Action Handlers](#action-handlers)
4. [Session State Management](#session-state-management)
5. [Conversation Flows](#conversation-flows)

---

## Entry Points

### Express Server Setup

```javascript
const app = express();
app.use(express.json());

// Health check
app.get('/', (req, res) => {
    res.send('Bot is running!');
});

// Bot messages endpoint
app.post('/api/messages', async (req, res) => {
    await adapter.process(req, res, async (context) => {
        await bot.run(context);
    });
});

// Start server
const port = process.env.PORT || 3978;
app.listen(port, '0.0.0.0');
```

### Bot Framework Adapter

```javascript
// Local debug mode (no auth)
if (LOCAL_DEBUG) {
    const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({});
    adapter = new CloudAdapter(botFrameworkAuth);
}

// Production mode (with Azure credentials)
else {
    const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({
        MicrosoftAppId: process.env.MicrosoftAppId,
        MicrosoftAppPassword: process.env.MicrosoftAppPassword,
        MicrosoftAppType: process.env.MicrosoftAppType,
        MicrosoftAppTenantId: process.env.MicrosoftAppTenantId
    });
    adapter = new CloudAdapter(botFrameworkAuth);
}
```

---

## RecertBot Class

The `RecertBot` class extends `ActivityHandler` and handles all bot interactions.

### Constructor

```javascript
class RecertBot extends ActivityHandler {
    constructor() {
        super();

        // Session state storage
        this.workerContext = new Map();

        // Register handlers
        this.onMessage(async (context, next) => { ... });
        this.onMembersAdded(async (context, next) => { ... });
    }
}
```

### Message Handler

```javascript
this.onMessage(async (context, next) => {
    const value = context.activity.value;

    if (value && value.action) {
        // Adaptive Card submit action
        await this.handleCardAction(context, value);
    } else {
        // Regular text message - show welcome
        await this.sendWelcomeCard(context);
    }

    await next();
});
```

### Members Added Handler

```javascript
this.onMembersAdded(async (context, next) => {
    for (const member of context.activity.membersAdded) {
        if (member.id !== context.activity.recipient.id) {
            await this.sendWelcomeCard(context);
        }
    }
    await next();
});
```

---

## Action Handlers

### Action Router

```javascript
async handleCardAction(context, value) {
    switch (value.action) {
        case 'validateWorker':
            await this.handleValidateWorker(context, value.workerId);
            break;
        case 'loadPatientsByDate':
            await this.handleLoadPatientsByDate(context, value.workerId, value.selectedDate);
            break;
        case 'selectPatient':
            await this.handlePatientSelect(context, value.patientId, value.patientName, value.skipSummary);
            break;
        case 'fetchResources':
            await this.handleFetchResources(context, value);
            break;
        case 'backToPatients':
            await this.handleBackToPatients(context);
            break;
        case 'backToDateSelection':
            await this.handleBackToDateSelection(context);
            break;
        case 'backToResourceSelection':
            await this.handleBackToResourceSelection(context);
            break;
        case 'viewDocuments':
            await this.handleViewDocuments(context, value.patientId, value.patientName);
            break;
        case 'newSearch':
            await this.sendWelcomeCard(context);
            break;
        // Legacy actions
        case 'loadPatients':
            await this.handleLoadPatients(context, value.workerId);
            break;
        case 'generateSummaries':
            await this.handleGenerateSummaries(context, value);
            break;
        case 'searchPatient':
            await this.handlePatientSearch(context, value.patientSearch);
            break;
        default:
            await this.sendWelcomeCard(context);
    }
}
```

### Action Handler Details

#### `handleValidateWorker(context, workerId)`

**Purpose**: Validates worker ID and auto-loads today's patients

**Flow**:
1. Validate workerId not empty
2. Call `patientService.getWorkerById(workerId)`
3. If not found, show error card
4. Store worker in `workerContext`
5. Auto-load today's patients via `handleLoadPatientsByDate`

**Sends**:
- Processing message: "Validating your Worker ID..."
- Welcome message: "Welcome, {name}! Loading your patients for today..."
- Error card if worker not found

---

#### `handleLoadPatientsByDate(context, workerId, selectedDate)`

**Purpose**: Loads patients scheduled for a worker on a specific date

**Flow**:
1. Validate date not empty
2. Get/restore worker context
3. Call `patientService.getPatientsByWorkerAndDate(workerId, selectedDate)`
4. Store patients in context
5. Build and send patient selection card
6. Start background document pre-loading

**Sends**:
- Processing message: "Loading your patients for {date}..."
- Patient selection card
- Note if no patients found
- AI analysis status messages

---

#### `preloadDocumentSummaries(context, patients, conversationId)`

**Purpose**: Pre-loads AI document summaries for all patients in background

**Flow**:
1. Notify user: "Analyzing clinical documents..."
2. Call `documentService.batchFetchAndSummarizeDocuments(patients)`
3. Update `workerContext.documentSummaries`
4. Notify user: "AI analysis complete..."

**Sends**:
- Start notification: "Analyzing clinical documents for X patient(s)..."
- Completion notification with counts
- Error note if analysis encounters issues

---

#### `handlePatientSelect(context, patientId, patientName, skipSummary)`

**Purpose**: Handles patient selection and shows appropriate card

**Flow**:
1. Validate patientId
2. Find patient in context or create minimal object
3. Store selectedPatient in context
4. Check for pre-loaded AI summary
5. If summary available and !skipSummary: show AI summary card
6. Else: show resource selection card

**Sends**:
- AI Summary card (if summary available and not skipped)
- Resource selection card (otherwise)

---

#### `handleFetchResources(context, value)`

**Purpose**: Fetches selected FHIR resources and displays results

**Flow**:
1. Validate worker and patient context
2. Extract selected resources from form data
3. Validate at least one resource selected
4. Send processing message
5. Call `dataFetchService.fetchSelectedResources()`
6. Apply formatting to results
7. Generate AI summaries for complex types (TODO)
8. Build and send data results card

**Sends**:
- Processing message: "Fetching X data type(s)..."
- Data results card
- Error card if fetch fails

---

#### `handleViewDocuments(context, patientId, patientName)`

**Purpose**: Shows all documents for a patient

**Flow**:
1. Validate patientId
2. Send processing message
3. Call `documentService.getPatientDocuments(patientId)`
4. Get patient info from context
5. Build and send document list card

**Sends**:
- Processing message: "Fetching patient documents..."
- Document list card
- Error card if fetch fails

---

#### `handleBackToPatients(context)`

**Purpose**: Navigates back to patient list

**Flow**:
1. Get worker context
2. If context exists: show recert patient list card
3. Else: show welcome card

---

#### `handleBackToDateSelection(context)`

**Purpose**: Navigates back to date selection

**Flow**:
1. Get worker context
2. If context with worker exists: show date selection card
3. Else: show welcome card

---

#### `handleBackToResourceSelection(context)`

**Purpose**: Navigates back to resource selection

**Flow**:
1. Get worker context
2. If context with worker and selectedPatient: show resource selection card
3. Else: show welcome card

---

### Legacy Action Handlers

#### `handleLoadPatients(context, workerId)`

Legacy handler for loading recert patients without date selection.

#### `handleGenerateSummaries(context, value)`

Legacy handler for generating summaries for multiple selected patients.

#### `handlePatientSearch(context, searchTerm)`

Legacy handler for patient name search.

---

## Session State Management

### Worker Context Structure

```javascript
this.workerContext = new Map();

// Key: context.activity.conversation.id
// Value:
{
    worker: {
        id: string,
        identifier: string,
        name: string,
        active: boolean
    },
    selectedDate: string,           // "YYYY-MM-DD"
    patients: Patient[],            // Array of scheduled patients
    selectedPatient: Patient,       // Currently selected patient
    documentSummaries: {            // Pre-loaded AI summaries
        [patientId]: {
            success: boolean,
            totalDocuments: number,
            processedCount: number,
            documents: DocumentSummary[],
            consolidated: ConsolidatedSummary
        }
    },
    selectedResources: string[]     // Selected FHIR resources
}
```

### Context Operations

#### Setting Context

```javascript
const conversationId = context.activity.conversation.id;

// Initial setup after worker validation
this.workerContext.set(conversationId, {
    worker,
    selectedDate: null,
    patients: [],
    selectedPatient: null
});

// Update after loading patients
workerCtx.selectedDate = selectedDate;
workerCtx.patients = patients;
workerCtx.documentSummaries = {};
this.workerContext.set(conversationId, workerCtx);

// Update after selecting patient
workerCtx.selectedPatient = patient;
this.workerContext.set(conversationId, workerCtx);
```

#### Getting Context

```javascript
const conversationId = context.activity.conversation.id;
const workerCtx = this.workerContext.get(conversationId);

if (!workerCtx || !workerCtx.worker) {
    await this.sendWelcomeCard(context);
    return;
}
```

---

## Conversation Flows

### Main Flow Diagram

```
┌─────────────────┐
│  User Opens     │
│     Bot         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Welcome Card   │◄──────────────────────┐
│  (Enter Worker  │                       │
│      ID)        │                       │
└────────┬────────┘                       │
         │ validateWorker                  │
         ▼                                │
┌─────────────────┐                       │
│ Validate Worker │                       │
│    (FHIR/API)   │                       │
└────────┬────────┘                       │
         │                                │
    ┌────┴────┐                           │
    │         │                           │
    ▼         ▼                           │
 Found    Not Found                       │
    │         │                           │
    │         ▼                           │
    │    Error Card ──────────────────────┤
    │                                     │
    ▼                                     │
┌─────────────────┐                       │
│ Auto-Load       │                       │
│ Today's         │                       │
│ Patients        │                       │
└────────┬────────┘                       │
         │                                │
         ▼                                │
┌─────────────────┐     ┌─────────────────┐
│ Patient         │     │ Background:     │
│ Selection       │────►│ Pre-load AI     │
│ Card            │     │ Summaries       │
└────────┬────────┘     └─────────────────┘
         │
         │ selectPatient
         ▼
┌─────────────────┐
│ AI Summary      │ (if summaries available)
│ Available?      │
└────────┬────────┘
    ┌────┴────┐
    │         │
   Yes        No
    │         │
    ▼         │
┌─────────────────┐     │
│ AI Summary      │     │
│ Card            │     │
└────────┬────────┘     │
         │              │
         │ "View All    │
         │  Data"       │
         ▼              ▼
┌─────────────────────────┐
│ Resource Selection      │
│ Card                    │
│ (14 categories,         │
│  40+ resources)         │
└────────┬────────────────┘
         │ fetchResources
         ▼
┌─────────────────┐
│ Data Results    │
│ Card            │
└────────┬────────┘
         │
         ▼
    Navigation Options:
    - Select More Data
    - Back to Patients
    - New Search
```

### Date Selection Flow

```
┌─────────────────┐
│ Date Selection  │◄── backToDateSelection
│ Card            │
└────────┬────────┘
         │ loadPatientsByDate
         ▼
┌─────────────────┐
│ Fetch Patients  │
│ by Date         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Patient         │
│ Selection Card  │
└─────────────────┘
```

### Document Viewing Flow

```
┌─────────────────┐
│ Patient         │
│ Selected        │
└────────┬────────┘
         │ viewDocuments
         ▼
┌─────────────────┐
│ Fetch Documents │
│ from FHIR       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Document List   │
│ Card            │
│ (grouped by     │
│  type)          │
└────────┬────────┘
         │
         ▼
    Navigation:
    - Back to Data Selection
    - Back to Patients
    - New Search
```

### Error Handling Flow

```
┌─────────────────┐
│ Any Action      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Try Operation   │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
 Success    Error
    │         │
    ▼         ▼
 Continue   Log Error
    │         │
    │         ▼
    │    Build Error
    │    Card
    │         │
    │         ▼
    │    Send Error
    │    Card to User
    │         │
    └────┬────┘
         │
         ▼
   Continue Flow
```

### Navigation Actions Summary

| Action | Source Card | Target Card |
|--------|-------------|-------------|
| `newSearch` | Any | Welcome Card |
| `backToPatients` | Any | Patient List |
| `backToDateSelection` | Patient List | Date Selection |
| `backToResourceSelection` | Data Results | Resource Selection |

### State Transitions

```
Welcome → Worker Validated → Date Selected → Patient Selected → Resources Fetched
   │              │                │                │                │
   │              │                │                │                ▼
   │              │                │                │          Data Results
   │              │                │                │                │
   │              │                │                ◄────────────────┘
   │              │                │                      (select more)
   │              │                ◄────────────────────────────────┘
   │              │                         (back to patients)
   │              ◄────────────────────────────────────────────────┘
   │                          (back to date selection)
   ◄───────────────────────────────────────────────────────────────┘
                             (new search)
```
