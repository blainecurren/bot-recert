# Architecture Overview

This document describes the system architecture of the Bot-Recert application.

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Microsoft Teams                                 │
│                                                                             │
│  ┌─────────────────┐                                                        │
│  │  Teams Client   │◄────────────────────────────────────────────┐          │
│  │  (User Device)  │                                             │          │
│  └────────┬────────┘                                             │          │
└───────────┼──────────────────────────────────────────────────────┼──────────┘
            │                                                      │
            │ Adaptive Cards                                       │ Activities
            │ + Actions                                            │
            ▼                                                      │
┌───────────────────────────────────────────────────────────────────┐
│                    Azure Bot Service                              │
│                  (Channel Registration)                           │
└─────────────────────────────┬─────────────────────────────────────┘
                              │
                              │ POST /api/messages
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Node.js Bot Server                                   │
│                           (index.js)                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        RecertBot Class                               │    │
│  │  - onMessage() handler                                               │    │
│  │  - onMembersAdded() handler                                          │    │
│  │  - handleCardAction() router                                         │    │
│  │  - workerContext Map (session state)                                 │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│              ┌───────────────┼───────────────┐                              │
│              ▼               ▼               ▼                              │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐                   │
│  │  cardBuilder  │  │   Services    │  │   Express     │                   │
│  │  (Adaptive    │  │    Layer      │  │   Server      │                   │
│  │   Cards)      │  │               │  │  :3978        │                   │
│  └───────────────┘  └───────┬───────┘  └───────────────┘                   │
└─────────────────────────────┼───────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ Python Backend│    │  HCHB FHIR    │    │ Azure OpenAI  │
│  (FastAPI)    │    │    R4 API     │    │   (GPT-4o)    │
│   :8000       │    │               │    │               │
│               │    │               │    │               │
│ - PDF Extract │    │ - Patient     │    │ - Summarize   │
│ - Vision OCR  │    │ - Episodes    │    │ - Extract     │
│ - Mock Data   │    │ - Documents   │    │ - Consolidate │
└───────────────┘    └───────────────┘    └───────────────┘
```

## Component Responsibilities

### 1. Bot Server (`index.js`)

The main entry point handling:
- Express server on port 3978
- Bot Framework CloudAdapter configuration
- Message and member event handlers
- Action routing via `handleCardAction()`
- Session state via `workerContext` Map
- Background document pre-loading

### 2. Services Layer

| Service | Responsibility |
|---------|---------------|
| `fhirClient.js` | OAuth2 authentication, HTTP client for FHIR API |
| `fhirService.js` | 50+ FHIR data operations, Python backend fallback |
| `patientService.js` | Worker validation, patient queries by date |
| `dataFetchService.js` | Multi-resource fetching, data formatting |
| `documentService.js` | Document retrieval, PDF extraction, batch summarization |
| `azureOpenAIService.js` | AI summarization, clinical data extraction |
| `summaryService.js` | Episode summary generation |
| `pythonBackendClient.js` | HTTP client for Python backend |

### 3. Cards Layer (`cardBuilder.js`)

Builds all Adaptive Cards:
- Welcome/login card
- Date selection card
- Patient selection card
- Resource selection card (14 categories, 40+ resources)
- Data results card
- AI summary card
- Document list card
- Error cards

### 4. Python Backend (`main.py`)

FastAPI server providing:
- PDF text extraction (pdfplumber)
- Vision OCR fallback (GPT-4o for scanned documents)
- Mock FHIR endpoints for development
- Worker validation endpoints

## Technology Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         Microsoft Teams + Adaptive Cards               │  │
│  └───────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                    Application Layer                         │
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │   Bot Server    │  │   Services   │  │ Card Builder │   │
│  │   (Node.js)     │  │   (Node.js)  │  │   (Node.js)  │   │
│  │   Express       │  │              │  │              │   │
│  │   BotBuilder    │  │              │  │              │   │
│  └─────────────────┘  └──────────────┘  └──────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                    Integration Layer                         │
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  FHIR Client    │  │   Python     │  │ Azure OpenAI │   │
│  │   (OAuth2)      │  │   Client     │  │   Client     │   │
│  │   (Axios)       │  │   (Axios)    │  │   (openai)   │   │
│  └─────────────────┘  └──────────────┘  └──────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                    External Services                         │
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │   HCHB FHIR     │  │   Python     │  │ Azure OpenAI │   │
│  │   R4 API        │  │   FastAPI    │  │   GPT-4o     │   │
│  └─────────────────┘  └──────────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Key Dependencies

### Node.js (package.json)

```json
{
  "dependencies": {
    "axios": "^1.13.2",        // HTTP client
    "botbuilder": "^4.23.3",   // Bot Framework SDK
    "dotenv": "^17.2.3",       // Environment config
    "express": "^4.21.0",      // Web server
    "openai": "^6.16.0"        // Azure OpenAI SDK
  }
}
```

### Python (requirements)

```
fastapi          # Web framework
uvicorn          # ASGI server
pdfplumber       # PDF text extraction
httpx            # Async HTTP client
python-dotenv    # Environment config
PyMuPDF          # PDF to image (for Vision OCR)
openai           # Azure OpenAI SDK
```

## Data Flow Architecture

### Request Flow

```
1. User Action in Teams
   │
   ├── Text Message ─────────► Welcome Card
   │
   └── Card Action ──────────► handleCardAction()
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              validateWorker  selectPatient   fetchResources
                    │               │               │
                    ▼               ▼               ▼
             patientService   documentService  dataFetchService
                    │               │               │
                    ├───────────────┴───────────────┤
                    │                               │
                    ▼                               ▼
            Python Backend                    FHIR API
            (if available)                  (fallback)
```

### Response Flow

```
Service Result
     │
     ▼
cardBuilder.build*Card()
     │
     ▼
CardFactory.adaptiveCard()
     │
     ▼
context.sendActivity()
     │
     ▼
Teams Client
```

## Session State Management

The bot maintains session state per conversation using a `Map`:

```javascript
workerContext = new Map();

// Key: conversation.id
// Value: {
//   worker: { id, name, role, active },
//   selectedDate: "YYYY-MM-DD",
//   patients: [...],
//   selectedPatient: { id, fullName, ... },
//   documentSummaries: { patientId: summaryData },
//   selectedResources: [...]
// }
```

## Error Handling Strategy

```
┌─────────────────┐
│  Error Occurs   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Catch in        │────►│ Log to Console  │
│ Handler         │     └─────────────────┘
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Build Error     │────►│ Send to User    │
│ Card            │     │ via Teams       │
└─────────────────┘     └─────────────────┘
```

## Scalability Considerations

1. **Stateless Design**: Worker context can be moved to external storage (Redis, CosmosDB)
2. **Async Processing**: Document summaries pre-loaded in background
3. **Fallback Pattern**: Python backend → Direct FHIR when backend unavailable
4. **Concurrency Control**: Batch document processing with configurable concurrency (default: 3)
