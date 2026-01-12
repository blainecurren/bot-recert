require('dotenv').config();

// Catch unhandled errors
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const { ActivityHandler, BotFrameworkAdapter, CardFactory } = require('botbuilder');
const express = require('express');

// Import services and card builder
const patientService = require('./services/patientService');
const summaryService = require('./services/summaryService');
const dataFetchService = require('./services/dataFetchService');
const cardBuilder = require('./cards/cardBuilder');

// Create server
const app = express();
app.use(express.json());

// Create adapter - skip auth for local testing if LOCAL_DEBUG is set
const LOCAL_DEBUG = process.env.LOCAL_DEBUG === 'true';

const adapter = new BotFrameworkAdapter({
    appId: LOCAL_DEBUG ? '' : process.env.MicrosoftAppId,
    appPassword: LOCAL_DEBUG ? '' : process.env.MicrosoftAppPassword
});

if (LOCAL_DEBUG) {
    console.log('*** LOCAL DEBUG MODE - Authentication disabled ***');
}

// Error handler
adapter.onTurnError = async (context, error) => {
    console.error(`\n [onTurnError] Error: ${error}`);
    console.error(error.stack);
    await context.sendActivity('Oops. Something went wrong!');
};

// Bot logic
class RecertBot extends ActivityHandler {
    constructor() {
        super();

        // Store worker context for back navigation
        this.workerContext = new Map();

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
                    const userMessage = context.activity.text;
                    console.log(`Received text message: ${userMessage}`);
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
        console.log(`Handling card action: ${value.action}`, JSON.stringify(value, null, 2));

        switch (value.action) {
            case 'validateWorker':
                await this.handleValidateWorker(context, value.workerId);
                break;

            case 'loadPatientsByDate':
                console.log('loadPatientsByDate - Full value object:', JSON.stringify(value, null, 2));
                await this.handleLoadPatientsByDate(context, value.workerId, value.selectedDate);
                break;

            case 'selectPatient':
                await this.handlePatientSelect(context, value.patientId, value.patientName);
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

        console.log(`Validating worker: ${workerId}`);

        // Send processing message
        await context.sendActivity('Validating your Worker ID...');

        try {
            // Validate worker
            const worker = await patientService.getWorkerById(workerId);

            if (!worker) {
                const errorCard = cardBuilder.buildErrorCard(
                    'Worker Not Found',
                    `No worker found with ID "${workerId}". Please check your Worker ID and try again.`
                );
                const card = CardFactory.adaptiveCard(errorCard);
                await context.sendActivity({ attachments: [card] });
                return;
            }

            // Store worker in context
            const conversationId = context.activity.conversation.id;
            this.workerContext.set(conversationId, {
                worker,
                selectedDate: null,
                patients: [],
                selectedPatient: null
            });

            // Show date selection card
            const dateCard = cardBuilder.buildDateSelectionCard(worker);
            const card = CardFactory.adaptiveCard(dateCard);
            await context.sendActivity({ attachments: [card] });

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
            let workerCtx = this.workerContext.get(conversationId);

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
            console.log(`Fetching patients from FHIR for worker ${workerId} on ${selectedDate}`);
            const patients = await patientService.getPatientsByWorkerAndDate(workerId, selectedDate);
            console.log(`Found ${patients.length} patients for ${workerCtx.worker.name} on ${selectedDate}`);

            // Update context
            workerCtx.selectedDate = selectedDate;
            workerCtx.patients = patients;
            this.workerContext.set(conversationId, workerCtx);

            // Build and send the patient list card (single-select)
            const listCard = cardBuilder.buildPatientSelectionCard(workerCtx.worker, patients, selectedDate);
            const card = CardFactory.adaptiveCard(listCard);
            await context.sendActivity({ attachments: [card] });

            // If no patients found, add helpful message
            if (patients.length === 0) {
                await context.sendActivity('No patients found for this date. Try selecting a different date or check your schedule in HCHB.');
            }

        } catch (error) {
            console.error('Error loading patients by date:', error);
            console.error('Error details:', error.stack);
            const errorCard = cardBuilder.buildErrorCard(
                'Error Loading Patients',
                `There was an error loading patients for this date: ${error.message || 'Unknown error'}. Please try again.`
            );
            const card = CardFactory.adaptiveCard(errorCard);
            await context.sendActivity({ attachments: [card] });
        }
    }

    /**
     * Handle back to date selection navigation
     */
    async handleBackToDateSelection(context) {
        const conversationId = context.activity.conversation.id;
        const workerCtx = this.workerContext.get(conversationId);

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

        console.log(`Loading patients for worker: ${workerId}`);

        try {
            // Validate worker
            const worker = await patientService.getWorkerById(workerId);

            if (!worker) {
                const errorCard = cardBuilder.buildErrorCard(
                    'Worker Not Found',
                    `No worker found with ID "${workerId}". Please check your Worker ID and try again.`
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
            this.workerContext.set(conversationId, { worker, patients });

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

        console.log(`Generating summaries for ${selectedPatientIds.length} patients:`, selectedPatientIds);

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
        const workerCtx = this.workerContext.get(conversationId);

        if (workerCtx) {
            const listCard = cardBuilder.buildRecertPatientListCard(workerCtx.worker, workerCtx.patients);
            const card = CardFactory.adaptiveCard(listCard);
            await context.sendActivity({ attachments: [card] });
        } else {
            // No context, go back to welcome
            await this.sendWelcomeCard(context);
        }
    }

    /**
     * Handle patient selection - show resource selection card
     */
    async handlePatientSelect(context, patientId, patientName) {
        if (!patientId) {
            await context.sendActivity('Invalid patient selection.');
            await this.sendWelcomeCard(context);
            return;
        }

        console.log(`Patient selected: ${patientId}`);

        try {
            const conversationId = context.activity.conversation.id;
            const workerCtx = this.workerContext.get(conversationId);

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
            this.workerContext.set(conversationId, workerCtx);

            // Show the resource selection card
            const resourceCard = cardBuilder.buildResourceSelectionCard(patient, workerCtx.worker);
            const card = CardFactory.adaptiveCard(resourceCard);
            await context.sendActivity({ attachments: [card] });

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
            const workerCtx = this.workerContext.get(conversationId);

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
            this.workerContext.set(conversationId, workerCtx);

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
     * Generate AI summary for complex data types
     * TODO: Integrate with Azure OpenAI
     */
    async generateAISummary(resourceId, data) {
        // Placeholder - will be replaced with Azure OpenAI integration
        if (!data || (Array.isArray(data) && data.length === 0)) {
            return 'No data available for summarization.';
        }

        // For now, return a formatted summary based on data type
        const count = Array.isArray(data) ? data.length : 1;
        const resourceLabel = dataFetchService.getResourceLabel(resourceId);

        // Create a basic summary based on the data
        if (resourceId.startsWith('DocumentReference-')) {
            return `Found ${count} document(s). AI summarization will be available when Azure OpenAI is configured.`;
        } else if (resourceId.startsWith('CarePlan-')) {
            return `Care plan contains ${count} goal(s) and intervention(s). AI summarization will provide detailed analysis when configured.`;
        } else if (resourceId.startsWith('Condition-')) {
            if (Array.isArray(data)) {
                const conditions = data.map(c => c.display || c.code?.text || 'Unknown').join(', ');
                return `**Conditions:** ${conditions}`;
            }
            return `Condition data available. AI will organize by priority when configured.`;
        } else if (resourceId === 'EpisodeOfCare') {
            if (Array.isArray(data) && data.length > 0) {
                const episode = data[0];
                return `**Episode:** ${episode.status || 'Active'}\n**Period:** ${episode.periodStart || 'N/A'} to ${episode.periodEnd || 'Ongoing'}`;
            }
            return 'Episode of care data available.';
        } else if (resourceId === 'Encounter') {
            return `Found ${count} encounter(s). AI will provide chronological summary when configured.`;
        }

        return `${resourceLabel}: ${count} record(s) found. AI summarization pending configuration.`;
    }

    /**
     * Handle back to resource selection navigation
     */
    async handleBackToResourceSelection(context) {
        const conversationId = context.activity.conversation.id;
        const workerCtx = this.workerContext.get(conversationId);

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

        console.log(`Searching for patients: "${searchTerm}"`);

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
    console.log('Received request at /api/messages');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    try {
        await adapter.processActivity(req, res, async (context) => {
            await bot.run(context);
        });
    } catch (error) {
        console.error('Error processing activity:', error);
        res.status(500).send({ error: error.message });
    }
});

// Start server
const port = process.env.PORT || 3978;
const server = app.listen(port, '0.0.0.0', () => {
    console.log(`\nBot is running on http://localhost:${port}/api/messages`);
    console.log(`App ID: ${process.env.MicrosoftAppId}`);
    console.log(`Tenant: ${process.env.MicrosoftAppTenantId}`);
    console.log(`App Type: ${process.env.MicrosoftAppType}`);
    console.log(`\nPress Ctrl+C to stop.\n`);
});

server.on('error', (err) => {
    console.error('Server error:', err);
});

// Keep the process alive
setInterval(() => {}, 1000);

// Keep process alive
process.on('SIGINT', () => {
    console.log('Shutting down...');
    server.close();
    process.exit(0);
});
