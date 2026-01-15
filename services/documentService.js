/**
 * Document Service for HCHB FHIR API
 * Fetches clinical documents and attachments for patients
 */

const { fhirGet, getAccessToken } = require('./fhirClient');
const { client: pythonBackend } = require('./pythonBackendClient');

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
            url: attachmentUrl,
            token: token
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

module.exports = {
    getPatientDocuments,
    getDocumentsByType,
    getRecentDocuments,
    getDownloadableDocuments,
    getDocumentTypes,
    extractDocumentText
};
