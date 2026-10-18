# Gemini API key rotation

Cascade supports an optional Gemini key ring. It is used only when `LLM_PROVIDER=gemini`; the default `rules` provider is deterministic and needs no API key.

## Configure

Set the primary key and optional comma-separated fallbacks in the backend environment. Keep real values in a secret manager or an ignored local `.env` file.

```dotenv
LLM_PROVIDER=gemini
GEMINI_API_KEY=replace-with-primary-key
GEMINI_API_KEYS=replace-with-fallback-key-1,replace-with-fallback-key-2
```

`GEMINI_API_KEYS` is optional. The app validates that at least one key is present when Gemini is selected.

## Retry and fallback behavior

- A transient Gemini failure gets at most one bounded retry.
- A 429 can try one alternate key for the request; the implementation does not walk the entire key ring for each request.
- Exhausted or unavailable Gemini requests fall back to deterministic rules and explanation templates through the provider wrapper.
- Calls are capped per process by `LLM_CALL_LIMIT` over `LLM_CALL_WINDOW_SECONDS`; over-budget calls use the rules provider.
- Invalid or schema-incompatible model output is rejected and handled by the deterministic fallback. It is not retried.

The rotation state and call budget are process-local, not shared between Cloud Run instances. No credentials are written to logs. Do not place live keys in `.env.example`, documentation, tests, or commits.

`GEMINI_API_KEYS` and key rotation are Cascade-only; Mercora does not implement Gemini integration. Voice transcription was removed and is not part of this key ring.