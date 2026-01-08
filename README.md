# Recert Episode Summary Bot

A Microsoft Teams bot that helps home health nurses quickly access patient episode summaries for recertification visits.

## Features

- **Patient Search**: Search for patients by first or last name
- **Episode Summary**: View comprehensive 60-day episode summaries including:
  - Patient demographics and diagnoses
  - Clinical alerts and priorities
  - Visit timeline
  - Goals progress
  - Current medications
- **Adaptive Cards UI**: Rich, interactive cards for easy navigation

## Prerequisites

- Node.js v18+ (tested on v24)
- ngrok (for local testing with Teams)
- Azure account with:
  - Azure Bot resource
  - App Registration (Single Tenant)

## Project Structure

```
bot-recert/
├── index.js                 # Main bot server and logic
├── package.json             # Dependencies
├── .env                     # Environment variables (credentials)
├── cards/
│   ├── welcomeCard.json     # Welcome/search card template
│   ├── patientListCard.json # Search results template
│   ├── summaryCard.json     # Episode summary template
│   └── cardBuilder.js       # Dynamic card generation
├── services/
│   ├── patientService.js    # Patient data operations
│   └── summaryService.js    # Summary generation
└── data/
    └── mockPatients.json    # Mock patient data for testing
```

## Local Development Setup

### 1. Clone and Install

```bash
cd bot-recert
npm install
```

### 2. Configure Environment

Create a `.env` file with your Azure credentials:

```env
MicrosoftAppId=your-app-id
MicrosoftAppPassword=your-app-password
MicrosoftAppType=SingleTenant
MicrosoftAppTenantId=your-tenant-id
```

### 3. Start the Bot

```bash
node index.js
```

The bot will start on `http://localhost:3978`

## Testing with ngrok

### 1. Start ngrok

```bash
ngrok http 3978
```

### 2. Copy the HTTPS URL

ngrok will display a forwarding URL like:
```
https://abc123.ngrok-free.app -> http://localhost:3978
```

### 3. Update Azure Bot

In Azure Portal > Your Bot > Configuration:
- Set **Messaging endpoint** to: `https://abc123.ngrok-free.app/api/messages`

## Azure Bot Setup

### 1. Create App Registration

1. Go to Azure Portal > App registrations > New registration
2. Name: `RecertBot`
3. Supported account types: **Accounts in this organizational directory only**
4. Register

### 2. Create Client Secret

1. In your App Registration > Certificates & secrets
2. New client secret
3. Copy the secret value (you won't see it again)

### 3. Create Azure Bot

1. Go to Azure Portal > Create a resource > Azure Bot
2. Bot handle: `recert-bot`
3. Pricing: Free tier for testing
4. Microsoft App ID: Use existing > paste your App ID
5. App type: **Single Tenant**
6. App tenant ID: Your Azure AD tenant ID

### 4. Configure Messaging Endpoint

1. In Azure Bot > Configuration
2. Messaging endpoint: Your ngrok URL + `/api/messages`

## Testing in Teams

### Option 1: Azure Web Chat

1. In Azure Portal > Your Bot > Test in Web Chat
2. Send any message to see the welcome card

### Option 2: Teams Sideload

1. Create a Teams app manifest (manifest.json)
2. Package as ZIP with manifest + icons
3. In Teams > Apps > Manage your apps > Upload a custom app

## Usage

1. **Start a conversation** - Send any message to see the welcome card
2. **Search for a patient** - Enter a name and click Search
3. **View patient details** - Click "View" on a patient from search results
4. **Explore summary** - Expand Timeline, Goals, or Medications sections
5. **New search** - Click "New Search" to start over

## Mock Patient Data

The bot includes 6 mock patients for testing:
- John Smith (CHF)
- Margaret Johnson (COPD)
- Robert Williams (Post-TKA)
- Dorothy Davis (Wound Care)
- James Wilson (Diabetes)
- Helen Martinez (CVA/Stroke)

Search with names like "john", "smith", "wilson", etc.

## Roadmap / Next Steps

### Phase 2: FHIR Integration
- Connect to HCHB FHIR API
- Real patient data from EMR
- Episode and visit retrieval

### Phase 3: AI Summarization
- Azure OpenAI integration
- Intelligent summary generation
- Natural language queries

### Phase 4: Production Deployment
- Azure App Service hosting
- Cosmos DB for caching
- Teams app store submission

## Troubleshooting

### Bot not responding
- Check ngrok is running and URL is correct in Azure
- Verify .env credentials match Azure App Registration
- Check console for error messages

### 401 Unauthorized
- Verify App ID, Password, and Tenant ID are correct
- Ensure App Type is SingleTenant in both code and Azure

### Cards not rendering
- Check browser console for errors
- Verify Adaptive Card JSON is valid (use adaptivecards.io/designer)

## License

ISC
