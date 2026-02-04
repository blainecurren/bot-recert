# PDF Extraction Service

A lightweight FastAPI service for extracting text from PDF documents.

## Features

- **Text Extraction**: Uses pdfplumber for text-based PDFs
- **Vision OCR Fallback**: Uses GPT-4o Vision for scanned/image-based PDFs
- **FHIR Integration**: Fetches PDFs using FHIR access tokens

## Setup

```bash
cd pdf-service

# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # Linux/Mac
# or
.\venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt
```

## Running

```bash
# Development with auto-reload
uvicorn main:app --reload --port 8000

# Production
uvicorn main:app --host 0.0.0.0 --port 8000
```

## Environment Variables

The service reads from the parent directory's `.env` file:

```env
# Required for Vision OCR fallback (scanned PDFs)
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_DEPLOYMENT=gpt-4o
```

## API Endpoints

### Health Check

```http
GET /api/v1/health
```

**Response:**
```json
{
    "status": "healthy",
    "timestamp": "2025-01-15T10:30:00.000Z",
    "service": "pdf-extraction",
    "vision_ocr_available": true
}
```

### Extract Text

```http
POST /api/v1/documents/extract-text
```

**Request:**
```json
{
    "url": "https://api.hchb.com/fhir/r4/Binary/123",
    "token": "eyJ..."
}
```

**Response:**
```json
{
    "success": true,
    "text": "Patient Name: John Smith...",
    "page_count": 3,
    "char_count": 4523,
    "used_vision_ocr": false,
    "metadata": {
        "title": "Visit Note",
        "author": "Sarah Johnson, RN"
    }
}
```

## How It Works

1. Receives PDF URL and FHIR access token
2. Downloads PDF from FHIR server
3. Attempts text extraction with pdfplumber
4. If < 50 characters extracted, falls back to Vision OCR:
   - Converts PDF pages to images (max 5 pages)
   - Sends images to GPT-4o Vision for OCR
5. Returns extracted text with metadata
