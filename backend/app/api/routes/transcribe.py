"""Audio transcription endpoint."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.api.deps import Context, CurrentUser
from app.core.config import Settings

router = APIRouter(prefix="/api/transcribe", tags=["transcribe"])

# Supported audio formats per Gemini API
SUPPORTED_FORMATS = {
    "audio/wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/webm",
    "audio/ogg",
}
MAX_AUDIO_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post("")
async def transcribe_audio(
    ctx: Context,
    user: CurrentUser,
    audio: Annotated[UploadFile, File(description="Audio file to transcribe")],
) -> dict[str, str]:
    """Transcribe audio to text using Gemini."""
    import logging

    logger = logging.getLogger(__name__)
    settings = Settings()

    # Validate content type
    if audio.content_type not in SUPPORTED_FORMATS:
        logger.warning(
            "unsupported_audio_format",
            extra={"content_type": audio.content_type, "supported": list(SUPPORTED_FORMATS)},
        )
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio format: {audio.content_type}. "
            f"Supported: WAV, MP3, MP4, WebM, OGG",
        )

    # Read and validate audio data
    audio_data = await audio.read()
    if not audio_data:
        logger.warning("empty_audio_file")
        raise HTTPException(status_code=400, detail="Empty audio file")

    if len(audio_data) > MAX_AUDIO_SIZE:
        logger.warning("audio_too_large", extra={"size": len(audio_data), "max": MAX_AUDIO_SIZE})
        raise HTTPException(
            status_code=413, detail=f"Audio file too large (max {MAX_AUDIO_SIZE} bytes)"
        )

    # Check provider
    if ctx.llm.name != "gemini":
        logger.info(
            "transcription_requires_gemini",
            extra={"current_provider": ctx.llm.name},
        )
        raise HTTPException(
            status_code=503,
            detail=f"Voice transcription requires Gemini provider (current: {ctx.llm.name})",
        )

    # Transcribe using Gemini
    try:
        from google import genai
        from google.genai import types

        if not settings.gemini_api_key:
            logger.error("gemini_api_key_not_configured")
            raise HTTPException(status_code=503, detail="Gemini API key not configured")

        client = genai.Client(
            api_key=settings.gemini_api_key.get_secret_value(),
            http_options=types.HttpOptions(
                timeout=int(settings.llm_timeout_seconds * 1000),
                retry_options=types.HttpRetryOptions(attempts=1),
            ),
        )

        mime = audio.content_type or "audio/webm"
        logger.info(
            "transcribing_audio",
            extra={"mime_type": mime, "audio_size": len(audio_data)},
        )

        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=[
                "Transcribe this audio to text. Return only the spoken words.",
                types.Part.from_bytes(data=audio_data, mime_type=mime),
            ],
            config=types.GenerateContentConfig(temperature=0),
        )

        transcript = str(response.text or "").strip()
        if not transcript:
            logger.warning("empty_transcript_from_gemini")
            raise HTTPException(status_code=500, detail="Transcription returned empty text")

        logger.info("transcription_success", extra={"transcript_length": len(transcript)})
        return {"transcript": transcript, "provider": "gemini"}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "transcription_failed",
            extra={"error_type": type(exc).__name__, "error": str(exc)},
        )
        raise HTTPException(
            status_code=500, detail=f"Transcription failed: {type(exc).__name__}"
        ) from exc
