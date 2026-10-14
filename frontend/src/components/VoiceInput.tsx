import { useState, useRef } from "react";

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

type State = "idle" | "recording" | "processing" | "confirming";

export function VoiceInput({ onTranscript, disabled }: VoiceInputProps) {
  const [state, setState] = useState<State>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";

      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunks.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunks.current, { type: mimeType });
        await transcribe(audioBlob);
      };

      recorder.start();
      mediaRecorder.current = recorder;
      setState("recording");
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("Microphone access denied");
      } else {
        setError("Failed to start recording");
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && mediaRecorder.current.state !== "inactive") {
      mediaRecorder.current.stop();
      setState("processing");
    }
  };

  const transcribe = async (audioBlob: Blob) => {
    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");

    try {
      const userId = localStorage.getItem("cascade-user-id") || "ops-ravi";
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "X-User-Id": userId },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "Transcription failed" }));
        const message = errorData.detail || "Transcription failed";
        
        // Provide user-friendly messages
        if (response.status === 503) {
          if (message.includes("requires Gemini provider")) {
            throw new Error("Voice input requires Gemini. Try typing your request instead.");
          }
          throw new Error("Transcription service unavailable. Try typing your request.");
        } else if (response.status === 413) {
          throw new Error("Audio too long. Try a shorter recording.");
        } else if (response.status === 400) {
          throw new Error("Couldn't process audio. Try recording again.");
        }
        
        throw new Error("Couldn't transcribe audio. Try again or type your request.");
      }

      const data = await response.json();
      setTranscript(data.transcript);
      setState("confirming");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't transcribe audio. Try typing your request.");
      setState("idle");
    }
  };

  const confirm = () => {
    onTranscript(transcript);
    reset();
  };

  const reset = () => {
    setTranscript("");
    setError(null);
    setState("idle");
  };

  return (
    <div className="relative">
      {/* Microphone Button */}
      <button
        type="button"
        onClick={state === "idle" ? startRecording : stopRecording}
        disabled={disabled || state === "processing"}
        className={`flex h-11 w-11 items-center justify-center rounded-lg border transition-all ${
          state === "recording"
            ? "border-red-400 bg-red-50 text-red-600"
            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
        } disabled:cursor-not-allowed disabled:opacity-50`}
        title={state === "idle" ? "Record voice input" : state === "recording" ? "Stop recording" : "Processing..."}
      >
        {state === "recording" ? (
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : state === "processing" ? (
          <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        )}
      </button>

      {/* Transcript Confirmation Modal */}
      {state === "confirming" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={reset}>
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-lg font-semibold text-slate-900">Confirm transcript</h3>
            <p className="mb-4 text-sm text-slate-600">Review and edit before submitting.</p>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={3}
              className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={confirm}
                disabled={!transcript.trim()}
                className="flex-1 rounded-lg bg-primary-600 px-4 py-2 font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
              >
                Confirm & use
              </button>
              <button
                type="button"
                onClick={reset}
                className="rounded-lg border border-slate-200 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error or Recording Indicator */}
      {error && (
        <div className="absolute top-full left-0 mt-2 rounded-lg bg-slate-100 border border-slate-300 px-3 py-2 text-sm text-slate-700 max-w-xs">
          {error}
        </div>
      )}
      {state === "recording" && !error && (
        <div className="absolute top-full left-0 mt-2 whitespace-nowrap rounded-lg bg-blue-50 border border-blue-200 px-3 py-1.5 text-sm text-blue-700">
          <span className="inline-block h-2 w-2 rounded-full bg-blue-600 animate-pulse mr-2" />
          Recording...
        </div>
      )}
      {state === "processing" && !error && (
        <div className="absolute top-full left-0 mt-2 whitespace-nowrap rounded-lg bg-blue-50 border border-blue-200 px-3 py-1.5 text-sm text-blue-700">
          <svg className="inline-block h-3 w-3 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Transcribing with Gemini...
        </div>
      )}
    </div>
  );
}
