/**
 * Azure OpenAI Service
 * Handles AI-powered text analysis and summarization for clinical documents
 */

const { AzureOpenAI } = require("openai");
const { createLogger } = require("./logger");
const log = createLogger("AzureOpenAI");

// Initialize Azure OpenAI client
let client = null;

function getClient() {
    if (!client) {
        const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
        const apiKey = process.env.AZURE_OPENAI_API_KEY;
        const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-08-01-preview";

        if (!endpoint || !apiKey) {
            throw new Error('Azure OpenAI credentials not configured. Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY in .env');
        }

        client = new AzureOpenAI({
            endpoint,
            apiKey,
            apiVersion
        });
    }
    return client;
}

/**
 * Summarize clinical document text
 * @param {string} documentText - The extracted text from the document
 * @param {object} options - Summary options
 * @returns {Promise<object>} Summary result
 */
async function summarizeDocument(documentText, options = {}) {
    const {
        documentType = 'clinical note',
        maxTokens = 1000,
        focusAreas = null
    } = options;

    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';

    log.info({ documentType, charCount: documentText.length }, 'Summarizing document');

    const systemPrompt = `You are a clinical documentation specialist helping home health nurses prepare for patient visits. 
Your task is to summarize clinical documents concisely and accurately.

Guidelines:
- Extract key clinical findings, diagnoses, and care recommendations
- Highlight any changes in patient condition
- Note medications mentioned
- Identify follow-up actions or orders
- Keep summaries concise but comprehensive
- Use clinical terminology appropriately
- Format for easy scanning during a patient visit`;

    let userPrompt = `Please summarize this ${documentType}:\n\n${documentText}`;

    if (focusAreas && focusAreas.length > 0) {
        userPrompt += `\n\nPlease focus especially on: ${focusAreas.join(', ')}`;
    }

    try {
        const openai = getClient();
        const response = await openai.chat.completions.create({
            model: deployment,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            max_tokens: maxTokens,
            temperature: 0.3 // Lower temperature for more consistent clinical summaries
        });

        const summary = response.choices[0]?.message?.content;

        log.debug({ charCount: summary?.length || 0 }, 'Summary generated');

        return {
            success: true,
            summary,
            usage: {
                promptTokens: response.usage?.prompt_tokens,
                completionTokens: response.usage?.completion_tokens,
                totalTokens: response.usage?.total_tokens
            }
        };

    } catch (error) {
        log.error({ err: error }, 'Summarization failed');
        return {
            success: false,
            error: error.message,
            summary: null
        };
    }
}

/**
 * Summarize multiple documents into a consolidated view
 * @param {Array<{text: string, type: string, date: string}>} documents - Array of document objects
 * @param {object} options - Summary options
 * @returns {Promise<object>} Consolidated summary
 */
async function summarizeMultipleDocuments(documents, options = {}) {
    const {
        maxTokens = 1500,
        patientContext = null
    } = options;

    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';

    log.info({ documentCount: documents.length }, 'Consolidating documents');

    const systemPrompt = `You are a clinical documentation specialist helping home health nurses prepare for recertification visits.
Your task is to consolidate multiple clinical documents into a comprehensive episode summary.

Guidelines:
- Identify trends and changes over time
- Highlight the patient's progress toward goals
- Note any complications or setbacks
- Summarize key interventions and their outcomes
- List current medications and any changes
- Identify areas needing attention at recertification
- Format for easy reference during the visit`;

    let userPrompt = 'Please provide a consolidated summary of these clinical documents:\n\n';

    if (patientContext) {
        userPrompt += `Patient Context: ${patientContext}\n\n`;
    }

    documents.forEach((doc, index) => {
        userPrompt += `--- Document ${index + 1} (${doc.type}, ${doc.date}) ---\n${doc.text}\n\n`;
    });

    userPrompt += 'Provide a consolidated summary highlighting key clinical information for the recertification visit.';

    try {
        const openai = getClient();
        const response = await openai.chat.completions.create({
            model: deployment,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            max_tokens: maxTokens,
            temperature: 0.3
        });

        const summary = response.choices[0]?.message?.content;

        log.debug({ charCount: summary?.length || 0 }, 'Consolidated summary generated');

        return {
            success: true,
            summary,
            documentCount: documents.length,
            usage: {
                promptTokens: response.usage?.prompt_tokens,
                completionTokens: response.usage?.completion_tokens,
                totalTokens: response.usage?.total_tokens
            }
        };

    } catch (error) {
        log.error({ err: error }, 'Document consolidation failed');
        return {
            success: false,
            error: error.message,
            summary: null
        };
    }
}

/**
 * Extract structured data from clinical text
 * @param {string} documentText - The clinical document text
 * @returns {Promise<object>} Extracted structured data
 */
async function extractClinicalData(documentText) {
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';

    log.info({ charCount: documentText.length }, 'Extracting clinical data');

    const systemPrompt = `You are a clinical data extraction specialist. Extract structured information from clinical documents.
Return your response as a JSON object with the following structure (include only fields that are present in the document):

{
    "diagnoses": ["list of diagnoses mentioned"],
    "medications": [{"name": "med name", "dose": "dose if mentioned", "frequency": "frequency if mentioned"}],
    "vitals": {"bp": "", "hr": "", "temp": "", "weight": "", "o2sat": ""},
    "findings": ["key clinical findings"],
    "interventions": ["interventions performed"],
    "patientStatus": "brief description of patient's current status",
    "followUpNeeded": ["any follow-up items identified"],
    "alerts": ["any urgent or important alerts"]
}`;

    try {
        const openai = getClient();
        const response = await openai.chat.completions.create({
            model: deployment,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Extract structured clinical data from this document:\n\n${documentText}` }
            ],
            max_tokens: 1000,
            temperature: 0.1, // Very low temperature for consistent extraction
            response_format: { type: "json_object" }
        });

        const content = response.choices[0]?.message?.content;
        const extractedData = JSON.parse(content);

        log.info('Clinical data extracted');

        return {
            success: true,
            data: extractedData,
            usage: {
                promptTokens: response.usage?.prompt_tokens,
                completionTokens: response.usage?.completion_tokens,
                totalTokens: response.usage?.total_tokens
            }
        };

    } catch (error) {
        log.error({ err: error }, 'Clinical data extraction failed');
        return {
            success: false,
            error: error.message,
            data: null
        };
    }
}

/**
 * Generate recertification talking points based on episode data
 * @param {object} episodeData - Compiled episode data
 * @returns {Promise<object>} Talking points and recommendations
 */
async function generateRecertTalkingPoints(episodeData) {
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';

    log.info('Generating recertification talking points');

    const systemPrompt = `You are a home health clinical consultant helping nurses prepare for recertification visits.
Based on the episode data provided, generate:
1. Key talking points for the physician/NP signature visit
2. Goals to discuss (met, unmet, continue, revise, discharge)
3. Homebound status justification points
4. Skilled nursing need justification
5. Any red flags or concerns to address

Format your response clearly with sections for each area.`;

    const userPrompt = `Generate recertification talking points based on this episode data:\n\n${JSON.stringify(episodeData, null, 2)}`;

    try {
        const openai = getClient();
        const response = await openai.chat.completions.create({
            model: deployment,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            max_tokens: 1200,
            temperature: 0.4
        });

        const talkingPoints = response.choices[0]?.message?.content;

        log.info('Talking points generated');

        return {
            success: true,
            talkingPoints,
            usage: {
                promptTokens: response.usage?.prompt_tokens,
                completionTokens: response.usage?.completion_tokens,
                totalTokens: response.usage?.total_tokens
            }
        };

    } catch (error) {
        log.error({ err: error }, 'Talking points generation failed');
        return {
            success: false,
            error: error.message,
            talkingPoints: null
        };
    }
}

/**
 * Check if Azure OpenAI is configured and accessible
 * @returns {Promise<object>} Configuration status
 */
async function checkConfiguration() {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;

    const status = {
        configured: !!(endpoint && apiKey && deployment),
        endpoint: endpoint ? endpoint.replace(/\/+$/, '') : null,
        deployment: deployment || null,
        hasApiKey: !!apiKey,
        accessible: false,
        error: null
    };

    if (!status.configured) {
        status.error = 'Missing required environment variables';
        return status;
    }

    // Test the connection with a simple request
    try {
        const openai = getClient();
        const response = await openai.chat.completions.create({
            model: deployment,
            messages: [{ role: "user", content: "test" }],
            max_tokens: 5
        });
        status.accessible = true;
    } catch (error) {
        status.error = error.message;
    }

    return status;
}

module.exports = {
    summarizeDocument,
    summarizeMultipleDocuments,
    extractClinicalData,
    generateRecertTalkingPoints,
    checkConfiguration
};
