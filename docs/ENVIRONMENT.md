# Environment Configuration

This document describes all environment variables used by the Bot-Recert application.

## Configuration Files

The application reads configuration from a `.env` file in the project root.

```
bot-recert/
├── .env              ← Main configuration file
├── index.js
└── mock-backend/
    └── main.py       ← Reads ../.env
```

---

## Environment Variables Reference

### Bot Framework Settings

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MicrosoftAppId` | Production | - | Azure AD Application ID for the bot |
| `MicrosoftAppPassword` | Production | - | Azure AD Application secret/password |
| `MicrosoftAppType` | Production | - | App type: "SingleTenant" or "MultiTenant" |
| `MicrosoftAppTenantId` | Production | - | Azure AD Tenant ID (for SingleTenant) |
| `LOCAL_DEBUG` | No | `false` | Set to "true" to skip bot authentication |
| `PORT` | No | `3978` | Port for the bot server |

---

### HCHB FHIR API Settings

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HCHB_API_BASE_URL` | Yes | - | FHIR API base URL (e.g., `https://api.hchb.com/fhir/r4`) |
| `HCHB_TOKEN_URL` | Yes | - | OAuth2 token endpoint URL |
| `HCHB_CLIENT_ID` | Yes | - | OAuth2 client ID |
| `HCHB_AGENCY_SECRET` | Yes | - | Agency secret for authentication |
| `HCHB_RESOURCE_SECURITY_ID` | Yes | - | Resource security ID |

---

### Azure OpenAI Settings

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AZURE_OPENAI_ENDPOINT` | Yes | - | Azure OpenAI resource endpoint |
| `AZURE_OPENAI_API_KEY` | Yes | - | Azure OpenAI API key |
| `AZURE_OPENAI_DEPLOYMENT` | Yes | `gpt-4o` | Deployment/model name |
| `AZURE_OPENAI_API_VERSION` | No | `2024-08-01-preview` | API version |

---

### Python Backend Settings

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PYTHON_BACKEND_URL` | No | `http://localhost:8000/api/v1` | Python backend API URL |
| `PYTHON_BACKEND_TIMEOUT` | No | `30000` | Request timeout in milliseconds |
| `USE_PYTHON_BACKEND` | No | `true` | Set to "false" to disable Python backend |

---

## Sample .env File

```env
# ===========================================
# Bot-Recert Environment Configuration
# ===========================================

# ---- Bot Framework ----
# Azure AD App Registration credentials
# Leave empty for local debug mode
MicrosoftAppId=your-app-id-here
MicrosoftAppPassword=your-app-password-here
MicrosoftAppType=SingleTenant
MicrosoftAppTenantId=your-tenant-id-here

# Set to "true" to skip bot authentication (local development)
LOCAL_DEBUG=false

# Bot server port (default: 3978)
PORT=3978

# ---- HCHB FHIR API ----
# Production FHIR API
HCHB_API_BASE_URL=https://api.hchb.com/fhir/r4
HCHB_TOKEN_URL=https://idp.hchb.com/connect/token
HCHB_CLIENT_ID=your-client-id
HCHB_AGENCY_SECRET=your-agency-secret
HCHB_RESOURCE_SECURITY_ID=your-resource-security-id

# ---- Azure OpenAI ----
# GPT-4o deployment for document summarization
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_DEPLOYMENT=gpt-4o
AZURE_OPENAI_API_VERSION=2024-08-01-preview

# ---- Python Backend ----
# URL for the Python PDF extraction service
PYTHON_BACKEND_URL=http://localhost:8000/api/v1
PYTHON_BACKEND_TIMEOUT=30000
USE_PYTHON_BACKEND=true
```

---

## Configuration by Environment

### Local Development

```env
# Minimal local development setup
LOCAL_DEBUG=true
PYTHON_BACKEND_URL=http://localhost:8000/api/v1

# HCHB credentials (optional if using mock data only)
HCHB_API_BASE_URL=https://api.hchb.com/fhir/r4
HCHB_TOKEN_URL=https://idp.hchb.com/connect/token
HCHB_CLIENT_ID=your-client-id
HCHB_AGENCY_SECRET=your-agency-secret
HCHB_RESOURCE_SECURITY_ID=your-resource-id

# Azure OpenAI (required for AI features)
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_DEPLOYMENT=gpt-4o
```

### Production (Azure)

```env
# Full production configuration
LOCAL_DEBUG=false

# Bot Framework - required for Teams
MicrosoftAppId=your-production-app-id
MicrosoftAppPassword=your-production-secret
MicrosoftAppType=SingleTenant
MicrosoftAppTenantId=your-tenant-id

# HCHB - production credentials
HCHB_API_BASE_URL=https://api.hchb.com/fhir/r4
HCHB_TOKEN_URL=https://idp.hchb.com/connect/token
HCHB_CLIENT_ID=production-client-id
HCHB_AGENCY_SECRET=production-agency-secret
HCHB_RESOURCE_SECURITY_ID=production-resource-id

# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://prod-resource.openai.azure.com
AZURE_OPENAI_API_KEY=production-api-key
AZURE_OPENAI_DEPLOYMENT=gpt-4o

# Python Backend - hosted service
PYTHON_BACKEND_URL=https://your-backend.azurewebsites.net/api/v1
PYTHON_BACKEND_TIMEOUT=60000
USE_PYTHON_BACKEND=true
```

### Mock Data Only (No External APIs)

```env
# For testing UI without external APIs
LOCAL_DEBUG=true
USE_PYTHON_BACKEND=true
PYTHON_BACKEND_URL=http://localhost:8000/api/v1

# No HCHB credentials needed - Python backend returns mock data
# No Azure OpenAI needed - AI features will show errors
```

---

## Environment Variable Usage in Code

### Node.js Services

```javascript
// fhirClient.js
const tokenUrl = process.env.HCHB_TOKEN_URL;
const clientId = process.env.HCHB_CLIENT_ID;
const baseUrl = process.env.HCHB_API_BASE_URL;

// azureOpenAIService.js
const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_API_KEY;
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';

// pythonBackendClient.js
const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8000/api/v1';
const USE_PYTHON_BACKEND = process.env.USE_PYTHON_BACKEND !== 'false';

// index.js
const LOCAL_DEBUG = process.env.LOCAL_DEBUG === 'true';
const port = process.env.PORT || 3978;
```

### Python Backend

```python
# main.py
from dotenv import load_dotenv
import os

# Load from parent directory
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT")
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY")
AZURE_OPENAI_DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT")
```

---

## Validation

### Required Environment Checks

The `fhirClient.js` validates required HCHB credentials:

```javascript
if (!tokenUrl || !clientId || !agencySecret || !resourceSecurityId) {
    throw new Error('Missing HCHB credentials in environment variables. Required: HCHB_TOKEN_URL, HCHB_CLIENT_ID, HCHB_AGENCY_SECRET, HCHB_RESOURCE_SECURITY_ID');
}
```

The `azureOpenAIService.js` validates Azure OpenAI configuration:

```javascript
if (!endpoint || !apiKey) {
    throw new Error('Azure OpenAI credentials not configured. Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY in .env');
}
```

### Configuration Status Check

```javascript
// azureOpenAIService.js
async function checkConfiguration() {
    const status = {
        configured: !!(endpoint && apiKey && deployment),
        endpoint: endpoint ? endpoint.replace(/\/+$/, '') : null,
        deployment: deployment || null,
        hasApiKey: !!apiKey,
        accessible: false,
        error: null
    };

    // Test connection...
    return status;
}
```

---

## Security Considerations

1. **Never commit `.env`** - Add to `.gitignore`
2. **Use Azure Key Vault** - For production secrets
3. **Rotate secrets regularly** - Especially agency secrets
4. **Limit permissions** - Use least-privilege for API keys
5. **Audit access** - Log API usage for security monitoring

### .gitignore Entry

```gitignore
# Environment files
.env
.env.local
.env.*.local
*.env
```
