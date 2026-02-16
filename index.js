require('dotenv').config();

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
        console.warn('\n=== MISSING ENVIRONMENT VARIABLES ===');
        for (const [group, vars] of Object.entries(missing)) {
            console.warn(`  [${group}]: ${vars.join(', ')}`);
        }
        console.warn('Some features may not work. Set these in your .env file.\n');
    }
}

// Catch unhandled errors
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
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
    console.log('*** LOCAL DEBUG MODE - Authentication disabled ***');
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
    console.error(`\n [onTurnError] Error: ${error}`);
    console.error(error.stack);
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
                console.error('Error handling message:', error);
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
            console.log(`[Bot] Evicted ${evicted} expired conversation context(s). Active: ${this.workerContext.size}`);
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
        console.log(`[Bot] Card action: ${value.action}`);

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
                console.log(`Unknown action: ${value.action}`);
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

        console.log('[Bot] Validating worker');

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
            console.error('Error validating worker:', error);
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

        console.log(`Loading patients for worker ${workerId} on date ${selectedDate}`);

        // Send processing message immediately
        await context.sendActivity(`Loading your patients for ${selectedDate}...`);

        try {
            const conversationId = context.activity.conversation.id;
            let workerCtx = this._getContext(conversationId);

            // If no context, validate worker again
            if (!workerCtx || !workerCtx.worker) {
                console.log('No worker context found, re-validating worker');
                const worker = await patientService.getWorkerById(workerId);
                if (!worker) {
                    await context.sendActivity('Session expired. Please start over.');
                    await this.sendWelcomeCard(context);
                    return;
                }
                workerCtx = { worker, selectedDate: null, patients: [], selectedPatient: null };
            }

            // Get patients scheduled for this worker on this date
            console.log(`[Bot] Fetching patients for worker ${workerId} on ${selectedDate}`);
            const patients = await patientService.getPatientsByWorkerAndDate(workerId, selectedDate);
            console.log(`[Bot] Found ${patients.length} patients for ${selectedDate}`);

            // Update context with patients
            workerCtx.selectedDate = selectedDate;
            workerCtx.patients = patients;
            workerCtx.documentSummaries = {}; // Initialize empty summaries
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
                console.error('[Bot] Background document preload failed:', err.message);
            });

        } catch (error) {
            console.error('Error loading patients by date:', error);
            console.error('Error details:', error.stack);
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

            console.log(`[Bot] Starting document pre-load for ${patients.length} patients`);
            const startTime = Date.now();

            // Batch fetch and summarize documents for all patients
            const summaries = await documentService.batchFetchAndSummarizeDocuments(patients, {
                maxDocsPerPatient: 5,
                includeConsolidated: true
            });

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[Bot] Document pre-load complete in ${elapsed}s`);

            // Update the worker context with summaries
            const workerCtx = this._getContext(conversationId);
            if (workerCtx) {
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
            }

        } catch (error) {
            console.error('[Bot] Error pre-loading document summaries:', error);
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

        console.log('[Bot] Loading patients (legacy)');

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
            console.log(`Found ${patients.length} recert patients for ${worker.name}`);

            // Store worker context for back navigation
            const conversationId = context.activity.conversation.id;
            this._setContext(conversationId, { worker, patients });

            // Build and send the patient selection card
            const listCard = cardBuilder.buildRecertPatientListCard(worker, patients);
            const card = CardFactory.adaptiveCard(listCard);
            await context.sendActivity({ attachments: [card] });

        } catch (error) {
            console.error('Error loading patients:', error);
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

        console.log(`[Bot] Generating summaries for ${selectedPatientIds.length} patients`);

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
                console.error(`Error generating summary for patient ${patientId}:`, error);
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

        console.log(`[Bot] Patient selected, skipSummary: ${skipSummary}`);

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
                patient = {
                    id: patientId,
                    fullName: patientName || patientId
                };
            }

            // Store selected patient in context
            workerCtx.selectedPatient = patient;
            this._setContext(conversationId, workerCtx);

            // Check if we have pre-loaded AI summaries and should show them
            const patientSummary = workerCtx.documentSummaries?.[patientId];

            if (!skipSummary && patientSummary) {
                // Show the AI summary card
                console.log(`[Bot] Showing AI summary for patient ${patientId}`);
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
            console.error('Error handling patient selection:', error);
            await context.sendActivity('Sorry, there was an error. Please try again.');
            await this.sendWelcomeCard(context);
        }
    }

    /**
     * Handle fetching selected FHIR resources
     */
    async handleFetchResources(context, value) {
        console.log('Handling fetchResources action');

        try {
            const conversationId = context.activity.conversation.id;
            const workerCtx = this._getContext(conversationId);

            if (!workerCtx || !workerCtx.worker || !workerCtx.selectedPatient) {
                await this.sendWelcomeCard(context);
                return;
            }

            const patientId = value.patientId || workerCtx.selectedPatient.id;
            const workerId = value.workerId || workerCtx.worker.id;

            // Extract selected resources from the form data
            const selectedResources = dataFetchService.extractSelectedResources(value);
            console.log(`Selected resources: ${selectedResources.join(', ')}`);

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
            for (const resourceId of Object.keys(results)) {
                const result = results[resourceId];
                if (!result.needsAISummary && result.data) {
                    result.formatted = dataFetchService.formatSimpleData(resourceId, result.data);
                }
                // TODO: Apply AI summarization for complex types
                // For now, just format everything
                if (result.needsAISummary && result.data && !result.data.placeholder) {
                    result.summary = await this.generateAISummary(resourceId, result.data);
                }
            }

            // Store selected resources in context for back navigation
            workerCtx.selectedResources = selectedResources;
            this._setContext(conversationId, workerCtx);

            // Build and send results card
            const resultsCard = cardBuilder.buildDataResultsCard(
                workerCtx.selectedPatient,
                results,
                errors
            );
            const card = CardFactory.adaptiveCard(resultsCard);
            await context.sendActivity({ attachments: [card] });

        } catch (error) {
            console.error('Error fetching resources:', error);
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
    async generateAISummary(resourceId, data) {
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
                            console.error(`[AI Summary] Error processing PDF:`, docError.message);
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
                                    console.log(`[AI Summary] Decoded base64 content: ${textContent.length} chars`);
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
                            console.error(`[AI Summary] Error summarizing content:`, err.message);
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
            console.error(`[AI Summary] Error generating summary for ${resourceId}:`, error.message);
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

        console.log('[Bot] Viewing documents for patient');

        try {
            const conversationId = context.activity.conversation.id;
            const workerCtx = this._getContext(conversationId);

            // Send processing message
            await context.sendActivity('Fetching patient documents...');

            // Fetch documents from FHIR
            const documents = await documentService.getPatientDocuments(patientId, { limit: 100 });
            console.log(`Found ${documents.length} documents for patient ${patientId}`);

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
            console.error('Error fetching documents:', error);
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

        console.log('[Bot] Searching for patients');

        try {
            const patients = await patientService.searchPatients(searchTerm);
            console.log(`Found ${patients.length} patients`);

            const listCard = cardBuilder.buildPatientListCard(searchTerm, patients);
            const card = CardFactory.adaptiveCard(listCard);
            await context.sendActivity({ attachments: [card] });
        } catch (error) {
            console.error('Error searching patients:', error);
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
    console.log('[Bot] Incoming activity:', req.body?.type || 'unknown');
    try {
        await adapter.process(req, res, async (context) => {
            await bot.run(context);
        });
    } catch (error) {
        console.error('Error processing activity:', error);
        if (!res.headersSent) {
            res.status(500).send({ error: error.message });
        }
    }
});

// Start server
const port = process.env.PORT || 3978;
const server = app.listen(port, '0.0.0.0', () => {
    console.log(`\nBot is running on http://localhost:${port}/api/messages`);
    console.log(`Mode: ${LOCAL_DEBUG ? 'LOCAL DEBUG' : 'Production'}`);
    console.log(`Press Ctrl+C to stop.\n`);
});

server.on('error', (err) => {
    console.error('Server error:', err);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down...');
    clearInterval(bot._evictionInterval);
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});
