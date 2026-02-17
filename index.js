require('dotenv').config();

const { rootLogger, createLogger, createRequestLogger } = require('./services/logger');

const log = createLogger('Bot');

// Validate required environment variables
const REQUIRED_ENV = {
    bot: ['MicrosoftAppId', 'MicrosoftAppPassword', 'MicrosoftAppType', 'MicrosoftAppTenantId'],
    fhir: ['HCHB_TOKEN_URL', 'HCHB_CLIENT_ID', 'HCHB_AGENCY_SECRET', 'HCHB_RESOURCE_SECURITY_ID', 'HCHB_API_BASE_URL'],
    ai: ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_DEPLOYMENT']
};

if (process.env.LOCAL_DEBUG !== 'true') {
    const missing = {};
    for (const [group, vars] of Object.entries(REQUIRED_ENV)) {
        const groupMissing = vars.filter(v => !process.env[v]);
        if (groupMissing.length > 0) missing[group] = groupMissing;
    }
    if (Object.keys(missing).length > 0) {
        for (const [group, vars] of Object.entries(missing)) {
            log.warn({ group, vars }, 'Missing environment variables');
        }
    }
}

// Catch unhandled errors
process.on('uncaughtException', (err) => {
    rootLogger.fatal({ err }, 'Uncaught exception');
});
process.on('unhandledRejection', (reason, promise) => {
    rootLogger.fatal({ err: reason }, 'Unhandled rejection');
});

const { ActivityHandler, CloudAdapter, ConfigurationBotFrameworkAuthentication, CardFactory } = require('botbuilder');
const express = require('express');

// Import services and card builder
const patientService = require('./services/patientService');
const summaryService = require('./services/summaryService');
const dataFetchService = require('./services/dataFetchService');
const documentService = require('./services/documentService');
const azureOpenAI = require('./services/azureOpenAIService');
const cardBuilder = require('./cards/cardBuilder');

// Create server
const app = express();
app.use(express.json());

// Create adapter - skip auth for local testing if LOCAL_DEBUG is set
const LOCAL_DEBUG = process.env.LOCAL_DEBUG === 'true';

let adapter;

if (LOCAL_DEBUG) {
    log.info('LOCAL DEBUG MODE - Authentication disabled');
    // Use empty credentials for local testing
    const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({});
    adapter = new CloudAdapter(botFrameworkAuth);
} else {
    // Use full credentials for production/Azure
    const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({
        MicrosoftAppId: process.env.MicrosoftAppId,
        MicrosoftAppPassword: process.env.MicrosoftAppPassword,
        MicrosoftAppType: process.env.MicrosoftAppType,
        MicrosoftAppTenantId: process.env.MicrosoftAppTenantId
    });
    adapter = new CloudAdapter(botFrameworkAuth);
}

// Error handler
adapter.onTurnError = async (context, error) => {
    const rlog = createRequestLogger('Bot', context);
    rlog.error({ err: error }, 'onTurnError');
    await context.sendActivity('Oops. Something went wrong!');
};

// Bot logic
const CONTEXT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_CONTEXTS = 500;

class RecertBot extends ActivityHandler {
    constructor() {
        super();

        // Store worker context for back navigation (with TTL eviction)
        this.workerContext = new Map();

        // Periodically evict expired contexts (every 10 minutes)
        this._evictionInterval = setInterval(() => this._evictExpiredContexts(), 10 * 60 * 1000);

        // Handle incoming messages
        this.onMessage(async (context, next) => {
            try {
                // Check if this is an Adaptive Card submit action
                const value = context.activity.value;

                if (value && value.action) {
                    // Handle Adaptive Card actions
                    await this.handleCardAction(context, value);
                } else {
                    // Regular text message - show welcome card
                    await this.sendWelcomeCard(context);
                }
            } catch (error) {
                const rlog = createRequestLogger('Bot', context);
                rlog.error({ err: error }, 'Error handling message');
                await context.sendActivity('Sorry, something went wrong. Please try again.');
            }

            await next();
        });

        // Handle new members joining
        this.onMembersAdded(async (context, next) => {
            for (const member of context.activity.membersAdded) {
                if (member.id !== context.activity.recipient.id) {
                    await this.sendWelcomeCard(context);
                }
            }
            await next();
        });
    }

    /**
     * Get conversation context with TTL check
     */
    _getContext(conversationId) {
        const entry = this.workerContext.get(conversationId);
        if (!entry) return null;
        if (Date.now() - entry._lastAccess > CONTEXT_TTL_MS) {
            this.workerContext.delete(conversationId);
            return null;
        }
        entry._lastAccess = Date.now();
        return entry;
    }

    /**
     * Set conversation context with TTL tracking
     */
    _setContext(conversationId, data) {
        data._lastAccess = Date.now();
        this.workerContext.set(conversationId, data);
        // Enforce max size by removing oldest entry
        if (this.workerContext.size > MAX_CONTEXTS) {
            const oldestKey = this.workerContext.keys().next().value;
            this.workerContext.delete(oldestKey);
        }
    }

    /**
     * Evict expired contexts
     */
    _evictExpiredContexts() {
        const now = Date.now();
        let evicted = 0;
        for (const [key, entry] of this.workerContext) {
            if (now - entry._lastAccess > CONTEXT_TTL_MS) {
                this.workerContext.delete(key);
                evicted++;
            }
        }
        if (evicted > 0) {
            log.info({ evicted, active: this.workerContext.size }, 'Evicted expired conversation contexts');
        }
    }

    /**
     * Send the welcome/login card
     */
    async sendWelcomeCard(context) {
        const welcomeCard = cardBuilder.getWelcomeCard();
        const card = CardFactory.adaptiveCard(welcomeCard);
        await context.sendActivity({ attachments: [card] });
    }

    /**
     * Handle Adaptive Card submit actions
     */
    async handleCardAction(context, value) {
        const rlog = createRequestLogger('Bot', context);
        rlog.info({ action: value.action }, 'Card action received');

        switch (value.action) {
            case 'validateWorker':
                await this.handleValidateWorker(context, value.workerId);
                break;

            case 'loadPatientsByDate':
                await this.handleLoadPatientsByDate(context, value.workerId, value.selectedDate);
                break;

            case 'selectPatient':
                await this.handlePatientSelect(context, value.patientId, value.patientName, value.skipSummary === true);
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

            // Legacy support
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
                rlog.warn({ action: value.action }, 'Unknown action');
                await this.sendWelcomeCard(context);
        }
    }

    /**
     * Handle worker ID validation and show date selection
     */
    async handleValidateWorker(context, workerId) {
        if (!workerId || workerId.trim() === '') {
            const errorCard = cardBuilder.buildErrorCard(
                'Worker ID Required',
                'Please enter your Worker ID to continue.'
            );
            const card = CardFactory.adaptiveCard(errorCard);
            await context.sendActivity({ attachments: [card] });
            return;
        }

        // Sanitize: allow alphanumeric, hyphens, underscores, max 50 chars
        const sanitized = workerId.trim().substring(0, 50);
        if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
            const errorCard = cardBuilder.buildErrorCard(
                'Invalid Worker ID',
                'Worker ID must contain only letters, numbers, hyphens, or underscores.'
            );
            const card = CardFactory.adaptiveCard(errorCard);
            await context.sendActivity({ attachments: [card] });
            return;
        }
        workerId = sanitized;

        const rlog = createRequestLogger('Bot', context);
        rlog.info('Validating worker');

        // Send processing message
        await context.sendActivity('Validating your Worker ID...');

        try {
            // Validate worker
            const worker = await patientService.getWorkerById(workerId);

            if (!worker) {
                const errorCard = cardBuilder.buildErrorCard(
                    'Worker Not Found',
                    'No worker found with that ID. Please check your Worker ID and try again.'
                );
                const card = CardFactory.adaptiveCard(errorCard);
                await context.sendActivity({ attachments: [card] });
                return;
            }

            // Store worker in context
            const conversationId = context.activity.conversation.id;
            this._setContext(conversationId, {
                worker,
                selectedDate: null,
                patients: [],
                selectedPatient: null
            });

            // Auto-load today's patients instead of showing date selection
            const today = new Date().toISOString().split('T')[0];
            await context.sendActivity(`Welcome, ${worker.name}! Loading your patients for today...`);
            await this.handleLoadPatientsByDate(context, worker.id, today);

        } catch (error) {
            rlog.error({ err: error }, 'Error validating worker');
            const errorCard = cardBuilder.buildErrorCard(
                'Error',
                'There was an error validating your Worker ID. Please try again.'
            );
            const card = CardFactory.adaptiveCard(errorCard);
            await context.sendActivity({ attachments: [card] });
        }
    }

    /**
     * Handle loading patients for a specific date
     */
    async handleLoadPatientsByDate(context, workerId, selectedDate) {
        if (!selectedDate) {
            const errorCard = cardBuilder.buildErrorCard(
                'Date Required',
                'Please select a date to continue.'
            );
            const card = CardFactory.adaptiveCard(errorCard);
            await context.sendActivity({ attachments: [card] });
            return;
        }

        const rlog = createRequestLogger('Bot', context);
        rlog.info({ workerId, selectedDate }, 'Loading patients by date');

        // Send processing message immediately
        await context.sendActivity(`Loading your patients for ${selectedDate}...`);

        try {
            const conversationId = context.activity.conversation.id;
            let workerCtx = this._getContext(conversationId);

            // If no context, validate worker again
            if (!workerCtx || !workerCtx.worker) {
                rlog.debug('No worker context found, re-validating worker');
                const worker = await patientService.getWorkerById(workerId);
                if (!worker) {
                    await context.sendActivity('Session expired. Please start over.');
                    await this.sendWelcomeCard(context);
                    return;
                }
                workerCtx = { worker, selectedDate: null, patients: [], selectedPatient: null };
            }

            // Get patients scheduled for this worker on this date
            rlog.debug({ workerId, selectedDate }, 'Fetching patients');
            const patients = await patientService.getPatientsByWorkerAndDate(workerId, selectedDate);
            rlog.info({ patientCount: patients.length, selectedDate }, 'Patients loaded');

            // Re-fetch context after async call to avoid overwriting concurrent changes
            workerCtx = this._getContext(conversationId) || workerCtx;
            workerCtx.selectedDate = selectedDate;
            workerCtx.patients = patients;
            workerCtx.documentSummaries = {};
            this._setContext(conversationId, workerCtx);

            // Build and send the patient list card (single-select)
            const listCard = cardBuilder.buildPatientSelectionCard(workerCtx.worker, patients, selectedDate);
            const card = CardFactory.adaptiveCard(listCard);
            await context.sendActivity({ attachments: [card] });

            // If no patients found, add helpful message
            if (patients.length === 0) {
                await context.sendActivity('No patients found for this date. Try selecting a different date or check your schedule in HCHB.');
                return;
            }

            // Pre-load document summaries in the background (fire-and-forget)
            this.preloadDocumentSummaries(context, patients, conversationId).catch(err => {
                rlog.error({ err }, 'Background document preload failed');
            });

        } catch (error) {
            rlog.error({ err: error }, 'Error loading patients by date');
            const errorCard = cardBuilder.buildErrorCard(
                'Error Loading Patients',
                'There was an error loading patients for this date. Please try again.'
            );
            const card = CardFactory.adaptiveCard(errorCard);
            await context.sendActivity({ attachments: [card] });
        }
    }

    /**
     * Pre-load document summaries for all patients
     * Runs after patient list is displayed to provide AI summaries
     */
    async preloadDocumentSummaries(context, patients, conversationId) {
        if (!patients || patients.length === 0) {
            return;
        }

        try {
            // Notify user that AI analysis is starting
            await context.sendActivity(`Analyzing clinical documents for ${patients.length} patient(s)... This may take a moment.`);

            log.info({ patientCount: patients.length }, 'Starting document pre-load');
            const startTime = Date.now();

            // Batch fetch and summarize documents for all patients
            const summaries = await documentService.batchFetchAndSummarizeDocuments(patients, {
                maxDocsPerPatient: 5,
                includeConsolidated: true
            });

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            log.info({ elapsed, patientCount: patients.length }, 'Document pre-load complete');

            // Update the worker context with summaries (only if patient list hasn't changed)
            const workerCtx = this._getContext(conversationId);
            const patientIds = new Set(patients.map(p => p.id));
            const currentIds = new Set((workerCtx?.patients || []).map(p => p.id));
            const listChanged = patientIds.size !== currentIds.size || [...patientIds].some(id => !currentIds.has(id));
            if (workerCtx && !listChanged) {
                workerCtx.documentSummaries = summaries;
                this._setContext(conversationId, workerCtx);

                // Count successful summaries
                let totalDocs = 0;
                let successfulSummaries = 0;
                Object.values(summaries).forEach(patientSummary => {
                    if (patientSummary.success) {
                        totalDocs += patientSummary.processedCount || 0;
                        successfulSummaries += patientSummary.documents?.filter(d => d.summary).length || 0;
                    }
                });

                // Notify user that analysis is complete
                await context.sendActivity(`AI analysis complete. Processed ${totalDocs} document(s) with ${successfulSummaries} summary(ies) ready. Select a patient to view their clinical summary.`);
            } else if (listChanged) {
                log.debug('Patient list changed during preload, discarding stale summaries');
            }

        } catch (error) {
            log.error({ err: error }, 'Error pre-loading document summaries');
            // Don't fail the whole flow, just log the error
            await context.sendActivity('Note: Document analysis encountered some issues. You can still view patient data manually.');
        }
    }

    /**
     * Handle back to date selection navigation
     */
    async handleBackToDateSelection(context) {
        const conversationId = context.activity.conversation.id;
        const workerCtx = this._getContext(conversationId);

        if (workerCtx && workerCtx.worker) {
            const dateCard = cardBuilder.buildDateSelectionCard(workerCtx.worker);
            const card = CardFactory.adaptiveCard(dateCard);
            await context.sendActivity({ attachments: [card] });
        } else {
            await this.sendWelcomeCard(context);
        }
    }

    /**
     * Handle worker login and load their recert patients (legacy)
     */
    async handleLoadPatients(context, workerId) {
        if (!workerId || workerId.trim() === '') {
            const errorCard = cardBuilder.buildErrorCard(
                'Worker ID Required',
                'Please enter your Worker ID to continue.'
            );
            const card = CardFactory.adaptiveCard(errorCard);
            await context.sendActivity({ attachments: [card] });
            return;
        }

        const rlog = createRequestLogger('Bot', context);
        rlog.info('Loading patients (legacy)');

        try {
            // Validate worker
            const worker = await patientService.getWorkerById(workerId);

            if (!worker) {
                const errorCard = cardBuilder.buildErrorCard(
                    'Worker Not Found',
                    'No worker found with that ID. Please check your Worker ID and try again.'
                );
                const card = CardFactory.adaptiveCard(errorCard);
                await context.sendActivity({ attachments: [card] });
                return;
            }

            // Get recert patients for this worker
            const patients = await patientService.getRecertPatientsByWorker(workerId);
            rlog.info({ patientCount: patients.length }, 'Recert patients loaded');

            // Store worker context for back navigation
            const conversationId = context.activity.conversation.id;
            this._setContext(conversationId, { worker, patients });

            // Build and send the patient selection card
            const listCard = cardBuilder.buildRecertPatientListCard(worker, patients);
            const card = CardFactory.adaptiveCard(listCard);
            await context.sendActivity({ attachments: [card] });

        } catch (error) {
            rlog.error({ err: error }, 'Error loading patients');
            const errorCard = cardBuilder.buildErrorCard(
                'Error Loading Patients',
                'There was an error loading your patients. Please try again.'
            );
            const card = CardFactory.adaptiveCard(errorCard);
            await context.sendActivity({ attachments: [card] });
        }
    }

    /**
     * Handle generating summaries for selected patients
     */
    async handleGenerateSummaries(context, value) {
        // Extract selected patient IDs from toggle values
        const allPatientIds = value.patientIds || [];
        const selectAll = value.selectAll === 'true';

        let selectedPatientIds = [];

        if (selectAll) {
            selectedPatientIds = allPatientIds;
        } else {
            // Check each patient toggle
            for (const patientId of allPatientIds) {
                if (value[`patient_${patientId}`] === 'true') {
                    selectedPatientIds.push(patientId);
                }
            }
        }

        if (selectedPatientIds.length === 0) {
            await context.sendActivity('Please select at least one patient to generate summaries.');
            return;
        }

        const rlog = createRequestLogger('Bot', context);
        rlog.info({ count: selectedPatientIds.length }, 'Generating summaries');

        // Send processing card
        const processingCard = cardBuilder.buildProcessingCard(selectedPatientIds.length, value.workerId);
        const procCard = CardFactory.adaptiveCard(processingCard);
        await context.sendActivity({ attachments: [procCard] });

        // Generate summaries for each selected patient
        // TODO: In production, this would be async with proactive messaging
        for (const patientId of selectedPatientIds) {
            try {
                const summary = await summaryService.generateSummary(patientId);

                if (summary) {
                    const summaryCard = cardBuilder.buildSummaryCard(summary);
                    const card = CardFactory.adaptiveCard(summaryCard);
                    await context.sendActivity({ attachments: [card] });
                }
            } catch (error) {
                rlog.error({ err: error, patientId }, 'Error generating summary');
                await context.sendActivity(`Error generating summary for patient ${patientId}.`);
            }
        }

        await context.sendActivity(`Generated ${selectedPatientIds.length} summary(ies). Click "Back to Patients" on any card to select more patients.`);
    }

    /**
     * Handle back to patients navigation
     */
    async handleBackToPatients(context) {
        const conversationId = context.activity.conversation.id;
        const workerCtx = this._getContext(conversationId);

        if (workerCtx && workerCtx.worker && workerCtx.selectedDate) {
            // Modern flow: show date-based patient selection
            const listCard = cardBuilder.buildPatientSelectionCard(workerCtx.worker, workerCtx.patients || [], workerCtx.selectedDate);
            const card = CardFactory.adaptiveCard(listCard);
            await context.sendActivity({ attachments: [card] });
        } else if (workerCtx && workerCtx.worker) {
            // Legacy flow fallback
            const listCard = cardBuilder.buildRecertPatientListCard(workerCtx.worker, workerCtx.patients || []);
            const card = CardFactory.adaptiveCard(listCard);
            await context.sendActivity({ attachments: [card] });
        } else {
            // No context, go back to welcome
            await this.sendWelcomeCard(context);
        }
    }

    /**
     * Handle patient selection - show AI summary card if available, otherwise resource selection
     */
    async handlePatientSelect(context, patientId, patientName, skipSummary = false) {
        if (!patientId) {
            await context.sendActivity('Invalid patient selection.');
            await this.sendWelcomeCard(context);
            return;
        }

        const rlog = createRequestLogger('Bot', context);
        rlog.info({ patientId, skipSummary }, 'Patient selected');

        try {
            const conversationId = context.activity.conversation.id;
            const workerCtx = this._getContext(conversationId);

            if (!workerCtx || !workerCtx.worker) {
                await this.sendWelcomeCard(context);
                return;
            }

            // Find the patient in our context or create a minimal patient object
            let patient = workerCtx.patients?.find(p => p.id === patientId);
            if (!patient) {
                const name = patientName || patientId;
                const nameParts = name.includes(',') ? name.split(',').map(s => s.trim()) : [null, name];
                patient = {
                    id: patientId,
                    fullName: name,
                    lastName: nameParts[0] || name,
                    firstName: nameParts[1] || '',
                    name: name
                };
            }

            // Store selected patient in context
            workerCtx.selectedPatient = patient;
            this._setContext(conversationId, workerCtx);

            // Check if we have pre-loaded AI summaries and should show them
            const patientSummary = workerCtx.documentSummaries?.[patientId];

            if (!skipSummary && patientSummary) {
                // Show the AI summary card
                rlog.debug({ patientId }, 'Showing AI summary');
                const summaryCard = cardBuilder.buildAISummaryCard(patient, patientSummary, workerCtx.worker);
                const card = CardFactory.adaptiveCard(summaryCard);
                await context.sendActivity({ attachments: [card] });
            } else {
                // Show the resource selection card
                const resourceCard = cardBuilder.buildResourceSelectionCard(patient, workerCtx.worker);
                const card = CardFactory.adaptiveCard(resourceCard);
                await context.sendActivity({ attachments: [card] });
            }

        } catch (error) {
            rlog.error({ err: error }, 'Error handling patient selection');
            await context.sendActivity('Sorry, there was an error. Please try again.');
            await this.sendWelcomeCard(context);
        }
    }

    /**
     * Handle fetching selected FHIR resources
     */
    async handleFetchResources(context, value) {
        const rlog = createRequestLogger('Bot', context);
        rlog.info('Handling fetchResources action');

        try {
            const conversationId = context.activity.conversation.id;
            const workerCtx = this._getContext(conversationId);

            if (!workerCtx || !workerCtx.worker || !workerCtx.selectedPatient) {
                await this.sendWelcomeCard(context);
                return;
            }

            const patientId = value.patientId || workerCtx.selectedPatient?.id;
            const workerId = value.workerId || workerCtx.worker.id;

            if (!patientId) {
                await this.sendWelcomeCard(context);
                return;
            }

            // Extract selected resources from the form data
            const selectedResources = dataFetchService.extractSelectedResources(value);
            rlog.info({ resources: selectedResources }, 'Selected resources');

            if (selectedResources.length === 0) {
                await context.sendActivity('Please select at least one data type to fetch.');
                return;
            }

            // Show processing message with typing indicator
            await context.sendActivity(`Fetching ${selectedResources.length} data type(s) from HCHB... This may take a moment.`);

            // Fetch the selected resources
            const { results, errors } = await dataFetchService.fetchSelectedResources(
                patientId,
                workerId,
                selectedResources
            );

            // Apply formatting to non-AI data types
            const aiLog = createLogger('AISummary');
            for (const resourceId of Object.keys(results)) {
                const result = results[resourceId];
                if (!result.needsAISummary && result.data) {
                    result.formatted = dataFetchService.formatSimpleData(resourceId, result.data);
                }
                // TODO: Apply AI summarization for complex types
                // For now, just format everything
                if (result.needsAISummary && result.data && !result.data.placeholder) {
                    result.summary = await this.generateAISummary(resourceId, result.data, aiLog);
                }
            }

            // Store selected resources in context for back navigation
            workerCtx.selectedResources = selectedResources;
            this._setContext(conversationId, workerCtx);

            // Use the patient matching the fetched patientId (not context which may be stale)
            const displayPatient = workerCtx.patients?.find(p => p.id === patientId)
                || workerCtx.selectedPatient
                || { id: patientId, fullName: patientId };
            const resultsCard = cardBuilder.buildDataResultsCard(
                displayPatient,
                results,
                errors
            );
            const card = CardFactory.adaptiveCard(resultsCard);
            await context.sendActivity({ attachments: [card] });

        } catch (error) {
            rlog.error({ err: error }, 'Error fetching resources');
            const errorCard = cardBuilder.buildErrorCard(
                'Error Fetching Data',
                'There was an error fetching the selected data. Please try again.'
            );
            const card = CardFactory.adaptiveCard(errorCard);
            await context.sendActivity({ attachments: [card] });
        }
    }

    /**
     * Generate AI summary for complex data types using Azure OpenAI
     */
    async generateAISummary(resourceId, data, aiLog) {
        if (!aiLog) aiLog = createLogger('AISummary');

        if (!data || (Array.isArray(data) && data.length === 0)) {
            return 'No data available for summarization.';
        }

        const count = Array.isArray(data) ? data.length : 1;
        const resourceLabel = dataFetchService.getResourceLabel(resourceId);

        try {
            // Handle DocumentReference types - these may have PDF attachments or inline content
            if (resourceId.startsWith('DocumentReference-')) {
                const docs = Array.isArray(data) ? data : [data];
                const summaries = [];

                for (const doc of docs.slice(0, 3)) { // Limit to 3 docs for speed
                    const docLabel = doc.description || doc.type || 'Document';
                    const docDate = doc.date || 'N/A';

                    // Try PDF extraction first if URL exists
                    if (doc.url && doc.contentType === 'application/pdf') {
                        try {
                            const result = await documentService.extractAndSummarizeDocument(doc.url, {
                                documentType: doc.type || resourceId.replace('DocumentReference-', '')
                            });
                            if (result.success && result.summary) {
                                summaries.push(`**${docLabel} (${docDate}):**\n${result.summary}`);
                                continue;
                            }
                        } catch (docError) {
                            aiLog.error({ err: docError }, 'Error processing PDF');
                        }
                    }

                    // Fallback: summarize inline content (may be base64 encoded)
                    if (doc.content && doc.content.length > 50) {
                        try {
                            // Decode base64 if needed
                            let textContent = doc.content;
                            const looksLikeBase64 = doc.content.length >= 100
                                && doc.content.length % 4 === 0
                                && /^[A-Za-z0-9+/]+={0,2}$/.test(doc.content)
                                && /[0-9+/=]/.test(doc.content);
                            if (looksLikeBase64) {
                                try {
                                    textContent = Buffer.from(doc.content, 'base64').toString('utf-8');
                                    aiLog.debug({ charCount: textContent.length }, 'Decoded base64 content');
                                } catch (decodeErr) {
                                    // Not base64, use as-is
                                }
                            }

                            if (textContent && textContent.length > 20) {
                                const result = await azureOpenAI.summarizeDocument(textContent, {
                                    documentType: doc.type || 'clinical note',
                                    maxTokens: 500
                                });
                                if (result.success && result.summary) {
                                    summaries.push(`**${docLabel} (${docDate}):**\n${result.summary}`);
                                    continue;
                                }
                            }
                        } catch (err) {
                            aiLog.error({ err }, 'Error summarizing content');
                        }
                    }

                    // Last resort: show basic info
                    if (doc.description) {
                        summaries.push(`**${docLabel} (${docDate}):** ${doc.description}`);
                    } else if (doc.author) {
                        summaries.push(`**${docLabel} (${docDate}):** Document by ${doc.author}`);
                    }
                }

                if (summaries.length > 0) {
                    return summaries.join('\n\n---\n\n');
                }
                return `Found ${count} document(s) but no content available for summarization.`;
            }

            // Handle CarePlan types
            if (resourceId.startsWith('CarePlan-')) {
                const carePlanText = JSON.stringify(data, null, 2);
                const result = await azureOpenAI.summarizeDocument(carePlanText, {
                    documentType: 'care plan',
                    maxTokens: 500
                });
                if (result.success) {
                    return result.summary;
                }
            }

            // Handle Condition types
            if (resourceId.startsWith('Condition-')) {
                if (Array.isArray(data)) {
                    const conditions = data.map(c => {
                        const name = c.display || c.code?.text || 'Unknown';
                        const status = c.clinicalStatus || c.status || '';
                        return `- ${name}${status ? ` (${status})` : ''}`;
                    });
                    return `**${resourceLabel}:**\n${conditions.join('\n')}`;
                }
            }

            // Handle Episode of Care
            if (resourceId === 'EpisodeOfCare') {
                if (Array.isArray(data) && data.length > 0) {
                    const episode = data[0];
                    return `**Episode:** ${episode.status || 'Active'}\n**Period:** ${episode.periodStart || 'N/A'} to ${episode.periodEnd || 'Ongoing'}`;
                }
            }

            // Handle Encounters
            if (resourceId === 'Encounter') {
                if (Array.isArray(data) && data.length > 0) {
                    const encounters = data.slice(0, 5).map(e => {
                        return `- ${e.date || 'N/A'}: ${e.type || 'Visit'}`;
                    });
                    return `**Recent Encounters:**\n${encounters.join('\n')}`;
                }
            }

            // Default: format as JSON summary
            return `**${resourceLabel}:** ${count} record(s) found.`;

        } catch (error) {
            aiLog.error({ err: error, resourceId }, 'Error generating AI summary');
            return `**${resourceLabel}:** ${count} record(s) found. (AI summary unavailable)`;
        }
    }

    /**
     * Handle viewing documents for a patient
     */
    async handleViewDocuments(context, patientId, patientName) {
        if (!patientId) {
            await context.sendActivity('Invalid patient selection.');
            await this.sendWelcomeCard(context);
            return;
        }

        const rlog = createRequestLogger('Bot', context);
        rlog.info({ patientId }, 'Viewing documents');

        try {
            const conversationId = context.activity.conversation.id;
            const workerCtx = this._getContext(conversationId);

            // Send processing message
            await context.sendActivity('Fetching patient documents...');

            // Fetch documents from FHIR
            const documents = await documentService.getPatientDocuments(patientId, { limit: 100 });
            rlog.info({ patientId, documentCount: documents.length }, 'Documents fetched');

            // Get patient info from context or create minimal object
            let patient = workerCtx?.selectedPatient;
            if (!patient || patient.id !== patientId) {
                patient = workerCtx?.patients?.find(p => p.id === patientId);
            }
            if (!patient) {
                patient = {
                    id: patientId,
                    fullName: patientName || patientId
                };
            }

            // Build and send the document list card
            const docCard = cardBuilder.buildDocumentListCard(
                patient,
                documents,
                workerCtx?.worker
            );
            const card = CardFactory.adaptiveCard(docCard);
            await context.sendActivity({ attachments: [card] });

        } catch (error) {
            rlog.error({ err: error }, 'Error fetching documents');
            const errorCard = cardBuilder.buildErrorCard(
                'Error Fetching Documents',
                'There was an error fetching documents. Please try again.'
            );
            const card = CardFactory.adaptiveCard(errorCard);
            await context.sendActivity({ attachments: [card] });
        }
    }

    /**
     * Handle back to resource selection navigation
     */
    async handleBackToResourceSelection(context) {
        const conversationId = context.activity.conversation.id;
        const workerCtx = this._getContext(conversationId);

        if (workerCtx && workerCtx.worker && workerCtx.selectedPatient) {
            const resourceCard = cardBuilder.buildResourceSelectionCard(
                workerCtx.selectedPatient,
                workerCtx.worker
            );
            const card = CardFactory.adaptiveCard(resourceCard);
            await context.sendActivity({ attachments: [card] });
        } else {
            await this.sendWelcomeCard(context);
        }
    }

    /**
     * Handle patient search action (legacy)
     */
    async handlePatientSearch(context, searchTerm) {
        if (!searchTerm || searchTerm.trim() === '') {
            await context.sendActivity('Please enter a patient name to search.');
            await this.sendWelcomeCard(context);
            return;
        }

        const rlog = createRequestLogger('Bot', context);
        rlog.info('Searching for patients');

        try {
            const patients = await patientService.searchPatients(searchTerm);
            rlog.info({ resultCount: patients.length }, 'Patient search results');

            const listCard = cardBuilder.buildPatientListCard(searchTerm, patients);
            const card = CardFactory.adaptiveCard(listCard);
            await context.sendActivity({ attachments: [card] });
        } catch (error) {
            rlog.error({ err: error }, 'Error searching patients');
            await context.sendActivity('Sorry, there was an error searching for patients. Please try again.');
            await this.sendWelcomeCard(context);
        }
    }
}

const bot = new RecertBot();

// Health check endpoint
app.get('/', (req, res) => {
    res.send('Bot is running!');
});

// Listen for incoming requests
app.post('/api/messages', async (req, res) => {
    log.debug({ activityType: req.body?.type }, 'Incoming activity');
    try {
        await adapter.process(req, res, async (context) => {
            await bot.run(context);
        });
    } catch (error) {
        log.error({ err: error }, 'Error processing activity');
        if (!res.headersSent) {
            res.status(500).send({ error: error.message });
        }
    }
});

// Start server
const port = process.env.PORT || 3978;
const server = app.listen(port, '0.0.0.0', () => {
    log.info({ port, mode: LOCAL_DEBUG ? 'LOCAL DEBUG' : 'Production' }, 'Bot started');
});

server.on('error', (err) => {
    rootLogger.fatal({ err }, 'Server error');
});

// Graceful shutdown
process.on('SIGINT', () => {
    rootLogger.info('Shutting down');
    clearInterval(bot._evictionInterval);
    server.close(() => {
        rootLogger.info('Server closed');
        process.exit(0);
    });
});
