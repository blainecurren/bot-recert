/**
 * Card Builder
 * Dynamically constructs Adaptive Cards from templates and data.
 */

const welcomeCard = require('./welcomeCard.json');

/**
 * Get the welcome/login card
 * @returns {Object} Welcome card JSON
 */
function getWelcomeCard() {
    return JSON.parse(JSON.stringify(welcomeCard));
}

/**
 * Build the date selection card after worker validation
 * @param {Object} worker - Validated worker object
 * @returns {Object} Date selection card JSON
 */
function buildDateSelectionCard(worker) {
    // Get today's date in YYYY-MM-DD format for the date picker
    const today = new Date().toISOString().split('T')[0];

    return {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.5",
        "body": [
            {
                "type": "Container",
                "style": "emphasis",
                "items": [
                    {
                        "type": "TextBlock",
                        "text": "Select Date",
                        "size": "Large",
                        "weight": "Bolder",
                        "color": "Accent"
                    },
                    {
                        "type": "TextBlock",
                        "text": `Welcome, ${worker.name}`,
                        "size": "Small",
                        "isSubtle": true,
                        "spacing": "None"
                    }
                ],
                "bleed": true
            },
            {
                "type": "TextBlock",
                "text": "Select a date to view your scheduled patients for that day.",
                "wrap": true,
                "spacing": "Medium"
            },
            {
                "type": "Container",
                "spacing": "Large",
                "items": [
                    {
                        "type": "TextBlock",
                        "text": "Visit Date",
                        "weight": "Bolder",
                        "spacing": "Small"
                    },
                    {
                        "type": "Input.Date",
                        "id": "selectedDate",
                        "value": today,
                        "placeholder": "Select a date"
                    }
                ]
            }
        ],
        "actions": [
            {
                "type": "Action.Submit",
                "title": "Load My Patients",
                "style": "positive",
                "data": {
                    "action": "loadPatientsByDate",
                    "workerId": worker.id
                }
            },
            {
                "type": "Action.Submit",
                "title": "Change Worker",
                "data": { "action": "newSearch" }
            }
        ]
    };
}

/**
 * Build the patient selection card for a specific date (single-select)
 * @param {Object} worker - Worker info object
 * @param {Array} patients - Array of scheduled patient objects
 * @param {string} selectedDate - The selected date string
 * @returns {Object} Patient selection card JSON
 */
function buildPatientSelectionCard(worker, patients, selectedDate) {
    const formattedDate = formatDisplayDate(selectedDate);

    const card = {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.5",
        "body": [
            {
                "type": "Container",
                "style": "emphasis",
                "items": [
                    {
                        "type": "TextBlock",
                        "text": "Your Patients",
                        "size": "Large",
                        "weight": "Bolder",
                        "color": "Accent"
                    },
                    {
                        "type": "TextBlock",
                        "text": `${worker.name} - ${formattedDate}`,
                        "size": "Small",
                        "isSubtle": true,
                        "spacing": "None"
                    }
                ],
                "bleed": true
            },
            {
                "type": "TextBlock",
                "text": patients.length > 0
                    ? `You have ${patients.length} patient(s) scheduled. Select a patient to view their data:`
                    : "No patients scheduled for this date.",
                "wrap": true,
                "spacing": "Medium"
            }
        ],
        "actions": []
    };


    if (patients.length === 0) {
        card.actions = [
            {
                "type": "Action.Submit",
                "title": "Select Different Date",
                "data": { "action": "backToDateSelection" }
            },
            {
                "type": "Action.Submit",
                "title": "Change Worker",
                "data": { "action": "newSearch" }
            }
        ];
    } else {
        // Add each patient as a selectable item
        patients.forEach((patient) => {
            const patientContainer = {
                "type": "Container",
                "style": "default",
                "spacing": "Medium",
                "selectAction": {
                    "type": "Action.Submit",
                    "data": {
                        "action": "selectPatient",
                        "patientId": patient.id,
                        "patientName": `${patient.lastName}, ${patient.firstName}`
                    }
                },
                "items": [
                    {
                        "type": "ColumnSet",
                        "columns": [
                            {
                                "type": "Column",
                                "width": "stretch",
                                "items": [
                                    {
                                        "type": "TextBlock",
                                        "text": `${patient.lastName}, ${patient.firstName}`,
                                        "weight": "Bolder",
                                        "wrap": true
                                    },
                                    {
                                        "type": "TextBlock",
                                        "text": `MRN: ${patient.mrn}`,
                                        "size": "Small",
                                        "isSubtle": true,
                                        "spacing": "None"
                                    }
                                ]
                            },
                            {
                                "type": "Column",
                                "width": "auto",
                                "verticalContentAlignment": "Center",
                                "items": [
                                    {
                                        "type": "TextBlock",
                                        "text": patient.visitTime,
                                        "weight": "Bolder",
                                        "size": "Small"
                                    },
                                    {
                                        "type": "TextBlock",
                                        "text": patient.visitType,
                                        "size": "Small",
                                        "isSubtle": true,
                                        "spacing": "None"
                                    }
                                ]
                            },
                            {
                                "type": "Column",
                                "width": "auto",
                                "verticalContentAlignment": "Center",
                                "items": [
                                    {
                                        "type": "ActionSet",
                                        "actions": [
                                            {
                                                "type": "Action.Submit",
                                                "title": "Select",
                                                "style": "positive",
                                                "data": {
                                                    "action": "selectPatient",
                                                    "patientId": patient.id,
                                                    "patientName": `${patient.lastName}, ${patient.firstName}`
                                                }
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };
            card.body.push(patientContainer);
        });

        // Navigation buttons
        card.actions = [
            {
                "type": "Action.Submit",
                "title": "Select Different Date",
                "data": { "action": "backToDateSelection" }
            },
            {
                "type": "Action.Submit",
                "title": "Change Worker",
                "data": { "action": "newSearch" }
            }
        ];
    }

    return card;
}

/**
 * FHIR Resource categories and options for the selection card
 */
const RESOURCE_CATEGORIES = [
    {
        name: "Patient Info",
        resources: [
            { id: "Patient", label: "Patient Demographics" },
            { id: "RelatedPerson", label: "Episode Contact" }
        ]
    },
    {
        name: "Allergies",
        resources: [
            { id: "AllergyIntolerance", label: "Allergy Intolerance" }
        ]
    },
    {
        name: "Appointments",
        resources: [
            { id: "Appointment-Visit", label: "Patient Visit" },
            { id: "Appointment-Schedule", label: "Schedule" },
            { id: "Appointment-IDG", label: "IDG Meeting" }
        ]
    },
    {
        name: "Vitals",
        resources: [
            { id: "Observation-Temperature", label: "Body Temperature" },
            { id: "Observation-BloodPressure", label: "Blood Pressure" },
            { id: "Observation-BodyMass", label: "Body Mass" },
            { id: "Observation-BodyWeight", label: "Body Weight" },
            { id: "Observation-HeadCircumference", label: "Head Circumference" },
            { id: "Observation-HeartRate", label: "Heart Rate" },
            { id: "Observation-OxygenSaturation", label: "Oxygen Saturation" },
            { id: "Observation-RespiratoryRate", label: "Respiratory Rate" }
        ]
    },
    {
        name: "Care Plans",
        resources: [
            { id: "CarePlan-AideHomecare", label: "Aide Homecare Plan" },
            { id: "CarePlan-PersonalCare", label: "Personal Care Plan" },
            { id: "CareTeam", label: "Care Team" }
        ]
    },
    {
        name: "Conditions",
        resources: [
            { id: "Condition-Diagnoses", label: "Diagnoses" },
            { id: "Condition-Wound", label: "Wound" }
        ]
    },
    {
        name: "Documents",
        resources: [
            { id: "DocumentReference-CoordinationNote", label: "Coordination Note" },
            { id: "DocumentReference-EpisodeDocument", label: "Episode Document" },
            { id: "DocumentReference-IDGMeetingNote", label: "IDG Meeting Note" },
            { id: "DocumentReference-PatientDocument", label: "Patient Document" },
            { id: "DocumentReference-PatientSignature", label: "Patient Signature" },
            { id: "DocumentReference-TherapyGoalsStatus", label: "Therapy Goals Status" },
            { id: "DocumentReference-VisitDocument", label: "Visit Document" }
        ]
    },
    {
        name: "Episodes & Encounters",
        resources: [
            { id: "EpisodeOfCare", label: "Episode of Care" },
            { id: "Encounter", label: "Encounter" }
        ]
    },
    {
        name: "Observations",
        resources: [
            { id: "Observation-LivingArrangement", label: "Living Arrangement" },
            { id: "Observation-WoundAssessment", label: "Wound Assessment" },
            { id: "Observation-WoundAssessmentDetails", label: "Wound Assessment Details" }
        ]
    },
    {
        name: "Medications",
        resources: [
            { id: "MedicationRequest", label: "Medication Request" }
        ]
    },
    {
        name: "Organizations",
        resources: [
            { id: "Organization-Agency", label: "Agency" },
            { id: "Organization-Branch", label: "Branch" },
            { id: "Organization-Team", label: "Team" },
            { id: "Organization-PayorSource", label: "Payor Source" }
        ]
    },
    {
        name: "Practitioners",
        resources: [
            { id: "Practitioner-Physician", label: "Physician" },
            { id: "Practitioner-Worker", label: "Worker" }
        ]
    },
    {
        name: "Locations",
        resources: [
            { id: "Location-ServiceLocation", label: "Service Location" },
            { id: "Location-WorkerLocation", label: "Worker Location" }
        ]
    },
    {
        name: "Referrals & Billing",
        resources: [
            { id: "ServiceRequest-ReferralOrder", label: "Referral Order" },
            { id: "Account", label: "Account" }
        ]
    }
];

/**
 * Build the FHIR resource selection card
 * @param {Object} patient - Selected patient object
 * @param {Object} worker - Worker info object
 * @returns {Object} Resource selection card JSON
 */
function buildResourceSelectionCard(patient, worker) {
    const card = {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.5",
        "body": [
            {
                "type": "Container",
                "style": "emphasis",
                "items": [
                    {
                        "type": "TextBlock",
                        "text": "Select Data to Retrieve",
                        "size": "Large",
                        "weight": "Bolder",
                        "color": "Accent"
                    },
                    {
                        "type": "TextBlock",
                        "text": `Patient: ${patient.name || patient.fullName || `${patient.lastName}, ${patient.firstName}`}`,
                        "size": "Small",
                        "spacing": "None",
                        "color": "Accent"
                    }
                ],
                "bleed": true
            },
            {
                "type": "TextBlock",
                "text": "Select the data types you want to retrieve from HCHB:",
                "wrap": true,
                "spacing": "Medium"
            }
        ],
        "actions": []
    };

    // Add each category as a collapsible section with toggles
    RESOURCE_CATEGORIES.forEach((category, catIndex) => {
        const categoryId = category.name.replace(/\s+/g, '-').toLowerCase();

        // Build toggles for this category
        const toggleItems = category.resources.map(resource => ({
            "type": "ColumnSet",
            "columns": [
                {
                    "type": "Column",
                    "width": "auto",
                    "items": [
                        {
                            "type": "Input.Toggle",
                            "id": `resource_${resource.id}`,
                            "title": "",
                            "value": "false",
                            "valueOn": "true",
                            "valueOff": "false"
                        }
                    ]
                },
                {
                    "type": "Column",
                    "width": "stretch",
                    "verticalContentAlignment": "Center",
                    "items": [
                        {
                            "type": "TextBlock",
                            "text": resource.label,
                            "color": "Accent"
                        }
                    ]
                }
            ]
        }));

        // Clickable header that toggles visibility
        card.body.push({
            "type": "Container",
            "spacing": catIndex === 0 ? "Medium" : "Small",
            "style": "emphasis",
            "selectAction": {
                "type": "Action.ToggleVisibility",
                "targetElements": [`${categoryId}-content`]
            },
            "items": [
                {
                    "type": "ColumnSet",
                    "columns": [
                        {
                            "type": "Column",
                            "width": "auto",
                            "items": [
                                {
                                    "type": "TextBlock",
                                    "text": "▶",
                                    "color": "Accent",
                                    "size": "Small"
                                }
                            ]
                        },
                        {
                            "type": "Column",
                            "width": "stretch",
                            "items": [
                                {
                                    "type": "TextBlock",
                                    "text": `${category.name} (${category.resources.length})`,
                                    "weight": "Bolder",
                                    "color": "Accent"
                                }
                            ]
                        }
                    ]
                }
            ]
        });

        // Hidden content container with toggles
        card.body.push({
            "type": "Container",
            "id": `${categoryId}-content`,
            "isVisible": false,
            "spacing": "None",
            "items": toggleItems
        });
    });

    // Quick select options
    card.body.push({
        "type": "Container",
        "spacing": "Medium",
        "separator": true,
        "items": [
            {
                "type": "TextBlock",
                "text": "Quick Select:",
                "weight": "Bolder",
                "size": "Small"
            },
            {
                "type": "ColumnSet",
                "columns": [
                    {
                        "type": "Column",
                        "width": "auto",
                        "items": [
                            {
                                "type": "Input.Toggle",
                                "id": "quickSelect_clinical",
                                "title": "",
                                "value": "false",
                                "valueOn": "true",
                                "valueOff": "false"
                            }
                        ]
                    },
                    {
                        "type": "Column",
                        "width": "auto",
                        "verticalContentAlignment": "Center",
                        "items": [
                            {
                                "type": "TextBlock",
                                "text": "Clinical Summary",
                                "color": "Accent"
                            }
                        ]
                    },
                    {
                        "type": "Column",
                        "width": "auto",
                        "items": [
                            {
                                "type": "Input.Toggle",
                                "id": "quickSelect_vitals",
                                "title": "",
                                "value": "false",
                                "valueOn": "true",
                                "valueOff": "false"
                            }
                        ]
                    },
                    {
                        "type": "Column",
                        "width": "auto",
                        "verticalContentAlignment": "Center",
                        "items": [
                            {
                                "type": "TextBlock",
                                "text": "All Vitals",
                                "color": "Accent"
                            }
                        ]
                    },
                    {
                        "type": "Column",
                        "width": "auto",
                        "items": [
                            {
                                "type": "Input.Toggle",
                                "id": "quickSelect_documents",
                                "title": "",
                                "value": "false",
                                "valueOn": "true",
                                "valueOff": "false"
                            }
                        ]
                    },
                    {
                        "type": "Column",
                        "width": "auto",
                        "verticalContentAlignment": "Center",
                        "items": [
                            {
                                "type": "TextBlock",
                                "text": "All Documents",
                                "color": "Accent"
                            }
                        ]
                    }
                ]
            }
        ]
    });

    // Action buttons
    card.actions = [
        {
            "type": "Action.Submit",
            "title": "Fetch Selected Data",
            "style": "positive",
            "data": {
                "action": "fetchResources",
                "patientId": patient.id,
                "patientName": patient.name || patient.fullName || `${patient.lastName}, ${patient.firstName}`,
                "workerId": worker.id
            }
        },
        {
            "type": "Action.Submit",
            "title": "Back to Patients",
            "data": { "action": "backToPatients" }
        }
    ];

    return card;
}

/**
 * Build the recert patient selection card with toggle inputs (legacy)
 * @param {Object} worker - Worker info object
 * @param {Array} patients - Array of patient objects with recert info
 * @returns {Object} Patient selection card JSON
 */
function buildRecertPatientListCard(worker, patients) {
    const card = {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.5",
        "body": [
            {
                "type": "Container",
                "style": "emphasis",
                "items": [
                    {
                        "type": "TextBlock",
                        "text": "Your Recert Patients",
                        "size": "Large",
                        "weight": "Bolder",
                        "color": "Accent"
                    },
                    {
                        "type": "TextBlock",
                        "text": `Welcome, ${worker.name}`,
                        "size": "Small",
                        "isSubtle": true,
                        "spacing": "None"
                    }
                ],
                "bleed": true
            },
            {
                "type": "TextBlock",
                "text": `You have ${patients.length} patient(s) with upcoming recertifications. Select the patients you want summaries for:`,
                "wrap": true,
                "spacing": "Medium"
            }
        ],
        "actions": []
    };

    if (patients.length === 0) {
        card.body.push({
            "type": "Container",
            "style": "good",
            "spacing": "Medium",
            "items": [
                {
                    "type": "TextBlock",
                    "text": "No upcoming recertifications found.",
                    "wrap": true
                }
            ]
        });
        card.actions.push({
            "type": "Action.Submit",
            "title": "Refresh",
            "data": { "action": "loadPatients", "workerId": worker.id }
        });
    } else {
        // Add each patient as a selectable toggle
        patients.forEach((patient, index) => {
            const daysUntilRecert = getDaysUntil(patient.recertDue);
            const urgencyStyle = daysUntilRecert <= 7 ? "attention" : daysUntilRecert <= 14 ? "warning" : "default";

            const patientContainer = {
                "type": "Container",
                "style": urgencyStyle,
                "spacing": "Medium",
                "items": [
                    {
                        "type": "ColumnSet",
                        "columns": [
                            {
                                "type": "Column",
                                "width": "auto",
                                "verticalContentAlignment": "Center",
                                "items": [
                                    {
                                        "type": "Input.Toggle",
                                        "id": `patient_${patient.id}`,
                                        "title": "",
                                        "value": "false",
                                        "valueOn": "true",
                                        "valueOff": "false"
                                    }
                                ]
                            },
                            {
                                "type": "Column",
                                "width": "stretch",
                                "items": [
                                    {
                                        "type": "TextBlock",
                                        "text": `${patient.lastName}, ${patient.firstName}`,
                                        "weight": "Bolder",
                                        "wrap": true
                                    },
                                    {
                                        "type": "TextBlock",
                                        "text": patient.primaryDiagnosis,
                                        "size": "Small",
                                        "wrap": true,
                                        "spacing": "None"
                                    },
                                    {
                                        "type": "ColumnSet",
                                        "spacing": "Small",
                                        "columns": [
                                            {
                                                "type": "Column",
                                                "width": "auto",
                                                "items": [
                                                    {
                                                        "type": "TextBlock",
                                                        "text": `Recert Due: ${formatDisplayDate(patient.recertDue)}`,
                                                        "size": "Small",
                                                        "isSubtle": true
                                                    }
                                                ]
                                            },
                                            {
                                                "type": "Column",
                                                "width": "auto",
                                                "items": [
                                                    {
                                                        "type": "TextBlock",
                                                        "text": daysUntilRecert <= 0 ? "OVERDUE" : `${daysUntilRecert} days`,
                                                        "size": "Small",
                                                        "weight": "Bolder",
                                                        "color": daysUntilRecert <= 7 ? "Attention" : daysUntilRecert <= 14 ? "Warning" : "Good"
                                                    }
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            },
                            {
                                "type": "Column",
                                "width": "auto",
                                "verticalContentAlignment": "Center",
                                "items": [
                                    {
                                        "type": "TextBlock",
                                        "text": patient.alertCount > 0 ? `${patient.alertCount} alerts` : "",
                                        "size": "Small",
                                        "color": "Attention",
                                        "weight": "Bolder"
                                    },
                                    {
                                        "type": "TextBlock",
                                        "text": `${patient.attachmentCount} docs`,
                                        "size": "Small",
                                        "isSubtle": true,
                                        "spacing": "None"
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };
            card.body.push(patientContainer);
        });

        // Add select all toggle
        card.body.push({
            "type": "Container",
            "spacing": "Medium",
            "items": [
                {
                    "type": "Input.Toggle",
                    "id": "selectAll",
                    "title": "Select All Patients",
                    "value": "false",
                    "valueOn": "true",
                    "valueOff": "false"
                }
            ]
        });

        // Add action buttons
        card.actions = [
            {
                "type": "Action.Submit",
                "title": "Generate Summaries",
                "style": "positive",
                "data": {
                    "action": "generateSummaries",
                    "workerId": worker.id,
                    "patientIds": patients.map(p => p.id)
                }
            },
            {
                "type": "Action.Submit",
                "title": "Change Worker",
                "data": { "action": "newSearch" }
            }
        ];
    }

    return card;
}

/**
 * Build a processing/status card
 * @param {number} patientCount - Number of patients being processed
 * @param {string} workerId - Worker ID for refresh
 * @returns {Object} Processing card JSON
 */
function buildProcessingCard(patientCount, workerId) {
    return {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.5",
        "body": [
            {
                "type": "Container",
                "style": "emphasis",
                "items": [
                    {
                        "type": "TextBlock",
                        "text": "Generating Summaries",
                        "size": "Large",
                        "weight": "Bolder",
                        "color": "Accent"
                    }
                ],
                "bleed": true
            },
            {
                "type": "Container",
                "spacing": "Large",
                "horizontalAlignment": "Center",
                "items": [
                    {
                        "type": "TextBlock",
                        "text": `Analyzing ${patientCount} patient(s)...`,
                        "size": "Medium",
                        "horizontalAlignment": "Center"
                    },
                    {
                        "type": "TextBlock",
                        "text": "This may take a minute. We're:",
                        "spacing": "Medium",
                        "wrap": true
                    },
                    {
                        "type": "TextBlock",
                        "text": "1. Fetching clinical documents",
                        "spacing": "Small",
                        "isSubtle": true
                    },
                    {
                        "type": "TextBlock",
                        "text": "2. Analyzing visit notes and assessments",
                        "spacing": "None",
                        "isSubtle": true
                    },
                    {
                        "type": "TextBlock",
                        "text": "3. Generating AI-powered summaries",
                        "spacing": "None",
                        "isSubtle": true
                    }
                ]
            },
            {
                "type": "TextBlock",
                "text": "Summaries will appear below when ready.",
                "spacing": "Large",
                "isSubtle": true,
                "horizontalAlignment": "Center"
            }
        ]
    };
}

/**
 * Build a patient list card from search results (legacy - kept for compatibility)
 * @param {string} searchTerm - The search term used
 * @param {Array} patients - Array of patient objects
 * @returns {Object} Patient list card JSON
 */
function buildPatientListCard(searchTerm, patients) {
    const card = {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.5",
        "body": [
            {
                "type": "Container",
                "style": "emphasis",
                "items": [
                    {
                        "type": "TextBlock",
                        "text": "Search Results",
                        "size": "Large",
                        "weight": "Bolder",
                        "color": "Accent"
                    }
                ],
                "bleed": true
            },
            {
                "type": "TextBlock",
                "text": `Found ${patients.length} patient(s) matching "${searchTerm}"`,
                "isSubtle": true,
                "spacing": "Small"
            }
        ],
        "actions": [
            {
                "type": "Action.Submit",
                "title": "New Search",
                "data": { "action": "newSearch" }
            }
        ]
    };

    if (patients.length === 0) {
        card.body.push({
            "type": "Container",
            "style": "warning",
            "spacing": "Medium",
            "items": [
                {
                    "type": "TextBlock",
                    "text": "No patients found. Try a different search term.",
                    "wrap": true
                }
            ]
        });
    } else {
        patients.forEach(patient => {
            const patientContainer = {
                "type": "Container",
                "style": "default",
                "spacing": "Medium",
                "selectAction": {
                    "type": "Action.Submit",
                    "data": {
                        "action": "selectPatient",
                        "patientId": patient.id
                    }
                },
                "items": [
                    {
                        "type": "ColumnSet",
                        "columns": [
                            {
                                "type": "Column",
                                "width": "stretch",
                                "items": [
                                    {
                                        "type": "TextBlock",
                                        "text": `${patient.lastName}, ${patient.firstName}`,
                                        "weight": "Bolder",
                                        "wrap": true
                                    },
                                    {
                                        "type": "TextBlock",
                                        "text": `DOB: ${formatDisplayDate(patient.dob)}`,
                                        "size": "Small",
                                        "isSubtle": true,
                                        "spacing": "None"
                                    },
                                    {
                                        "type": "TextBlock",
                                        "text": patient.primaryDiagnosis,
                                        "size": "Small",
                                        "wrap": true,
                                        "spacing": "None"
                                    }
                                ]
                            },
                            {
                                "type": "Column",
                                "width": "auto",
                                "verticalContentAlignment": "Center",
                                "items": [
                                    {
                                        "type": "ActionSet",
                                        "actions": [
                                            {
                                                "type": "Action.Submit",
                                                "title": "View",
                                                "style": "positive",
                                                "data": {
                                                    "action": "selectPatient",
                                                    "patientId": patient.id
                                                }
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };
            card.body.push(patientContainer);
        });
    }

    return card;
}

/**
 * Build an episode summary card from summary data
 * @param {Object} summary - Summary object from summaryService
 * @returns {Object} Summary card JSON
 */
function buildSummaryCard(summary) {
    const card = {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.5",
        "body": [
            {
                "type": "Container",
                "style": "emphasis",
                "items": [
                    {
                        "type": "TextBlock",
                        "text": summary.patientSnapshot.name,
                        "size": "Large",
                        "weight": "Bolder",
                        "color": "Accent"
                    },
                    {
                        "type": "TextBlock",
                        "text": `Episode: ${summary.episodeInfo.startDate} - ${summary.episodeInfo.endDate}`,
                        "size": "Small",
                        "isSubtle": true,
                        "spacing": "None"
                    }
                ],
                "bleed": true
            },
            {
                "type": "FactSet",
                "facts": [
                    { "title": "DOB", "value": summary.patientSnapshot.dob },
                    { "title": "Primary Dx", "value": summary.patientSnapshot.primaryDiagnosis },
                    { "title": "Medications", "value": String(summary.patientSnapshot.medicationCount) },
                    { "title": "Last Visit", "value": summary.episodeInfo.lastVisitDate },
                    { "title": "Days in Episode", "value": String(summary.episodeInfo.daysInEpisode) },
                    { "title": "Days Remaining", "value": String(summary.episodeInfo.daysRemaining) }
                ],
                "spacing": "Medium"
            }
        ],
        "actions": [
            {
                "type": "Action.Submit",
                "title": "Back to Patients",
                "data": { "action": "backToPatients" }
            },
            {
                "type": "Action.OpenUrl",
                "title": "Open in HCHB",
                "url": `https://hchb.com/patient/${summary.patientSnapshot.id}`
            }
        ]
    };

    // Add Clinical Alerts section if there are alerts
    if (summary.clinicalAlerts && summary.clinicalAlerts.length > 0) {
        const alertItems = summary.clinicalAlerts.map(alert => ({
            "type": "TextBlock",
            "text": `- ${alert}`,
            "color": "Attention",
            "wrap": true,
            "spacing": "None"
        }));

        card.body.push({
            "type": "Container",
            "style": "attention",
            "spacing": "Medium",
            "items": [
                {
                    "type": "TextBlock",
                    "text": "Clinical Alerts",
                    "weight": "Bolder",
                    "color": "Attention"
                },
                ...alertItems
            ]
        });
    }

    // Add Recert Priorities section
    if (summary.recertPriorities && summary.recertPriorities.length > 0) {
        const priorityItems = summary.recertPriorities.map((priority, index) => ({
            "type": "TextBlock",
            "text": `${index + 1}. ${priority}`,
            "wrap": true,
            "spacing": "None"
        }));

        card.body.push({
            "type": "Container",
            "spacing": "Medium",
            "items": [
                {
                    "type": "TextBlock",
                    "text": "Recert Priorities",
                    "weight": "Bolder"
                },
                ...priorityItems
            ]
        });
    }

    // Add expandable sections
    const expandableActions = [];

    // Timeline section
    if (summary.timeline && summary.timeline.length > 0) {
        const timelineItems = summary.timeline.map(event => ({
            "type": "Container",
            "spacing": "Small",
            "items": [
                {
                    "type": "TextBlock",
                    "text": `**${event.date}** - ${event.event}`,
                    "wrap": true
                },
                {
                    "type": "TextBlock",
                    "text": event.details,
                    "size": "Small",
                    "isSubtle": true,
                    "wrap": true,
                    "spacing": "None"
                }
            ]
        }));

        expandableActions.push({
            "type": "Action.ShowCard",
            "title": "View Timeline",
            "card": {
                "type": "AdaptiveCard",
                "body": timelineItems
            }
        });
    }

    // Goals section
    if (summary.goals && summary.goals.length > 0) {
        const goalItems = summary.goals.map(goal => {
            const statusColor = goal.status === 'Met' ? 'Good'
                             : goal.status === 'Not Met' ? 'Attention'
                             : 'Warning';

            return {
                "type": "Container",
                "spacing": "Small",
                "items": [
                    {
                        "type": "TextBlock",
                        "text": goal.goal,
                        "weight": "Bolder",
                        "wrap": true
                    },
                    {
                        "type": "TextBlock",
                        "text": `Status: ${goal.status}`,
                        "color": statusColor,
                        "size": "Small",
                        "spacing": "None"
                    },
                    {
                        "type": "TextBlock",
                        "text": goal.notes,
                        "size": "Small",
                        "isSubtle": true,
                        "wrap": true,
                        "spacing": "None"
                    }
                ]
            };
        });

        goalItems.unshift({
            "type": "TextBlock",
            "text": `Goals: ${summary.goalStats.met} Met | ${summary.goalStats.inProgress} In Progress | ${summary.goalStats.notMet} Not Met`,
            "size": "Small",
            "isSubtle": true
        });

        expandableActions.push({
            "type": "Action.ShowCard",
            "title": "View Goals",
            "card": {
                "type": "AdaptiveCard",
                "body": goalItems
            }
        });
    }

    // Medications section
    if (summary.medications && summary.medications.length > 0) {
        const medItems = summary.medications.map(med => ({
            "type": "TextBlock",
            "text": `- **${med.name}** ${med.dose} - ${med.frequency}`,
            "wrap": true,
            "spacing": "None"
        }));

        expandableActions.push({
            "type": "Action.ShowCard",
            "title": "View Medications",
            "card": {
                "type": "AdaptiveCard",
                "body": [
                    {
                        "type": "TextBlock",
                        "text": `Current Medications (${summary.medications.length})`,
                        "weight": "Bolder"
                    },
                    ...medItems
                ]
            }
        });
    }

    // Secondary Diagnoses
    if (summary.patientSnapshot.secondaryDiagnoses && summary.patientSnapshot.secondaryDiagnoses.length > 0) {
        const dxItems = summary.patientSnapshot.secondaryDiagnoses.map(dx => ({
            "type": "TextBlock",
            "text": `- ${dx}`,
            "wrap": true,
            "spacing": "None"
        }));

        expandableActions.push({
            "type": "Action.ShowCard",
            "title": "View Diagnoses",
            "card": {
                "type": "AdaptiveCard",
                "body": [
                    {
                        "type": "TextBlock",
                        "text": "Secondary Diagnoses",
                        "weight": "Bolder"
                    },
                    ...dxItems
                ]
            }
        });
    }

    if (expandableActions.length > 0) {
        card.body.push({
            "type": "ActionSet",
            "spacing": "Medium",
            "actions": expandableActions
        });
    }

    return card;
}

/**
 * Build an error card
 * @param {string} title - Error title
 * @param {string} message - Error message
 * @returns {Object} Error card JSON
 */
function buildErrorCard(title, message) {
    return {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.5",
        "body": [
            {
                "type": "Container",
                "style": "attention",
                "items": [
                    {
                        "type": "TextBlock",
                        "text": title,
                        "size": "Medium",
                        "weight": "Bolder",
                        "color": "Attention"
                    },
                    {
                        "type": "TextBlock",
                        "text": message,
                        "wrap": true,
                        "spacing": "Small"
                    }
                ]
            }
        ],
        "actions": [
            {
                "type": "Action.Submit",
                "title": "Try Again",
                "data": { "action": "newSearch" }
            }
        ]
    };
}

/**
 * Build the data results card showing fetched FHIR data
 * @param {Object} patient - Patient object
 * @param {Object} fetchResults - Results from dataFetchService
 * @param {Array} errors - Any errors that occurred
 * @returns {Object} Results card JSON
 */
function buildDataResultsCard(patient, fetchResults, errors = []) {
    const patientName = patient.name || patient.fullName || `${patient.lastName}, ${patient.firstName}`;

    const card = {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.5",
        "body": [
            {
                "type": "Container",
                "style": "emphasis",
                "items": [
                    {
                        "type": "TextBlock",
                        "text": "Patient Data Results",
                        "size": "Large",
                        "weight": "Bolder",
                        "color": "Accent"
                    },
                    {
                        "type": "TextBlock",
                        "text": `Patient: ${patientName}`,
                        "size": "Small",
                        "isSubtle": true,
                        "spacing": "None"
                    }
                ],
                "bleed": true
            }
        ],
        "actions": []
    };

    const resultKeys = Object.keys(fetchResults);

    if (resultKeys.length === 0 && errors.length === 0) {
        card.body.push({
            "type": "Container",
            "style": "warning",
            "spacing": "Medium",
            "items": [
                {
                    "type": "TextBlock",
                    "text": "No data types were selected. Please go back and select at least one data type.",
                    "wrap": true
                }
            ]
        });
    } else {
        // Add summary text
        card.body.push({
            "type": "TextBlock",
            "text": `Retrieved ${resultKeys.length} data type(s)${errors.length > 0 ? ` (${errors.length} error(s))` : ''}`,
            "wrap": true,
            "spacing": "Medium",
            "isSubtle": true
        });

        // Add each result as an expandable section
        const expandableActions = [];

        resultKeys.forEach(resourceId => {
            const result = fetchResults[resourceId];
            const label = result.label || resourceId;
            const needsAI = result.needsAISummary;

            let contentItems = [];

            // Check if this has a summary or formatted content
            if (result.summary) {
                // AI-generated summary
                contentItems.push({
                    "type": "TextBlock",
                    "text": result.summary,
                    "wrap": true
                });
            } else if (result.formatted) {
                // Formatted data
                contentItems.push({
                    "type": "TextBlock",
                    "text": result.formatted.formatted || result.formatted,
                    "wrap": true
                });
            } else if (result.data) {
                // Raw data - format it
                if (Array.isArray(result.data) && result.data.length === 0) {
                    contentItems.push({
                        "type": "TextBlock",
                        "text": "No data available",
                        "isSubtle": true
                    });
                } else if (result.data.placeholder) {
                    contentItems.push({
                        "type": "TextBlock",
                        "text": result.data.message || "Data fetch not yet implemented",
                        "isSubtle": true
                    });
                } else {
                    // Try to format the data nicely
                    const dataStr = typeof result.data === 'string'
                        ? result.data
                        : JSON.stringify(result.data, null, 2).substring(0, 1000);
                    contentItems.push({
                        "type": "TextBlock",
                        "text": dataStr,
                        "wrap": true,
                        "fontType": "Monospace",
                        "size": "Small"
                    });
                }
            } else {
                contentItems.push({
                    "type": "TextBlock",
                    "text": "No data available",
                    "isSubtle": true
                });
            }

            // Add badge for AI summary
            if (needsAI && result.summary) {
                contentItems.unshift({
                    "type": "TextBlock",
                    "text": "AI Summary",
                    "size": "Small",
                    "weight": "Bolder",
                    "color": "Accent"
                });
            }

            expandableActions.push({
                "type": "Action.ShowCard",
                "title": `${label}${needsAI ? ' *' : ''}`,
                "card": {
                    "type": "AdaptiveCard",
                    "body": contentItems
                }
            });
        });

        // Add expandable sections (max 6 per ActionSet due to Teams limits)
        for (let i = 0; i < expandableActions.length; i += 6) {
            const chunk = expandableActions.slice(i, i + 6);
            card.body.push({
                "type": "ActionSet",
                "spacing": "Small",
                "actions": chunk
            });
        }

        // Add errors if any
        if (errors.length > 0) {
            card.body.push({
                "type": "Container",
                "style": "attention",
                "spacing": "Medium",
                "items": [
                    {
                        "type": "TextBlock",
                        "text": "Errors:",
                        "weight": "Bolder",
                        "color": "Attention"
                    },
                    ...errors.map(err => ({
                        "type": "TextBlock",
                        "text": `- ${err.resourceId}: ${err.error}`,
                        "wrap": true,
                        "size": "Small"
                    }))
                ]
            });
        }

        // Add legend
        card.body.push({
            "type": "TextBlock",
            "text": "* AI summarized content",
            "size": "Small",
            "isSubtle": true,
            "spacing": "Medium"
        });
    }

    // Navigation actions
    card.actions = [
        {
            "type": "Action.Submit",
            "title": "Select More Data",
            "data": { "action": "backToResourceSelection" }
        },
        {
            "type": "Action.Submit",
            "title": "Back to Patients",
            "data": { "action": "backToPatients" }
        },
        {
            "type": "Action.Submit",
            "title": "New Search",
            "data": { "action": "newSearch" }
        }
    ];

    return card;
}

/**
 * Format date for display
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @returns {string} Formatted date
 */
function formatDisplayDate(dateStr) {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Calculate days until a date
 * @param {string} dateStr - Target date string
 * @returns {number} Days until date (negative if past)
 */
function getDaysUntil(dateStr) {
    const target = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    const diffTime = target - today;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

module.exports = {
    getWelcomeCard,
    buildDateSelectionCard,
    buildPatientSelectionCard,
    buildResourceSelectionCard,
    buildDataResultsCard,
    buildRecertPatientListCard,
    buildProcessingCard,
    buildPatientListCard,
    buildSummaryCard,
    buildErrorCard,
    RESOURCE_CATEGORIES
};
