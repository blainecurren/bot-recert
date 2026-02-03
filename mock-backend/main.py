"""
Mock Python Backend for HCHB FHIR API Testing
FastAPI server that simulates the Python backend at localhost:8000
"""

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import Optional
import random
import httpx
import pdfplumber
import io
import os
import base64
from openai import AzureOpenAI
from dotenv import load_dotenv

# Load environment variables from parent directory's .env
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

# Azure OpenAI configuration for Vision OCR
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT")
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY")
AZURE_OPENAI_DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT")


class ExtractTextRequest(BaseModel):
    url: str
    token: str

app = FastAPI(title="Mock HCHB Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mock data
MOCK_WORKERS = {
    "W001": {"id": "W001", "name": "Sarah Johnson", "role": "RN", "active": True},
    "W002": {"id": "W002", "name": "Michael Chen", "role": "PT", "active": True},
    "W003": {"id": "W003", "name": "Emily Davis", "role": "OT", "active": True},
    "12345": {"id": "12345", "name": "Test Worker", "role": "RN", "active": True},
}

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
    {
        "id": "P002",
        "firstName": "Mary",
        "lastName": "Williams",
        "fullName": "Williams, Mary",
        "dob": "1952-07-22",
        "mrn": "MRN002",
        "visitTime": "10:30 AM",
        "visitType": "PT11 (Physical Therapy)",
        "visitTypeCode": "PT11",
        "status": "booked"
    },
    {
        "id": "P003",
        "firstName": "Robert",
        "lastName": "Brown",
        "fullName": "Brown, Robert",
        "dob": "1938-11-08",
        "mrn": "MRN003",
        "visitTime": "1:00 PM",
        "visitType": "RN11WC (Wound Care)",
        "visitTypeCode": "RN11WC",
        "status": "booked"
    },
    {
        "id": "P004",
        "firstName": "Patricia",
        "lastName": "Jones",
        "fullName": "Jones, Patricia",
        "dob": "1960-05-30",
        "mrn": "MRN004",
        "visitTime": "2:30 PM",
        "visitType": "ADMIN (Administrative)",
        "visitTypeCode": "ADMIN",
        "status": "booked"
    },
    {
        "id": "P005",
        "firstName": "James",
        "lastName": "Davis",
        "fullName": "Davis, James",
        "dob": "1955-09-12",
        "mrn": "MRN005",
        "visitTime": "3:30 PM",
        "visitType": "OT11 (Occupational Therapy)",
        "visitTypeCode": "OT11",
        "status": "booked"
    },
    {
        "id": "P006",
        "firstName": "Linda",
        "lastName": "Miller",
        "fullName": "Miller, Linda",
        "dob": "1948-12-03",
        "mrn": "MRN006",
        "visitTime": "4:00 PM",
        "visitType": "PHONE (Phone Call)",
        "visitTypeCode": "PHONE",
        "status": "booked"
    },
]


@app.get("/api/v1/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


@app.get("/api/v1/workers/{worker_id}/validate")
async def validate_worker(worker_id: str):
    worker = MOCK_WORKERS.get(worker_id)
    if worker:
        return {"valid": True, "worker": worker, "message": "Worker validated"}
    return {"valid": False, "worker": None, "message": f"Worker {worker_id} not found"}


@app.get("/api/v1/workers/{worker_id}/patients")
async def get_worker_patients(worker_id: str, visit_date: str = Query(None)):
    if worker_id not in MOCK_WORKERS:
        return {"data": [], "count": 0}

    # Return mock patients for any valid worker
    return {"data": MOCK_PATIENTS, "count": len(MOCK_PATIENTS)}


@app.get("/api/v1/patients/{patient_id}")
async def get_patient(patient_id: str):
    patient = next((p for p in MOCK_PATIENTS if p["id"] == patient_id), None)
    if patient:
        return patient
    return {"error": "Patient not found"}


@app.get("/api/v1/patients/{patient_id}/allergies")
async def get_allergies(patient_id: str):
    return {
        "data": [
            {"substance": "Penicillin", "reaction": "Rash", "severity": "Moderate"},
            {"substance": "Sulfa", "reaction": "Hives", "severity": "Mild"},
        ],
        "count": 2
    }


@app.get("/api/v1/patients/{patient_id}/conditions")
async def get_conditions(patient_id: str):
    return {
        "data": [
            {"code": "I10", "display": "Essential Hypertension", "status": "active"},
            {"code": "E11.9", "display": "Type 2 Diabetes Mellitus", "status": "active"},
            {"code": "M79.3", "display": "Panniculitis", "status": "active"},
        ],
        "count": 3
    }


@app.get("/api/v1/patients/{patient_id}/medications")
async def get_medications(patient_id: str):
    return {
        "data": [
            {"name": "Lisinopril", "dose": "10mg", "frequency": "Once daily"},
            {"name": "Metformin", "dose": "500mg", "frequency": "Twice daily"},
            {"name": "Aspirin", "dose": "81mg", "frequency": "Once daily"},
        ],
        "count": 3
    }


@app.get("/api/v1/patients/{patient_id}/vitals/blood-pressure")
async def get_blood_pressure(patient_id: str):
    return {
        "data": [
            {"date": "2025-01-10", "systolic": 128, "diastolic": 82, "position": "Sitting"},
            {"date": "2025-01-05", "systolic": 132, "diastolic": 84, "position": "Sitting"},
        ],
        "count": 2
    }


@app.get("/api/v1/patients/{patient_id}/vitals/heart-rate")
async def get_heart_rate(patient_id: str):
    return {
        "data": [
            {"date": "2025-01-10", "value": 72, "unit": "bpm"},
            {"date": "2025-01-05", "value": 76, "unit": "bpm"},
        ],
        "count": 2
    }


@app.get("/api/v1/patients/{patient_id}/vitals/temperature")
async def get_temperature(patient_id: str):
    return {
        "data": [
            {"date": "2025-01-10", "value": 98.6, "unit": "F"},
        ],
        "count": 1
    }


@app.get("/api/v1/patients/{patient_id}/vitals/oxygen-saturation")
async def get_oxygen_saturation(patient_id: str):
    return {
        "data": [
            {"date": "2025-01-10", "value": 97, "unit": "%"},
        ],
        "count": 1
    }


@app.get("/api/v1/patients/{patient_id}/vitals/body-weight")
async def get_body_weight(patient_id: str):
    return {
        "data": [
            {"date": "2025-01-10", "value": 165, "unit": "lbs"},
        ],
        "count": 1
    }


@app.get("/api/v1/patients/{patient_id}/episodes")
async def get_episodes(patient_id: str):
    return {
        "data": [
            {
                "id": "EP001",
                "status": "active",
                "periodStart": "2024-12-01",
                "periodEnd": "2025-01-30",
                "type": "Home Health"
            }
        ],
        "count": 1
    }


@app.get("/api/v1/patients/{patient_id}/encounters")
async def get_encounters(patient_id: str):
    return {
        "data": [
            {"date": "2025-01-10", "type": "Skilled Nursing Visit", "provider": "Sarah Johnson, RN"},
            {"date": "2025-01-08", "type": "Physical Therapy", "provider": "Michael Chen, PT"},
            {"date": "2025-01-05", "type": "Skilled Nursing Visit", "provider": "Sarah Johnson, RN"},
        ],
        "count": 3
    }


@app.get("/api/v1/patients/{patient_id}/care-team")
async def get_care_team(patient_id: str):
    return {
        "data": [
            {"name": "Sarah Johnson", "role": "Primary RN", "phone": "555-0101"},
            {"name": "Michael Chen", "role": "Physical Therapist", "phone": "555-0102"},
            {"name": "Dr. Amanda White", "role": "Attending Physician", "phone": "555-0103"},
        ],
        "count": 3
    }


@app.get("/api/v1/patients/{patient_id}/care-plans/aide-homecare")
async def get_aide_care_plan(patient_id: str):
    return {
        "data": {
            "activities": ["Bathing assistance", "Meal preparation", "Light housekeeping"],
            "frequency": "3x per week",
            "duration": "2 hours per visit"
        }
    }


@app.get("/api/v1/patients/{patient_id}/documents/{doc_type}")
async def get_documents(patient_id: str, doc_type: str):
    return {
        "data": [
            {"id": "DOC001", "title": f"{doc_type} - Latest", "date": "2025-01-10", "author": "Sarah Johnson"},
        ],
        "count": 1
    }


def extract_text_with_vision(pdf_bytes: bytes, page_count: int) -> str:
    """
    Use GPT-4o Vision to extract text from scanned/image-based PDFs.
    Converts PDF pages to images using PyMuPDF and sends to Azure OpenAI.
    """
    if not all([AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT]):
        raise Exception("Azure OpenAI not configured for Vision OCR")

    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise Exception("PyMuPDF required for Vision OCR. Install with: pip install PyMuPDF")

    print(f"[Vision OCR] Converting {page_count} PDF pages to images...")

    # Open PDF with PyMuPDF
    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    # Limit to first 5 pages for cost/speed
    max_pages = min(page_count, 5)

    # Initialize Azure OpenAI client
    client = AzureOpenAI(
        azure_endpoint=AZURE_OPENAI_ENDPOINT,
        api_key=AZURE_OPENAI_API_KEY,
        api_version="2024-08-01-preview"
    )

    extracted_texts = []

    for i in range(max_pages):
        print(f"[Vision OCR] Processing page {i + 1}/{max_pages}...")

        # Get page and render to image
        page = pdf_doc[i]
        # Render at 150 DPI (default is 72)
        mat = fitz.Matrix(150/72, 150/72)
        pix = page.get_pixmap(matrix=mat)

        # Convert to PNG bytes
        img_bytes = pix.tobytes("png")
        img_base64 = base64.b64encode(img_bytes).decode("utf-8")

        # Send to GPT-4o Vision
        response = client.chat.completions.create(
            model=AZURE_OPENAI_DEPLOYMENT,
            messages=[
                {
                    "role": "system",
                    "content": "You are an OCR assistant. Extract ALL text from this medical document image exactly as written. Preserve formatting, line breaks, and structure. Include all headers, dates, names, values, and notes. Do not summarize - extract the complete text."
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Extract all text from this medical document page:"
                        },
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

    pdf_doc.close()

    full_text = "\n\n".join(extracted_texts)
    print(f"[Vision OCR] Extracted {len(full_text)} characters from {max_pages} pages")
    return full_text


@app.post("/api/v1/documents/extract-text")
async def extract_text_from_pdf(request: ExtractTextRequest):
    """
    Fetch PDF from URL and extract text content.

    Uses pdfplumber for text-based PDFs, falls back to GPT-4o Vision for scanned/image PDFs.

    Request body:
    - url: The attachment URL from DocumentReference
    - token: Bearer token for authentication

    Returns extracted text, page count, and metadata.
    """
    MAX_SIZE_MB = 10
    MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                request.url,
                headers={
                    "Authorization": f"Bearer {request.token}",
                    "Accept": "application/pdf"
                }
            )

            if response.status_code == 401:
                raise HTTPException(status_code=401, detail="Unauthorized - token may be expired")
            elif response.status_code == 404:
                raise HTTPException(status_code=404, detail="Document not found at URL")
            elif response.status_code != 200:
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Failed to fetch PDF: {response.status_code}"
                )

            content_length = len(response.content)
            if content_length > MAX_SIZE_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"PDF too large ({content_length / 1024 / 1024:.1f}MB). Max size is {MAX_SIZE_MB}MB"
                )

            pdf_content = response.content
            pdf_bytes = io.BytesIO(pdf_content)

            extracted_text = []
            page_count = 0
            metadata = {}
            used_vision = False

            # First, try pdfplumber for text-based PDFs
            with pdfplumber.open(pdf_bytes) as pdf:
                page_count = len(pdf.pages)
                metadata = pdf.metadata or {}

                for page in pdf.pages:
                    text = page.extract_text()
                    if text:
                        extracted_text.append(text)

            full_text = "\n\n".join(extracted_text)

            # If no text extracted, fall back to Vision OCR
            if len(full_text.strip()) < 50 and page_count > 0:
                print(f"[Extract] No text from pdfplumber ({len(full_text)} chars), trying Vision OCR...")
                try:
                    full_text = extract_text_with_vision(pdf_content, page_count)
                    used_vision = True
                except Exception as vision_error:
                    print(f"[Extract] Vision OCR failed: {vision_error}")
                    # Return what we have, even if empty
                    pass

            return {
                "success": True,
                "text": full_text,
                "page_count": page_count,
                "char_count": len(full_text),
                "used_vision_ocr": used_vision,
                "metadata": {
                    "title": metadata.get("Title", ""),
                    "author": metadata.get("Author", ""),
                    "creator": metadata.get("Creator", ""),
                    "creation_date": metadata.get("CreationDate", "")
                }
            }

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Timeout while fetching PDF")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Network error: {str(e)}")
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Error processing PDF: {str(e)}")


# Catch-all for other endpoints
@app.get("/api/v1/patients/{patient_id}/{resource_path:path}")
async def get_resource(patient_id: str, resource_path: str):
    return {
        "data": [],
        "count": 0,
        "message": f"Mock data for {resource_path}"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
