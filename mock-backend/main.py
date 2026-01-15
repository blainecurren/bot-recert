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
        "visitType": "Skilled Nursing",
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
        "visitType": "Physical Therapy",
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
        "visitType": "Wound Care",
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
        "visitType": "Medication Management",
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


@app.post("/api/v1/documents/extract-text")
async def extract_text_from_pdf(request: ExtractTextRequest):
    """
    Fetch PDF from URL and extract text content.

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

            pdf_bytes = io.BytesIO(response.content)

            extracted_text = []
            page_count = 0
            metadata = {}

            with pdfplumber.open(pdf_bytes) as pdf:
                page_count = len(pdf.pages)
                metadata = pdf.metadata or {}

                for page in pdf.pages:
                    text = page.extract_text()
                    if text:
                        extracted_text.append(text)

            full_text = "\n\n".join(extracted_text)

            return {
                "success": True,
                "text": full_text,
                "page_count": page_count,
                "char_count": len(full_text),
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
