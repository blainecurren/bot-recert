# Python Backend Documentation

This document describes the Python FastAPI backend that provides PDF text extraction and mock FHIR data for development.

## Table of Contents

1. [Overview](#overview)
2. [Setup](#setup)
3. [API Endpoints](#api-endpoints)
4. [PDF Text Extraction](#pdf-text-extraction)
5. [Vision OCR Fallback](#vision-ocr-fallback)
6. [Mock Data](#mock-data)

---

## Overview

The Python backend (`mock-backend/main.py`) serves two purposes:

1. **PDF Text Extraction** - Downloads PDFs from FHIR DocumentReference attachments and extracts text using pdfplumber, with GPT-4o Vision OCR fallback for scanned documents.

2. **Mock FHIR Endpoints** - Provides mock patient data for local development when the real HCHB FHIR API is unavailable.

### Technology Stack

```
FastAPI          - Web framework
uvicorn          - ASGI server
pdfplumber       - PDF text extraction
httpx            - Async HTTP client
PyMuPDF (fitz)   - PDF to image conversion
python-dotenv    - Environment configuration
openai           - Azure OpenAI SDK
```

---

## Setup

### Installation

```bash
cd mock-backend

# Create virtual environment (optional but recommended)
python -m venv venv
source venv/bin/activate  # Linux/Mac
# or
.\venv\Scripts\activate  # Windows

# Install dependencies
pip install fastapi uvicorn pdfplumber httpx python-dotenv PyMuPDF openai
```

### Running the Server

```bash
# Development with auto-reload
uvicorn main:app --reload --port 8000

# Production
uvicorn main:app --host 0.0.0.0 --port 8000
```

### Environment Variables

The backend reads from the parent directory's `.env` file:

```env
# Required for Vision OCR fallback
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_DEPLOYMENT=gpt-4o
```

---

## API Endpoints

### Health Check

```http
GET /api/v1/health
```

**Response:**
```json
{
    "status": "healthy",
    "timestamp": "2025-01-15T10:30:00.000Z"
}
```

---

### Worker Validation

```http
GET /api/v1/workers/{worker_id}/validate
```

**Parameters:**
- `worker_id` - Worker identifier string

**Response (found):**
```json
{
    "valid": true,
    "worker": {
        "id": "W001",
        "name": "Sarah Johnson",
        "role": "RN",
        "active": true
    },
    "message": "Worker validated"
}
```

**Response (not found):**
```json
{
    "valid": false,
    "worker": null,
    "message": "Worker W999 not found"
}
```

---

### Worker Patients

```http
GET /api/v1/workers/{worker_id}/patients?visit_date={date}
```

**Parameters:**
- `worker_id` - Worker identifier
- `visit_date` - Date in YYYY-MM-DD format (optional)

**Response:**
```json
{
    "data": [
        {
            "id": "P001",
            "firstName": "John",
            "lastName": "Smith",
            "fullName": "Smith, John",
            "dob": "1945-03-15",
            "mrn": "MRN001",
            "visitTime": "9:00 AM",
            "visitType": "SN11 (Skilled Nursing)",
            "visitTypeCode": "SN11",
            "status": "booked"
        }
    ],
    "count": 6
}
```

---

### Patient Data

```http
GET /api/v1/patients/{patient_id}
```

**Response:**
```json
{
    "id": "P001",
    "firstName": "John",
    "lastName": "Smith",
    "fullName": "Smith, John",
    "dob": "1945-03-15",
    "mrn": "MRN001"
}
```

---

### Clinical Data Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/patients/{id}/allergies` | Allergy intolerances |
| `GET /api/v1/patients/{id}/conditions` | Diagnoses/conditions |
| `GET /api/v1/patients/{id}/medications` | Active medications |
| `GET /api/v1/patients/{id}/episodes` | Episodes of care |
| `GET /api/v1/patients/{id}/encounters` | Visits/encounters |
| `GET /api/v1/patients/{id}/care-team` | Care team members |
| `GET /api/v1/patients/{id}/care-plans/{type}` | Care plans |
| `GET /api/v1/patients/{id}/documents/{type}` | Documents by type |

### Vitals Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/patients/{id}/vitals/blood-pressure` | Blood pressure readings |
| `GET /api/v1/patients/{id}/vitals/heart-rate` | Heart rate |
| `GET /api/v1/patients/{id}/vitals/temperature` | Body temperature |
| `GET /api/v1/patients/{id}/vitals/oxygen-saturation` | O2 saturation |
| `GET /api/v1/patients/{id}/vitals/body-weight` | Body weight |

---

## PDF Text Extraction

### Endpoint

```http
POST /api/v1/documents/extract-text
```

### Request Body

```json
{
    "url": "https://api.hchb.com/fhir/r4/Binary/123",
    "token": "Bearer eyJ..."
}
```

### Process Flow

```
1. Receive URL and FHIR token
          │
          ▼
2. Download PDF from FHIR API
   (using token for auth)
          │
          ▼
3. Validate size (max 10MB)
          │
          ▼
4. Extract text with pdfplumber
          │
          ▼
   ┌──────┴──────┐
   │             │
 Text         No Text
 Found        Found
   │             │
   ▼             ▼
Return      Try Vision OCR
text        (GPT-4o)
   │             │
   └──────┬──────┘
          │
          ▼
5. Return extracted text
   and metadata
```

### Response (Success)

```json
{
    "success": true,
    "text": "Patient Name: John Smith\nDate of Visit: 01/15/2025\n...",
    "page_count": 3,
    "char_count": 4523,
    "used_vision_ocr": false,
    "metadata": {
        "title": "Visit Note",
        "author": "Sarah Johnson, RN",
        "creator": "HCHB EMR",
        "creation_date": "D:20250115103000"
    }
}
```

### Response (Error)

```json
{
    "detail": "Timeout while fetching PDF"
}
```

### Error Codes

| Status | Description |
|--------|-------------|
| 401 | Token expired or invalid |
| 404 | Document not found at URL |
| 413 | PDF too large (>10MB) |
| 502 | Network error fetching PDF |
| 504 | Timeout fetching PDF |
| 500 | PDF processing error |

---

## Vision OCR Fallback

When pdfplumber extracts less than 50 characters from a PDF (indicating a scanned/image-based document), the backend falls back to GPT-4o Vision OCR.

### Process

```
1. PDF has no extractable text
          │
          ▼
2. Load PDF with PyMuPDF
          │
          ▼
3. Convert pages to PNG images
   (150 DPI, max 5 pages)
          │
          ▼
4. Send each image to GPT-4o Vision
          │
          ▼
5. Combine extracted text from
   all pages
          │
          ▼
6. Return combined text
```

### Code Implementation

```python
def extract_text_with_vision(pdf_bytes: bytes, page_count: int) -> str:
    # Open PDF with PyMuPDF
    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    max_pages = min(page_count, 5)  # Limit to 5 pages

    client = AzureOpenAI(
        azure_endpoint=AZURE_OPENAI_ENDPOINT,
        api_key=AZURE_OPENAI_API_KEY,
        api_version="2024-08-01-preview"
    )

    extracted_texts = []

    for i in range(max_pages):
        # Render page to image at 150 DPI
        page = pdf_doc[i]
        mat = fitz.Matrix(150/72, 150/72)
        pix = page.get_pixmap(matrix=mat)

        # Convert to base64 PNG
        img_bytes = pix.tobytes("png")
        img_base64 = base64.b64encode(img_bytes).decode("utf-8")

        # Send to GPT-4o Vision
        response = client.chat.completions.create(
            model=AZURE_OPENAI_DEPLOYMENT,
            messages=[
                {
                    "role": "system",
                    "content": "Extract ALL text from this medical document image exactly as written..."
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Extract all text from this medical document page:"},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{img_base64}",
                                "detail": "high"
                            }
                        }
                    ]
                }
            ],
            max_tokens=4000,
            temperature=0.1
        )

        page_text = response.choices[0].message.content
        if page_text:
            extracted_texts.append(f"--- Page {i + 1} ---\n{page_text}")

    return "\n\n".join(extracted_texts)
```

### System Prompt for OCR

```
You are an OCR assistant. Extract ALL text from this medical document image
exactly as written. Preserve formatting, line breaks, and structure. Include
all headers, dates, names, values, and notes. Do not summarize - extract the
complete text.
```

### Limitations

- Maximum 5 pages processed for cost/speed
- Requires Azure OpenAI with GPT-4o Vision capability
- Image quality affects OCR accuracy
- Higher latency than text extraction

---

## Mock Data

### Mock Workers

```python
MOCK_WORKERS = {
    "W001": {"id": "W001", "name": "Sarah Johnson", "role": "RN", "active": True},
    "W002": {"id": "W002", "name": "Michael Chen", "role": "PT", "active": True},
    "W003": {"id": "W003", "name": "Emily Davis", "role": "OT", "active": True},
    "12345": {"id": "12345", "name": "Test Worker", "role": "RN", "active": True}
}
```

### Mock Patients

```python
MOCK_PATIENTS = [
    {
        "id": "P001",
        "firstName": "John",
        "lastName": "Smith",
        "fullName": "Smith, John",
        "dob": "1945-03-15",
        "mrn": "MRN001",
        "visitTime": "9:00 AM",
        "visitType": "SN11 (Skilled Nursing)",
        "visitTypeCode": "SN11",
        "status": "booked"
    },
    # ... 5 more patients with different visit types
]
```

### Visit Type Codes in Mock Data

| Code | Type | Purpose |
|------|------|---------|
| SN11 | Skilled Nursing | Valid - standard nursing visit |
| PT11 | Physical Therapy | Valid - PT visit |
| RN11WC | Wound Care | Valid - wound care visit |
| OT11 | Occupational Therapy | Valid - OT visit |
| ADMIN | Administrative | Invalid - filtered out |
| PHONE | Phone Call | Invalid - filtered out |

The mock data includes invalid visit types to test the filtering logic in the Node.js application.

---

## Catch-All Endpoint

For any unmapped patient resource endpoint:

```http
GET /api/v1/patients/{patient_id}/{resource_path}
```

**Response:**
```json
{
    "data": [],
    "count": 0,
    "message": "Mock data for {resource_path}"
}
```

---

## CORS Configuration

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)
```

**Note:** This permissive CORS configuration is for development only. Production deployments should restrict origins.
