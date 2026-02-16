/**
 * Document Service for HCHB FHIR API
 * Fetches clinical documents and attachments for patients
 */

const { fhirGet, getAccessToken } = require('./fhirClient');
const { client: pythonBackend } = require('./pythonBackendClient');
const azureOpenAI = require('./azureOpenAIService');

/**
 * Get all documents for a patient
 * @param {string} patientId - Patient FHIR ID
 * @param {object} options - Filter options
 * @returns {Promise<Array>} Array of document objects
 */
async function getPatientDocuments(patientId, options = {}) {
    const { limit = 50, type = null, dateFrom = null } = options;

    console.log(`[DocumentService] Fetching documents for patient ${patientId}`);

    try {
        const params = {
            patient: patientId,
            _count: limit,
            _sort: '-date'
        };

        if (type) {
            params.type = type;
        }

        if (dateFrom) {
            params.date = `ge${dateFrom}`;
        }

        const bundle = await fhirGet('/DocumentReference', params);

        if (!bundle.entry || bundle.entry.length === 0) {
            console.log('[DocumentService] No documents found');
            return [];
        }

        const documents = bundle.entry.map(entry => {
            const doc = entry.resource;
            const typeText = doc.type?.text || doc.type?.coding?.[0]?.display || 'Unknown';
            const attachment = doc.content?.[0]?.attachment || {};

            return {
                id: doc.id,
                type: typeText,
                date: doc.date ? doc.date.split('T')[0] : 'Unknown',
                description: doc.description || typeText,
                status: doc.status,
                filename: attachment.title || null,
                contentType: attachment.contentType || null,
                url: attachment.url || null,
                hasAttachment: !!attachment.url
            };
        });

        console.log(`[DocumentService] Found ${documents.length} documents`);
        return documents;

    } catch (error) {
        console.error('[DocumentService] Error fetching documents:', error.message);
        return [];
    }
}

/**
 * Get documents grouped by type
 * @param {string} patientId - Patient FHIR ID
 * @returns {Promise<Object>} Documents grouped by type
 */
async function getDocumentsByType(patientId) {
    const documents = await getPatientDocuments(patientId, { limit: 100 });

    const grouped = {};
    documents.forEach(doc => {
        if (!grouped[doc.type]) {
            grouped[doc.type] = [];
        }
        grouped[doc.type].push(doc);
    });

    return grouped;
}

/**
 * Get recent documents (last 30 days)
 * @param {string} patientId - Patient FHIR ID
 * @returns {Promise<Array>} Recent documents
 */
async function getRecentDocuments(patientId) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateFrom = thirtyDaysAgo.toISOString().split('T')[0];

    return getPatientDocuments(patientId, { dateFrom, limit: 50 });
}

/**
 * Get downloadable documents (those with PDF attachments)
 * @param {string} patientId - Patient FHIR ID
 * @returns {Promise<Array>} Documents with attachments
 */
async function getDownloadableDocuments(patientId) {
    const documents = await getPatientDocuments(patientId, { limit: 100 });
    return documents.filter(doc => doc.hasAttachment && doc.contentType === 'application/pdf');
}

/**
 * Get document types available for a patient
 * @param {string} patientId - Patient FHIR ID
 * @returns {Promise<Array>} List of document types with counts
 */
async function getDocumentTypes(patientId) {
    const grouped = await getDocumentsByType(patientId);

    return Object.keys(grouped)
        .map(type => ({
            type,
            count: grouped[type].length,
            hasAttachments: grouped[type].some(d => d.hasAttachment)
        }))
        .sort((a, b) => b.count - a.count);
}

/**
 * Extract text content from a PDF attachment
 * @param {string} attachmentUrl - URL to the PDF attachment
 * @returns {Promise<Object>} Extracted text and metadata
 */
async function extractDocumentText(attachmentUrl) {
    if (!attachmentUrl) {
        throw new Error('Attachment URL is required');
    }

    console.log(`[DocumentService] Extracting text from: ${attachmentUrl}`);

    try {
        const token = await getAccessToken();

        const response = await pythonBackend.post('/documents/extract-text', {
            url: attachmentUrl
        }, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        console.log(`[DocumentService] Extracted ${response.data.char_count} characters from ${response.data.page_count} pages`);

        return response.data;

    } catch (error) {
        const status = error.response?.status;
        const detail = error.response?.data?.detail || error.message;

        console.error(`[DocumentService] Text extraction failed (${status}):`, detail);

        return {
            success: false,
            error: detail,
            text: null,
            page_count: 0
        };
    }
}

/**
 * Extract and summarize a document using Azure OpenAI
 * @param {string} attachmentUrl - URL to the PDF attachment
 * @param {object} options - Summary options
 * @returns {Promise<Object>} Extracted text and AI summary
 */
async function extractAndSummarizeDocument(attachmentUrl, options = {}) {
    const { documentType = 'clinical note', focusAreas = null } = options;

    console.log(`[DocumentService] Extracting and summarizing document`);

    // Step 1: Extract text from PDF
    const extractResult = await extractDocumentText(attachmentUrl);

    if (!extractResult.success || !extractResult.text) {
        return {
            success: false,
            error: extractResult.error || 'Failed to extract text from document',
            text: null,
            summary: null
        };
    }

    // Step 2: Send to Azure OpenAI for summarization
    const summaryResult = await azureOpenAI.summarizeDocument(extractResult.text, {
        documentType,
        focusAreas
    });

    return {
        success: summaryResult.success,
        text: extractResult.text,
        pageCount: extractResult.page_count,
        charCount: extractResult.char_count,
        summary: summaryResult.summary,
        error: summaryResult.error,
        usage: summaryResult.usage
    };
}

/**
 * Summarize multiple documents for a patient
 * @param {string} patientId - Patient FHIR ID
 * @param {object} options - Summary options
 * @returns {Promise<Object>} Consolidated summary
 */
async function summarizePatientDocuments(patientId, options = {}) {
    const { limit = 10, documentTypes = null, patientContext = null } = options;

    console.log(`[DocumentService] Summarizing documents for patient ${patientId}`);

    // Get recent documents
    const documents = await getRecentDocuments(patientId);

    if (documents.length === 0) {
        return {
            success: false,
            error: 'No documents found for patient',
            summary: null
        };
    }

    // Filter by type if specified
    let filteredDocs = documents;
    if (documentTypes && documentTypes.length > 0) {
        filteredDocs = documents.filter(d => documentTypes.includes(d.type));
    }

    // Limit number of documents to process
    const docsToProcess = filteredDocs.slice(0, limit);

    // Extract text from each document
    const processedDocs = [];
    for (const doc of docsToProcess) {
        if (doc.hasAttachment && doc.url) {
            const extractResult = await extractDocumentText(doc.url);
            if (extractResult.success && extractResult.text) {
                processedDocs.push({
                    text: extractResult.text,
                    type: doc.type,
                    date: doc.date
                });
            }
        }
    }

    if (processedDocs.length === 0) {
        return {
            success: false,
            error: 'Could not extract text from any documents',
            summary: null
        };
    }

    // Send to Azure OpenAI for consolidated summary
    const summaryResult = await azureOpenAI.summarizeMultipleDocuments(processedDocs, {
        patientContext
    });

    return {
        success: summaryResult.success,
        documentCount: processedDocs.length,
        summary: summaryResult.summary,
        error: summaryResult.error,
        usage: summaryResult.usage
    };
}

/**
 * Batch fetch and summarize documents for multiple patients
 * Used during patient list loading to pre-compute summaries
 * @param {Array<Object>} patients - Array of patient objects with id property
 * @param {object} options - Options for summarization
 * @returns {Promise<Object>} Map of patientId -> { documents, summaries, consolidated }
 */
async function batchFetchAndSummarizeDocuments(patients, options = {}) {
    const {
        maxDocsPerPatient = 5,
        includeConsolidated = true,
        documentTypes = null // null = all types
    } = options;

    console.log(`[DocumentService] Batch processing documents for ${patients.length} patients`);

    const results = {};
    const startTime = Date.now();

    // Process patients in parallel with concurrency limit
    const CONCURRENCY = 3; // Process 3 patients at a time

    for (let i = 0; i < patients.length; i += CONCURRENCY) {
        const batch = patients.slice(i, i + CONCURRENCY);

        const batchPromises = batch.map(async (patient) => {
            const patientId = patient.id;
            console.log(`[DocumentService] Processing documents for patient ${patientId}`);

            try {
                // Get recent documents for this patient
                const documents = await getRecentDocuments(patientId);

                // Filter to only PDFs if we have documents
                let pdfDocs = documents.filter(doc =>
                    doc.hasAttachment && doc.contentType === 'application/pdf'
                );

                // Filter by type if specified
                if (documentTypes && documentTypes.length > 0) {
                    pdfDocs = pdfDocs.filter(doc => documentTypes.includes(doc.type));
                }

                // Limit number of docs to process
                const docsToProcess = pdfDocs.slice(0, maxDocsPerPatient);

                console.log(`[DocumentService] Patient ${patientId}: ${documents.length} docs, ${pdfDocs.length} PDFs, processing ${docsToProcess.length}`);

                // Extract and summarize each document
                const documentSummaries = [];

                for (const doc of docsToProcess) {
                    try {
                        const result = await extractAndSummarizeDocument(doc.url, {
                            documentType: doc.type || 'clinical note'
                        });

                        if (result.success) {
                            documentSummaries.push({
                                documentId: doc.id,
                                documentType: doc.type,
                                documentDate: doc.date,
                                description: doc.description,
                                summary: result.summary,
                                pageCount: result.pageCount,
                                charCount: result.charCount,
                                usage: result.usage
                            });
                        } else {
                            documentSummaries.push({
                                documentId: doc.id,
                                documentType: doc.type,
                                documentDate: doc.date,
                                description: doc.description,
                                error: result.error,
                                summary: null
                            });
                        }
                    } catch (docError) {
                        console.error(`[DocumentService] Error processing doc ${doc.id}:`, docError.message);
                        documentSummaries.push({
                            documentId: doc.id,
                            documentType: doc.type,
                            documentDate: doc.date,
                            error: docError.message,
                            summary: null
                        });
                    }
                }

                // Generate consolidated summary if requested and we have summaries
                let consolidatedSummary = null;
                if (includeConsolidated && documentSummaries.length > 0) {
                    const successfulSummaries = documentSummaries.filter(s => s.summary);

                    if (successfulSummaries.length > 1) {
                        // Use Azure OpenAI to consolidate multiple summaries
                        const docsForConsolidation = successfulSummaries.map(s => ({
                            text: s.summary,
                            type: s.documentType,
                            date: s.documentDate
                        }));

                        const consolidated = await azureOpenAI.summarizeMultipleDocuments(docsForConsolidation, {
                            patientContext: patient.fullName || `${patient.firstName} ${patient.lastName}`
                        });

                        if (consolidated.success) {
                            consolidatedSummary = {
                                summary: consolidated.summary,
                                documentCount: consolidated.documentCount,
                                usage: consolidated.usage
                            };
                        }
                    } else if (successfulSummaries.length === 1) {
                        // Only one doc, use its summary as the consolidated view
                        consolidatedSummary = {
                            summary: successfulSummaries[0].summary,
                            documentCount: 1,
                            usage: null
                        };
                    }
                }

                results[patientId] = {
                    success: true,
                    totalDocuments: documents.length,
                    processedCount: docsToProcess.length,
                    documents: documentSummaries,
                    consolidated: consolidatedSummary
                };

            } catch (patientError) {
                console.error(`[DocumentService] Error processing patient ${patientId}:`, patientError.message);
                results[patientId] = {
                    success: false,
                    error: patientError.message,
                    documents: [],
                    consolidated: null
                };
            }
        });

        await Promise.all(batchPromises);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[DocumentService] Batch processing complete in ${elapsed}s for ${patients.length} patients`);

    return results;
}

module.exports = {
    getPatientDocuments,
    getDocumentsByType,
    getRecentDocuments,
    getDownloadableDocuments,
    getDocumentTypes,
    extractDocumentText,
    extractAndSummarizeDocument,
    summarizePatientDocuments,
    batchFetchAndSummarizeDocuments
};
