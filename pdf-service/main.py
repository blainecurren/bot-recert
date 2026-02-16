"""
PDF Extraction Service
FastAPI server for extracting text from PDF documents via FHIR attachment URLs.
Runs on port 8000.
"""

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import httpx
import pdfplumber
import io
import os
import base64
from openai import AzureOpenAI
from dotenv import load_dotenv

# Load environment variables from parent directory's .env
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

# Azure OpenAI configuration for Vision OCR fallback
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT")
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY")
AZURE_OPENAI_DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o")


class ExtractTextRequest(BaseModel):
    url: str
    token: Optional[str] = None  # Deprecated: use Authorization header instead


app = FastAPI(
    title="PDF Extraction Service",
    description="Extracts text from PDF documents for AI summarization",
    version="1.0.0"
)

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3978").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/api/v1/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "service": "pdf-extraction",
        "vision_ocr_available": all([AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT])
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

        try:
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
        except Exception as e:
            print(f"[Vision OCR] Error on page {i + 1}: {e}")
            extracted_texts.append(f"--- Page {i + 1} ---\n[Error extracting text: {str(e)}]")

    pdf_doc.close()

    full_text = "\n\n".join(extracted_texts)
    print(f"[Vision OCR] Extracted {len(full_text)} characters from {max_pages} pages")
    return full_text


@app.post("/api/v1/documents/extract-text")
async def extract_text_from_pdf(
    request: ExtractTextRequest,
    authorization: Optional[str] = Header(None)
):
    """
    Fetch PDF from URL and extract text content.

    Uses pdfplumber for text-based PDFs, falls back to GPT-4o Vision for scanned/image PDFs.

    Request body:
    - url: The attachment URL from DocumentReference

    Headers:
    - Authorization: Bearer token for FHIR API authentication

    Returns extracted text, page count, and metadata.
    """
    # Prefer Authorization header, fall back to body token for backwards compatibility
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    elif request.token:
        token = request.token

    if not token:
        raise HTTPException(status_code=401, detail="Authorization token required (via header or body)")

    MAX_SIZE_MB = 10
    MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(
                request.url,
                headers={
                    "Authorization": f"Bearer {token}",
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
