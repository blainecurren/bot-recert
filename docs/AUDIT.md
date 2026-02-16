# Application Audit: bot-recert

**Date:** 2026-02-16
**Auditor:** Claude (AI-assisted)
**Scope:** Full codebase review - security, reliability, architecture, dependencies, performance, operations

---

## Overview

A Microsoft Teams bot built with Bot Framework SDK that helps home health nurses prepare for patient recertification visits. Integrates with HCHB's FHIR R4 API for clinical data and Azure OpenAI for AI-powered document summarization. A companion Python FastAPI service handles PDF text extraction with Vision OCR fallback.

### Tech Stack

| Component | Technology |
|-----------|-----------|
| Bot runtime | Node.js / Express / Bot Framework SDK v4 |
| FHIR integration | HCHB FHIR R4 API via axios |
| AI summarization | Azure OpenAI (GPT-4o) via `openai` SDK |
| PDF extraction | Python FastAPI + pdfplumber + PyMuPDF |
| UI | Adaptive Cards v1.5 in Microsoft Teams |

### File Inventory

```
index.js                          Main bot server and handler (905 lines)
cards/cardBuilder.js              Adaptive Card construction (2104 lines)
services/fhirService.js           FHIR resource methods (1431 lines)
services/fhirClient.js            OAuth2 + HTTP client (241 lines)
services/patientService.js        Patient data operations (430 lines)
services/dataFetchService.js      Resource orchestration (721 lines)
services/documentService.js       Document fetch + summarize (439 lines)
services/summaryService.js        Episode summary generation (182 lines)
services/azureOpenAIService.js    Azure OpenAI wrapper (344 lines)
services/pythonBackendClient.js   Python backend HTTP client (209 lines)
pdf-service/main.py               PDF extraction FastAPI service (247 lines)
```

**12 ad-hoc test/utility scripts** in project root (not a formal test suite).

---

## 1. Security

### 1.1 Critical

#### S1 - Worker data files committed to repository
**Files:** `workers-export.csv`, `workers-export.json`, `workers-only.csv`, `workers-only.json`

These files contain worker names, resource IDs, and NPI numbers. They are not in `.gitignore` and are tracked by git. This is a data exposure risk.

**Remediation:** Add to `.gitignore`, remove from git history with `git rm --cached`, consider `git filter-branch` or BFG Repo Cleaner if the repo is shared.

---

#### S2 - FHIR bearer token passed in HTTP request body
**File:** `services/documentService.js:144-146`

```js
const response = await pythonBackend.post('/documents/extract-text', {
    url: attachmentUrl,
    token: token   // <-- bearer token in POST body
});
```

The FHIR access token is sent as a plain JSON field to the Python service. If the Python service logs request bodies, or if the connection isn't over TLS on localhost, the token is exposed.

**Remediation:** Pass the token via an `Authorization` header instead. Have the Python service read it from the header.

---

#### S3 - CORS wildcard on PDF service
**File:** `pdf-service/main.py:39-45`

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # <-- unrestricted
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Any origin can call the PDF extraction endpoint. Since this service accepts bearer tokens and fetches documents, it should be locked to the bot's origin.

**Remediation:** Set `allow_origins` to the bot's domain or `["http://localhost:3978"]` for local dev.

---

### 1.2 High

#### S4 - No input validation on worker ID
**File:** `index.js:113, 172`

User-provided `workerId` is passed directly to FHIR API queries. While the FHIR API likely handles this safely, defense-in-depth requires validating the format.

**Remediation:** Validate that `workerId` matches an expected pattern (e.g., alphanumeric, max 50 chars) before using it.

---

#### S5 - Internal error messages exposed to users
**Files:** `index.js:291`, `index.js:808`

```js
`There was an error loading patients for this date: ${error.message || 'Unknown error'}`
```

Error messages from FHIR API failures, network errors, or internal exceptions are shown directly to end users. These can reveal API URLs, authentication details, or infrastructure info.

**Remediation:** Log the full error server-side; show a generic message to users.

---

#### S6 - PHI in console logs (HIPAA concern)
**Files:** Multiple locations throughout all services

Patient names, IDs, clinical data, and full request/response bodies are logged via `console.log`. Examples:

- `index.js:869-870` - Logs every incoming request body
- `index.js:109` - Logs full card action data including patient info
- `patientService.js:315` - Logs patient name data as JSON
- `fhirClient.js:88` - Logs every FHIR API URL with query parameters

For HIPAA compliance, PHI must not appear in plain-text logs, or logging infrastructure must meet HIPAA safeguards.

**Remediation:** Implement structured logging with redaction. Strip or mask PHI from log output. Remove `console.log` of full request bodies in production.

---

#### S7 - No rate limiting on Express endpoints
**File:** `index.js:868`

The `/api/messages` endpoint has no rate limiting. While Bot Framework provides some protection, the raw Express endpoint could be targeted.

**Remediation:** Add `express-rate-limit` middleware or rely on Azure App Service rate limiting in production.

---

### 1.3 Medium

#### S8 - Incomplete `.gitignore`
**File:** `.gitignore`

Current contents are only `node_modules` and `.env`. Missing entries for:

```
.env.local
.env.*.local
*.pem
*.key
*.csv
*.json (data exports)
dist/
pdf-service/__pycache__/
test-extract/
```

---

#### S9 - No HTTPS enforcement
**File:** `index.js:885`

The server binds to `0.0.0.0:3978` on plain HTTP. In Azure App Service this is handled by the platform, but there's no code-level verification or redirect.

---

## 2. Reliability & Bugs

### 2.1 Critical

#### R1 - Memory leak: `workerContext` Map grows without bound
**File:** `index.js:60`

```js
this.workerContext = new Map();
```

Conversation state is stored in a `Map` keyed by `conversationId`. Entries are added on worker validation (`index.js:203`) but **never deleted**. Each entry contains patient arrays, document summaries, and selected resources.

In production with continuous usage, this will consume increasing memory until the process crashes with an OOM error.

**Remediation:** Implement one of:
- TTL-based eviction (delete entries after 2 hours of inactivity)
- Bounded LRU cache (e.g., `lru-cache` package, max 500 entries)
- Bot Framework `ConversationState` with external storage (Blob/CosmosDB)

---

#### R2 - All state lost on server restart
**File:** `index.js:860`

All conversation state lives in the in-memory `Map`. Any restart (deployment, crash, auto-scaling) destroys all active sessions. Users receive "Session expired. Please start over."

**Remediation:** Use Bot Framework's `ConversationState` with Azure Blob Storage or Cosmos DB for persistence.

---

### 2.2 High

#### R3 - `handleBackToPatients` uses legacy card builder
**File:** `index.js:481`

```js
const listCard = cardBuilder.buildRecertPatientListCard(workerCtx.worker, workerCtx.patients);
```

The modern flow uses `buildPatientSelectionCard` (with date and visit type), but the back-navigation uses the legacy `buildRecertPatientListCard` (recert-focused with toggles). This presents users with a different, unexpected UI.

**Remediation:** Update to use `buildPatientSelectionCard` with the stored `selectedDate`.

---

#### R4 - Duplicate worker validation logic in two services
**Files:** `patientService.js:19-100`, `fhirService.js:143-186`

Both implement Python-backend-then-FHIR-fallback for worker lookup, but with different strategies:
- `patientService` tries 4 FHIR fallbacks (identifier, _id, direct fetch, name search)
- `fhirService` tries 2 (identifier search, then gives up)

Only `patientService` is called by the bot. The `fhirService` version is dead code.

**Remediation:** Remove `getWorkerById` from `fhirService` or have `patientService` delegate to it.

---

#### R5 - `USE_PYTHON_BACKEND` defined independently in two files
**Files:** `fhirService.js:14`, `patientService.js:12`

Both read `process.env.USE_PYTHON_BACKEND` separately. If the behavior needs to change, it must be updated in both places.

**Remediation:** Define once in a shared config module.

---

### 2.3 Medium

#### R6 - Unnecessary keep-alive interval
**File:** `index.js:898`

```js
setInterval(() => {}, 1000);
```

This empty interval does nothing. `app.listen()` already keeps the process alive.

**Remediation:** Remove the line.

---

#### R7 - Legacy code paths still active
**File:** `index.js:149-165`

Actions `loadPatients`, `generateSummaries`, and `searchPatient` are commented as "Legacy support" but remain in the switch statement. If never triggered, they add dead code. If sometimes triggered, they use outdated card builders and service methods.

**Remediation:** Either remove or clearly document when these are triggered.

---

## 3. Architecture & Design

### A1 - No automated test suite
**File:** `package.json:7`

```json
"test": "echo \"Error: no test specified\" && exit 1"
```

Zero automated tests exist. The 12 `test-*.js` scripts in the root are ad-hoc CLI scripts that call live APIs, not repeatable unit/integration tests. For a healthcare application handling PHI and making clinical decisions with AI, this is a significant quality risk.

**Remediation:** Add at minimum:
- Unit tests for `cardBuilder.js` (pure functions, easy to test)
- Unit tests for `dataFetchService.js` formatting functions
- Integration tests for the FHIR client with mocked responses
- Use Jest or Vitest with proper test scripts

---

### A2 - God files
**Files:** `fhirService.js` (1431 lines), `cardBuilder.js` (2104 lines)

`fhirService.js` contains ~50 functions covering every FHIR resource type. `cardBuilder.js` builds 12+ different Adaptive Card layouts in one file.

**Remediation:** Consider splitting:
- `fhirService.js` into domain-specific modules (vitals, documents, appointments, etc.)
- `cardBuilder.js` into per-card modules or at least grouped by flow (welcome, patient list, data results, etc.)

---

### A3 - Service layer boundaries are unclear

The dependency graph has circular-looking patterns:

```
index.js -> patientService -> fhirService -> fhirClient
                           -> pythonBackendClient
         -> documentService -> fhirClient (bypasses fhirService)
                            -> pythonBackendClient (bypasses fhirService)
                            -> azureOpenAIService
         -> dataFetchService -> fhirService
         -> summaryService -> patientService
```

`documentService` bypasses the `fhirService` layer entirely, importing `fhirClient` directly. `dataFetchService` imports `RESOURCE_CATEGORIES` from `cardBuilder`, creating a dependency from service layer to presentation layer.

**Remediation:** Establish clear layers: `fhirClient` -> `fhirService` -> domain services -> bot handlers. Move `RESOURCE_CATEGORIES` to a shared constants file.

---

### A4 - No environment validation at startup

The app starts successfully with missing env vars and only fails on first use. Required variables include:

- `MicrosoftAppId`, `MicrosoftAppPassword`, `MicrosoftAppType`, `MicrosoftAppTenantId`
- `HCHB_TOKEN_URL`, `HCHB_CLIENT_ID`, `HCHB_AGENCY_SECRET`, `HCHB_RESOURCE_SECURITY_ID`, `HCHB_API_BASE_URL`
- `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`
- `PYTHON_BACKEND_URL`

**Remediation:** Validate required env vars at startup and fail fast with a clear message.

---

### A5 - Outdated README
**File:** `README.md`

The README still references:
- Mock patient data (no longer exists)
- Phase 2/3/4 roadmap items that have been completed (FHIR integration, AI summarization)
- An outdated project structure (missing `services/`, `pdf-service/`, half the service files)
- No mention of the Python PDF service, Azure OpenAI, or HCHB FHIR integration

---

### A6 - Ad-hoc scripts in project root

12 test/utility scripts (`test-*.js`, `find-person.js`, `get-patient-docs.js`, `pull-workers.js`) clutter the root directory. These are developer tools, not part of the application.

**Remediation:** Move to a `scripts/` or `tools/` directory.

---

## 4. Dependencies

### D1 - npm vulnerabilities (2 found)

```
axios  <=1.13.4    HIGH   DoS via __proto__ key in mergeConfig
qs     6.7-6.14.1  LOW    arrayLimit bypass in comma parsing
```

**Remediation:** Run `npm audit fix`.

---

### D2 - Python dependencies outdated
**File:** `pdf-service/requirements.txt`

| Package | Current | Latest |
|---------|---------|--------|
| fastapi | 0.109.0 | 0.115+ |
| openai | 1.12.0 | 1.60+ |
| pdfplumber | 0.10.3 | 0.11+ |
| httpx | 0.26.0 | 0.28+ |

**Remediation:** Update pinned versions. Add a `requirements.lock` for reproducible builds.

---

### D3 - No dependency on a proper logging library

All logging is `console.log`/`console.error`. Production Node.js applications typically use `winston`, `pino`, or similar for structured logging with levels, rotation, and transports.

---

## 5. Performance

### P1 - Document preloading blocks user experience
**File:** `index.js:302-347`

`preloadDocumentSummaries` processes all patients' documents after the patient list is shown. For each patient, it:
1. Fetches recent documents from FHIR
2. Filters for PDFs
3. Downloads each PDF via the Python service
4. Sends each to Azure OpenAI for summarization

With 10 patients and 5 docs each, this is 50 FHIR calls + 50 PDF downloads + 50 AI calls. The concurrency limit is 3 patients at a time, but each patient processes documents sequentially.

**Remediation:** Consider on-demand summarization (only when patient is selected) or a background job system with proactive messaging.

---

### P2 - No FHIR data caching

Patient demographics, conditions, and medications are re-fetched on every request. A short-lived cache (5-minute TTL) for frequently accessed patient data would reduce FHIR API load and improve response times.

---

### P3 - Vision OCR processes PDF pages sequentially
**File:** `pdf-service/main.py:89-137`

Each page is rendered to an image and sent to GPT-4o Vision one at a time. Pages could be processed concurrently with `asyncio.gather()`.

---

## 6. Operations

### O1 - No structured logging

Logging uses `console.log` with inconsistent prefixes: `[FHIR]`, `[Bot]`, `[DocumentService]`, `[PythonBackend]`, `[AzureOpenAI]`, `[CardBuilder]`, `[PatientService]`, `[DataFetchService]`, `[Extract]`, `[Vision OCR]`.

No log levels (debug/info/warn/error), no structured JSON output, no request correlation IDs, no log rotation.

---

### O2 - Health check does not verify dependencies
**File:** `index.js:863-865`

```js
app.get('/', (req, res) => {
    res.send('Bot is running!');
});
```

Returns a static string regardless of whether FHIR API, Python service, or Azure OpenAI are reachable. This makes it difficult for monitoring systems to detect downstream failures.

**Remediation:** Add a `/health` endpoint that checks:
- FHIR token acquisition
- Python service health (`/api/v1/health`)
- Azure OpenAI configuration

---

### O3 - No graceful shutdown
**File:** `index.js:901-905`

The `SIGINT` handler calls `server.close()` but doesn't:
- Wait for in-flight bot requests to complete
- Drain the HTTP connection pool
- Close the axios clients

---

### O4 - No deployment configuration

No `Dockerfile`, `docker-compose.yml`, Azure Pipelines YAML, GitHub Actions, or deployment scripts. The Python service has no deployment config either. Deployment process is entirely undocumented.

---

## 7. Priority Matrix

### P0 - Fix Immediately

| ID | Issue | Risk |
|----|-------|------|
| R1 | Memory leak in `workerContext` Map | Process crash in production |
| D1 | npm vulnerabilities (axios HIGH severity) | Exploitable DoS |
| S1 | Worker data files (PII/NPI) committed to git | Data exposure |

### P1 - Fix Before Production

| ID | Issue | Risk |
|----|-------|------|
| S2 | Bearer token in HTTP body | Credential exposure |
| S6 | PHI in console logs | HIPAA violation |
| R2 | In-memory state with no persistence | Session loss on restart |
| A1 | No automated test suite | Quality/regression risk |
| S5 | Internal errors shown to users | Information disclosure |

### P2 - Fix Soon

| ID | Issue | Risk |
|----|-------|------|
| S3 | CORS wildcard on PDF service | Unauthorized access |
| S4 | No input validation on worker ID | Defense-in-depth gap |
| R3 | Back navigation uses wrong card builder | UX inconsistency |
| R4 | Duplicate worker validation logic | Maintenance confusion |
| A4 | No env validation at startup | Debugging difficulty |
| A5 | Outdated README | Onboarding friction |
| O2 | Health check doesn't verify dependencies | Monitoring gap |

### P3 - Improve When Possible

| ID | Issue | Risk |
|----|-------|------|
| A2 | God files (fhirService, cardBuilder) | Maintainability |
| A3 | Unclear service layer boundaries | Architectural debt |
| A6 | Ad-hoc scripts in project root | Code organization |
| R5 | Duplicate config constants | Minor maintenance |
| R6 | Unnecessary keep-alive interval | Code hygiene |
| R7 | Legacy code paths still active | Dead code |
| O1 | No structured logging | Observability |
| O3 | No graceful shutdown | Reliability |
| O4 | No deployment configuration | Operations |
| P1 | Document preloading blocks UX | Performance |
| P2 | No FHIR data caching | Performance |
| P3 | Sequential Vision OCR | Performance |
| D2 | Outdated Python dependencies | Security/bugs |
| D3 | No logging library | Observability |
| S8 | Incomplete .gitignore | Security hygiene |

---

## 8. Implementation Log

The following fixes were implemented on 2026-02-16 as part of this audit. Each entry notes *what* changed and *why* the specific approach was chosen.

### P0 - Fixed Immediately

#### R1 - Memory leak in `workerContext` Map — FIXED
**Files changed:** `index.js`

Added TTL-based eviction with a max-size cap. Each context entry now stores a `lastAccessed` timestamp. A periodic sweep (every 10 minutes) removes entries older than 2 hours, and the map is hard-capped at 500 entries.

**Why this approach:** A TTL + max-size eviction strategy is the simplest fix that solves the problem without adding new dependencies (like `lru-cache`) or requiring external storage (Cosmos DB, Blob). It keeps the deployment footprint unchanged while guaranteeing bounded memory growth. The 2-hour TTL matches reasonable session duration for clinical users doing recert visits.

New methods: `_getContext()`, `_setContext()`, `_evictExpiredContexts()`. The eviction interval is cleared on `SIGINT` for clean shutdown.

---

#### D1 - npm vulnerabilities — FIXED
**Files changed:** `package-lock.json`

Ran `npm audit fix` to resolve both vulnerabilities:
- **axios** (HIGH): DoS via `__proto__` key in `mergeConfig`
- **qs** (LOW): `arrayLimit` bypass in comma parsing

**Why this approach:** `npm audit fix` resolved both without breaking changes. No major version bumps were needed.

---

#### S1 - Worker data files committed to repository — FIXED
**Files changed:** `.gitignore`, removed from git tracking

Removed from git with `git rm --cached`:
- `workers-export.csv`, `workers-export.json`
- `workers-only.csv`, `workers-only.json`
- `test.json`, `teams-app.zip`
- `pdf-service/__pycache__/main.cpython-312.pyc`

Added all patterns to `.gitignore` to prevent re-commit.

**Why this approach:** `git rm --cached` removes files from tracking without deleting them locally. The expanded `.gitignore` prevents future accidents. Note: files remain in git history — if this repo is shared externally, consider running BFG Repo Cleaner to purge history.

---

### P1 - Fixed Before Production

#### S2 - Bearer token in HTTP body — FIXED
**Files changed:** `services/documentService.js`, `pdf-service/main.py`

The Node.js `documentService` now passes the FHIR token via the `Authorization: Bearer` header instead of the request body. The Python service reads from the `Authorization` header first, falling back to the body `token` field for backwards compatibility.

**Why this approach:** Authorization headers are the standard mechanism for bearer tokens — they're excluded from default request body logging, handled correctly by proxies, and follow RFC 6750. The backwards-compatible fallback in the Python service avoids breaking any other callers during the transition.

---

#### S6 - PHI in console logs — FIXED
**Files changed:** `index.js`, `cards/cardBuilder.js`

Removed or sanitized log statements that exposed PHI:
- Removed full request body logging (`index.js` request handler)
- Removed card action JSON dumps that included patient data
- Removed patient name/ID logging from several handler methods
- Removed credential logging at startup (App ID, Tenant ID)
- Removed debug `console.log` in `cardBuilder.js` that dumped card body JSON

**Why this approach:** Surgical removal of specific log lines is the lowest-risk change. A full structured logging migration (winston/pino with redaction) would be a larger undertaking better suited for a dedicated task. The immediate priority was stopping PHI from reaching plain-text logs.

---

#### S5 - Internal errors shown to users — FIXED
**Files changed:** `index.js`

Replaced `error.message` in user-facing Adaptive Cards with generic messages like "An unexpected error occurred" and "Unable to load data". Full error details are still logged server-side for debugging.

**Why this approach:** Users don't benefit from seeing stack traces or FHIR API error details. Generic messages prevent information disclosure while server-side logging preserves debuggability.

---

### P2 - Fixed

#### S3 - CORS wildcard on PDF service — FIXED
**Files changed:** `pdf-service/main.py`

Replaced `allow_origins=["*"]` with a configurable `ALLOWED_ORIGINS` environment variable (defaults to `http://localhost:3978`). Also restricted `allow_methods` to `["GET", "POST"]` and `allow_headers` to `["Authorization", "Content-Type"]`.

**Why this approach:** Environment-variable-based configuration lets each deployment set the correct origin without code changes. The restrictive defaults follow the principle of least privilege — only the methods and headers actually used are allowed.

---

#### S4 - No input validation on worker ID — FIXED
**Files changed:** `index.js`

Added validation that worker IDs are alphanumeric (plus hyphens and underscores), trimmed, and capped at 50 characters. Invalid input returns a friendly error card.

**Why this approach:** Defense-in-depth — even though the FHIR API likely rejects invalid input, validating early prevents unexpected behavior and potential injection vectors. The regex `^[a-zA-Z0-9_-]+$` matches all known HCHB worker ID formats.

---

#### R3 - Back navigation uses wrong card builder — FIXED
**Files changed:** `index.js`

Updated `handleBackToPatients` to detect whether the user came through the modern flow (with `selectedDate`) and use `buildPatientSelectionCard` accordingly, falling back to `buildRecertPatientListCard` for legacy sessions.

**Why this approach:** Conditional branching preserves backwards compatibility for any sessions that started before the modern flow was added, while ensuring new sessions get a consistent UI.

---

#### R4 - Duplicate worker validation in fhirService — FIXED
**Files changed:** `services/fhirService.js`

Simplified `getWorkerById` in `fhirService.js` from ~40 lines (with Python backend duplication) to a simple FHIR-only lookup. The `patientService.getWorkerById` already handles the full validation flow with fallbacks, so the duplicate was unnecessary.

**Why this approach:** Removing dead code reduces confusion about which function to call. Since only `patientService.getWorkerById` is used by the bot, the `fhirService` version only needs to be a simple FHIR query for any direct callers.

---

#### A4 - No env validation at startup — FIXED
**Files changed:** `index.js`

Added a startup check that validates all required environment variables across three groups (bot, fhir, ai). Missing variables are logged with their group name and the process exits with code 1.

**Why this approach:** Fail-fast startup prevents the confusing scenario where the bot starts successfully but fails on first user interaction. Grouping by category makes the error message actionable — operators can see exactly which integration is misconfigured.

---

#### S8 - Incomplete `.gitignore` — FIXED
**Files changed:** `.gitignore`

Expanded from 2 entries to ~40 entries covering:
- Environment files (`.env*`)
- Keys and certificates (`*.pem`, `*.key`)
- Data exports (`*.csv`, export JSONs)
- Python artifacts (`__pycache__/`, `*.pyc`)
- IDE files (`.vscode/`, `.idea/`)
- OS files (`.DS_Store`, `Thumbs.db`)
- Build artifacts and archives

---

#### R6 - Unnecessary keep-alive interval — FIXED
**Files changed:** `index.js`

Removed the `setInterval(() => {}, 1000)` call. `app.listen()` already keeps the Node.js process alive.

---

### Not Addressed (Deferred)

The following items were identified but deferred as they require larger architectural changes, new dependencies, or are lower priority:

| ID | Issue | Reason Deferred |
|----|-------|----------------|
| R2 | In-memory state persistence | Requires Azure Blob/CosmosDB setup — infrastructure change |
| A1 | No automated test suite | Requires dedicated effort to set up Jest + mocks |
| A2 | God files | Refactoring 3500+ lines across two files needs careful planning |
| A3 | Service layer boundaries | Architectural restructuring — risk of regressions |
| A5 | Outdated README | Lower priority — this audit doc serves as current documentation |
| A6 | Ad-hoc scripts in root | Cosmetic — no functional impact |
| R5 | Duplicate config constants | Low risk — `USE_PYTHON_BACKEND` is stable |
| R7 | Legacy code paths | Need to confirm if any Teams card versions trigger these |
| S7 | No rate limiting | Azure App Service provides platform-level protection |
| S9 | No HTTPS enforcement | Handled by Azure platform in production |
| O1 | Structured logging | Requires choosing and integrating a logging library |
| O2 | Health check improvements | Would benefit from the logging migration first |
| O3 | Graceful shutdown | Current `SIGINT` handler is adequate for the deployment model |
| O4 | No deployment config | Deployment is managed outside the repo currently |
| P1 | Document preloading | Performance optimization — functional as-is |
| P2 | No FHIR caching | Requires cache invalidation strategy |
| P3 | Sequential Vision OCR | Performance optimization — functional as-is |
| D2 | Outdated Python deps | Needs testing — should be paired with Python test coverage |
| D3 | No logging library | Deferred alongside O1 |
