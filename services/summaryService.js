/**
 * Summary Service
 * Generates episode summaries for recertification visits.
 * TODO: Integrate with Azure OpenAI for AI-powered summaries.
 */

// TODO: Replace with Azure OpenAI call
// const { OpenAIClient, AzureKeyCredential } = require("@azure/openai");
// const client = new OpenAIClient(
//     process.env.AZURE_OPENAI_ENDPOINT,
//     new AzureKeyCredential(process.env.AZURE_OPENAI_KEY)
// );

const patientService = require('./patientService');

/**
 * Calculate days between two dates
 * @param {string} startDate - Start date string
 * @param {string} endDate - End date string
 * @returns {number} Number of days
 */
function daysBetween(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Format date for display
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @returns {string} Formatted date string
 */
function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Generate a comprehensive summary for a patient's episode
 * @param {string} patientId - The patient ID to generate summary for
 * @returns {Promise<Object|null>} Summary object or null if patient not found
 */
async function generateSummary(patientId) {
    // TODO: Replace with Azure OpenAI call
    // const episode = await patientService.getPatientEpisode(patientId);
    // const prompt = buildSummaryPrompt(episode);
    // const response = await client.getCompletions(
    //     process.env.AZURE_OPENAI_DEPLOYMENT,
    //     [prompt],
    //     { maxTokens: 1000 }
    // );
    // return parseSummaryResponse(response);

    const episode = await patientService.getPatientEpisode(patientId);

    if (!episode) {
        return null;
    }

    const today = new Date();
    const episodeStart = new Date(episode.episodeStart);
    const episodeEnd = new Date(episode.episodeEnd);
    const daysInEpisode = daysBetween(episode.episodeStart, today.toISOString().split('T')[0]);
    const daysRemaining = daysBetween(today.toISOString().split('T')[0], episode.episodeEnd);

    // Build timeline from recent visits
    const timeline = episode.recentVisits.map(visit => ({
        date: formatDate(visit.date),
        event: `${visit.type} Visit`,
        details: visit.summary
    }));

    // Calculate goal statistics
    const goalStats = {
        met: episode.goals.filter(g => g.status === 'Met').length,
        inProgress: episode.goals.filter(g => g.status === 'In Progress').length,
        notMet: episode.goals.filter(g => g.status === 'Not Met').length
    };

    // Generate recert priorities based on patient data
    const recertPriorities = generateRecertPriorities(episode);

    return {
        patientSnapshot: {
            id: episode.patientId,
            name: episode.patientName,
            dob: formatDate(episode.dob),
            primaryDiagnosis: episode.primaryDiagnosis,
            secondaryDiagnoses: episode.secondaryDiagnoses,
            medicationCount: episode.medications.length
        },
        episodeInfo: {
            startDate: formatDate(episode.episodeStart),
            endDate: formatDate(episode.episodeEnd),
            daysInEpisode: daysInEpisode,
            daysRemaining: daysRemaining > 0 ? daysRemaining : 0,
            lastVisitDate: episode.recentVisits.length > 0
                ? formatDate(episode.recentVisits[0].date)
                : 'No visits recorded'
        },
        clinicalAlerts: episode.alerts,
        timeline: timeline,
        goals: episode.goals.map(goal => ({
            goal: goal.goal,
            status: goal.status,
            notes: goal.notes,
            statusColor: goal.status === 'Met' ? 'good'
                       : goal.status === 'Not Met' ? 'attention'
                       : 'warning'
        })),
        goalStats: goalStats,
        medications: episode.medications,
        recertPriorities: recertPriorities
    };
}

/**
 * Generate recertification priorities based on patient data
 * @param {Object} episode - The episode data
 * @returns {Array<string>} Array of priority items for recert
 */
function generateRecertPriorities(episode) {
    const priorities = [];

    // Check for unmet goals
    const unmetGoals = episode.goals.filter(g => g.status === 'Not Met');
    if (unmetGoals.length > 0) {
        priorities.push(`Address ${unmetGoals.length} unmet goal(s) - consider revising or continuing`);
    }

    // Check for alerts
    if (episode.alerts.length > 0) {
        priorities.push(`Review ${episode.alerts.length} active clinical alert(s)`);
    }

    // Check medication count
    if (episode.medications.length >= 5) {
        priorities.push(`Med reconciliation needed - patient on ${episode.medications.length} medications`);
    }

    // Check for in-progress goals
    const inProgressGoals = episode.goals.filter(g => g.status === 'In Progress');
    if (inProgressGoals.length > 0) {
        priorities.push(`Update progress on ${inProgressGoals.length} ongoing goal(s)`);
    }

    // Add standard recert items
    priorities.push('Verify homebound status');
    priorities.push('Assess continued skilled need');
    priorities.push('Update OASIS assessment');

    return priorities;
}

/**
 * Get a brief summary for display in search results
 * @param {string} patientId - The patient ID
 * @returns {Promise<Object|null>} Brief summary object
 */
async function getBriefSummary(patientId) {
    const episode = await patientService.getPatientEpisode(patientId);

    if (!episode) {
        return null;
    }

    return {
        patientName: episode.patientName,
        primaryDiagnosis: episode.primaryDiagnosis,
        episodeDates: `${formatDate(episode.episodeStart)} - ${formatDate(episode.episodeEnd)}`,
        alertCount: episode.alerts.length,
        hasAlerts: episode.alerts.length > 0
    };
}

module.exports = {
    generateSummary,
    getBriefSummary,
    formatDate
};
