# Bot-Recert Documentation

A Microsoft Teams bot for home health nurses to access patient episode summaries for recertification visits.

## Quick Start

```bash
# Install dependencies
npm install

# Start the PDF extraction service (required for document summaries)
cd pdf-service
pip install -r requirements.txt
uvicorn main:app --port 8000

# Start the bot (in another terminal)
cd ..
npm start
```

The bot runs on `http://localhost:3978/api/messages`.

## Technology Stack

| Layer | Technology |
|-------|------------|
| Bot Framework | Microsoft Bot Framework SDK v4 |
| Server | Node.js + Express |
| FHIR API | HCHB FHIR R4 |
| AI Summarization | Azure OpenAI (GPT-4o) |
| PDF Extraction | Python FastAPI + pdfplumber |
| UI | Adaptive Cards |

## Documentation Index

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System overview, component diagram, data flow |
| [SERVICES.md](./SERVICES.md) | All 8 services with function signatures |
| [BOT-FLOW.md](./BOT-FLOW.md) | Conversation flow, action handlers, session state |
| [CARDS.md](./CARDS.md) | Adaptive Cards reference (12 builders, 15 resource categories) |
| [API-REFERENCE.md](./API-REFERENCE.md) | HCHB FHIR API, Azure OpenAI integration |
| [ENVIRONMENT.md](./ENVIRONMENT.md) | Environment variables and configuration |
| [DATA-FLOW.md](./DATA-FLOW.md) | Data flow diagrams for major workflows |

## Project Structure

```
bot-recert/
├── index.js                    # Main bot server (805 lines)
├── cards/
│   └── cardBuilder.js          # Adaptive Card builders (2,038 lines)
├── services/
│   ├── fhirClient.js           # OAuth2 + FHIR HTTP client (240 lines)
│   ├── fhirService.js          # FHIR data operations (1,411 lines)
│   ├── patientService.js       # Patient queries (429 lines)
│   ├── dataFetchService.js     # Multi-resource fetching (720 lines)
│   ├── documentService.js      # Document retrieval (438 lines)
│   ├── azureOpenAIService.js   # AI summarization (343 lines)
│   ├── summaryService.js       # Episode summaries (181 lines)
│   └── pythonBackendClient.js  # Python backend client (208 lines)
├── pdf-service/
│   ├── main.py                 # FastAPI PDF extraction (230 lines)
│   └── requirements.txt        # Python dependencies
├── docs/                       # Documentation
└── package.json
```

## Key Features

1. **Worker Authentication** - Validates worker ID against HCHB Practitioner records
2. **Date-based Patient List** - Shows scheduled patients for a specific date
3. **FHIR Resource Browser** - Access 40+ FHIR resource types organized in 14 categories
4. **AI Document Summaries** - Automatic PDF extraction and AI-powered summarization
5. **Background Processing** - Pre-loads document summaries while user browses

## Environment Setup

Create a `.env` file with required credentials:

```env
# Bot Framework
MicrosoftAppId=your-app-id
MicrosoftAppPassword=your-app-password

# HCHB FHIR API
HCHB_API_BASE_URL=https://api.hchb.com/fhir/r4
HCHB_TOKEN_URL=https://idp.hchb.com/connect/token
HCHB_CLIENT_ID=your-client-id
HCHB_AGENCY_SECRET=your-agency-secret

# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_DEPLOYMENT=gpt-4o

# Python Backend
PYTHON_BACKEND_URL=http://localhost:8000/api/v1
```

See [ENVIRONMENT.md](./ENVIRONMENT.md) for complete configuration reference.

## Main Workflows

### 1. Worker Login Flow
```
Welcome Card → Enter Worker ID → Validate → Auto-load Today's Patients
```

### 2. Patient Selection Flow
```
Patient List → Select Patient → AI Summary Card (if available) → Resource Selection
```

### 3. Document Analysis Flow
```
Patient Documents → PDF Extraction → Azure OpenAI Summary → Display
```

## Support

For issues or questions:
- Review the documentation in this folder
- Check the console logs for debugging
- Verify environment variables are set correctly
