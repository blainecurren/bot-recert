# CLAUDE.md — recert-bot-v2

This file defines the architecture, conventions, and rules for this project.
Read this entire file before taking any action in this codebase.

---

## Project Overview

A HIPAA-compliant clinical AI assistant for home health agencies. Nurses use this
to chat with AI about their patients, view patient data, and generate episode of
care summaries — all pulled live from HCHB (Homecare Homebase) via FHIR R4 API.

**This is a healthcare application handling PHI. HIPAA compliance is non-negotiable
in every decision.**

---

## Architecture

### Stack

| Layer | Technology |
|---|---|
| Backend API | Node.js + JavaScript + Express, Azure Container Apps |
| Background Jobs | Node.js + JavaScript, Azure Container Apps (separate container) |
| Frontend | React + Vite + TypeScript + Tailwind CSS (PWA) |
| Cache / Session | Azure Cache for Redis (non-persistent, TTL-based) |
| Patient Data | Hot-loaded from HCHB FHIR R4 API, cached in Redis |
| Chat History | Redis (TTL) + Azure Blob Storage (JSON backup) |
| AI Chat | Azure OpenAI GPT-4o via RAG |
| Search / RAG | Azure AI Search (Basic tier) |
| Auth | Azure Entra ID (MSAL) — enforced on every route |
| Secrets | Azure Key Vault — no hardcoded credentials ever |
| Audit Logging | Azure Log Analytics |
| Static Hosting | Azure Static Web Apps |

### Monorepo Structure
```
/
├── api/                        ← Express API container
│   ├── src/
│   │   ├── routes/             ← Route handlers only, no business logic
│   │   ├── services/           ← Business logic, external clients
│   │   │   ├── fhirClient.js   ← HCHB FHIR OAuth2 + HTTP client (core — handle with care)
│   │   │   ├── fhirService.js  ← High-level FHIR queries (48 methods, all resource types)
│   │   │   ├── resourceMap.js  ← Resource ID → method dispatcher + categories
│   │   │   ├── pythonBackendClient.js ← Optional Python FHIR backend (OFF by default)
│   │   │   ├── redisClient.js  ← Redis cache operations
│   │   │   ├── openaiClient.js ← Azure OpenAI + RAG orchestration
│   │   │   ├── searchClient.js ← Azure AI Search
│   │   │   └── auditLogger.js  ← HIPAA audit trail
│   │   ├── middleware/         ← Auth, audit, error handling
│   │   ├── config/             ← Environment validation
│   │   └── index.js            ← Server entry point
│   ├── Dockerfile
│   └── package.json
├── worker/                     ← Background jobs container
│   ├── src/
│   │   ├── jobs/
│   │   │   ├── fhirIngestion.js
│   │   │   └── episodeSummary.js
│   │   └── index.js
│   ├── Dockerfile
│   └── package.json
├── web/                        ← React PWA
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   │   ├── Patients.tsx
│   │   │   ├── PatientDetail.tsx
│   │   │   ├── EpisodeSummary.tsx
│   │   │   └── Chat.tsx
│   │   ├── hooks/
│   │   ├── api/                ← API client layer (typed fetch wrappers)
│   │   └── main.tsx
│   ├── vite.config.ts
│   └── package.json
├── shared/                     ← Types shared between api and web (web uses TS)
│   └── types/
├── docker-compose.yml          ← Full local dev stack
├── docker-compose.dev.yml      ← Dev overrides (hot reload, etc.)
└── .env.example                ← All env vars documented
```

---

## API Routes

| Method | Route | Description |
|---|---|---|
| GET | /api/health | Health check (no auth) |
| GET | /api/auth/me | User profile + linked worker |
| GET | /api/patients | Nurse's active caseload (resolves workerId from auth) |
| GET | /api/patients/:id | Single patient detail (demographics + episodes + conditions) |
| GET | /api/patients/:id/episodes | Patient episode list |
| GET | /api/patients/:id/resources | Available resource types metadata (categories) |
| GET | /api/patients/:id/resources/:resourceType | Generic resource fetcher (46+ resource types) |
| POST | /api/chat | Send chat message, returns streamed response |
| GET | /api/chat/:sessionId | Chat history for session |
| DELETE | /api/chat/:sessionId | Clear chat session |
| GET | /api/admin/worker-mappings | List all worker mappings |
| POST | /api/admin/worker-mappings | Create/update worker mapping |
| DELETE | /api/admin/worker-mappings/:email | Delete worker mapping |

---

## Data Flow

### Patient Data (Hot Load + Cache)
```
Request → Check Redis (TTL 15-30min) → Miss → HCHB FHIR API → Transform → Cache in Redis → Return
```
- Patient demographics: 60 min TTL
- Vitals/Observations: 15 min TTL
- Medications: 30 min TTL
- Episode data: 30 min TTL
- No patient data is ever written to a persistent database

### Chat Flow
```
POST /chat → Auth middleware → Load patient context from Redis →
AI Search (retrieve relevant chunks) → Azure OpenAI (stream response) →
Append to Redis chat session → Audit log entry → Stream to client
```
- Chat sessions: 8 hour TTL in Redis (end of shift)
- Sessions backed up to Blob Storage as JSON on expiry
- Every chat interaction produces an audit log entry

### Episode Summary
```
GET /episode/:id/summary → Check Redis for cached summary →
Miss → Worker job triggered → FHIR data aggregated →
Section-by-section OpenAI summarization → Stored in Redis + Blob → Return
```

---

## FHIR Integration — CRITICAL

`api/src/services/fhirClient.js` is the low-level OAuth2 + HTTP layer.
`api/src/services/fhirService.js` has all 48 high-level query methods.
`api/src/services/resourceMap.js` dispatches resource IDs to fhirService methods.

**Rules for fhirClient.js and fhirService.js:**
- Do not rewrite working FHIR query logic without explicit instruction
- Do not change auth patterns (OAuth2 client credentials flow) without explicit instruction
- All FHIR resource types we use: Patient, Condition, Observation, MedicationRequest,
  CarePlan, Encounter, EpisodeOfCare, Practitioner, CareTeam, DocumentReference, ServiceRequest,
  AllergyIntolerance, RelatedPerson, Goal, Coverage, Account, Location, Organization, CareTeam
- Always use `_lastUpdated` param for delta pulls in the worker
- Handle FHIR pagination (Bundle.link.next) on all list queries
- Never expose raw FHIR bundles to the frontend — always transform to clean JS objects
- Python backend is an optional fallback (OFF by default, opt-in via USE_PYTHON_BACKEND=true)

---

## HIPAA Rules — NON-NEGOTIABLE

Mark any HIPAA-sensitive code decision with: `// HIPAA: <reason>`

**Auth:**
- Every route except /health requires valid Entra ID JWT
- Validate token on every request — no session-based bypass
- Nurses can only access patients in their assigned caseload — enforce this at the
  service layer, not just the route layer

**Data handling:**
- No PHI ever written to application logs — audit logs go to Log Analytics only
- No PHI in error messages returned to client
- Redis TTLs must be set on every key containing PHI — no indefinite caching
- No PHI in URL query parameters — always use POST body or path params
- Service worker in PWA must NOT cache any API responses

**Audit logging — every entry must include:**
- Timestamp (UTC)
- Nurse user ID (from Entra ID token)
- Action (READ_PATIENT, CHAT_MESSAGE, VIEW_EPISODE_SUMMARY, etc.)
- Patient ID accessed
- IP address
- Session ID

**Secrets:**
- All secrets via environment variables in dev, Azure Key Vault in production
- Never commit .env files
- Never log environment variable values

---

## Language Rules

**API + Worker (JavaScript):**
- No TypeScript in api/ or worker/ — plain JavaScript with JSDoc comments where helpful
- All FHIR data transforms return plain objects with consistent shapes
- Use Zod for runtime validation of incoming request bodies when needed

**Web (TypeScript):**
- Strict mode always — `"strict": true` in web/tsconfig.json
- No implicit `any` — ever
- API response shapes defined as TypeScript interfaces in `/shared/types`

---

## Docker + Local Dev

`docker-compose.yml` runs the full local stack:
- `api` container with hot reload
- `worker` container with hot reload
- `redis` (local Redis, no auth in dev)
- `azurite` (Azure Storage emulator for Blob)

**Environment variables for local dev live in `.env` (gitignored).**
Copy `.env.example` and fill in values. Never commit `.env`.

In local dev, FHIR calls hit the real HCHB API (no emulator for FHIR).
Use a dev/test tenant if available.

---

## Code Conventions

- **No business logic in route handlers** — routes call services, services do the work
- **No direct Redis calls outside redisClient.js** — all cache operations go through the service
- **No direct FHIR calls outside fhirClient.js** — all FHIR operations go through fhirService.js
- **Resource dispatching** — use resourceMap.js to fetch any resource type by ID
- **Error handling** — all async route handlers wrapped in try/catch, errors go through
  centralized error middleware
- **Streaming** — OpenAI responses must stream to the client, do not buffer full response
- **Comments** — comment the why, not the what

---

## What Not To Do

- Do not install the Bot Framework SDK or any Teams-related packages — this is not a Teams bot
- Do not use localStorage or sessionStorage in the PWA — PHI cannot be stored in browser storage
- Do not add a persistent database without explicit instruction — Redis is the only data store
- Do not cache API responses in the PWA service worker
- Do not expose Azure connection strings or keys in frontend code
- Do not skip auth middleware on any route except /health
- Do not return raw FHIR bundles to the frontend
- Do not proceed with large refactors without presenting a plan first

---

## When You Are Unsure

Stop and ask. Do not make assumptions about:
- FHIR query logic or data mapping
- HIPAA compliance decisions
- Caching strategy changes
- Auth flow modifications
- Any change to fhirClient.js or fhirService.js

---

## Current Status

[x] Phase 1: Codebase audit complete
[x] Phase 2: Migration plan approved
[x] Phase 3: Monorepo scaffolded
[x] Phase 4: FHIR service migrated (48 methods, resourceMap, patient routes)
[ ] Phase 5: API container working locally
[ ] Phase 6: Worker container working locally
[ ] Phase 7: PWA shell working locally
[ ] Phase 8: Full docker-compose stack running
[ ] Phase 9: Deployed to Azure Container Apps

Update this checklist as phases are completed.
