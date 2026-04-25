# Gradium

Low-latency, high-quality TTS and STT API. Voice cloning from 10 second samples. Time-to-first-token below 300 ms.

- REST: `https://api.gradium.ai/api`
- WebSocket: `wss://api.gradium.ai/api`
- Docs: `https://docs.gradium.ai`, API ref: `https://gradium.ai/api_docs.html`
- Auth: `x-api-key: YOUR_KEY` header
- Languages: en, fr, de, es, pt
- Python SDK: `pip install gradium`

## Where to use Gradium

Voice agents, IVR/phone bots (ulaw_8000 / alaw_8000 supported), live captions and dubbing, accessibility readers, custom branded voices, multilingual narration, podcast generation, real-time transcription with VAD-driven turn taking. Pairs naturally with LiveKit and Pipecat for production agents.

## Client Setup

```python
import gradium
client = gradium.client.GradiumClient()  # reads GRADIUM_API_KEY env var
# or
client = gradium.client.GradiumClient(api_key="...")
```

## Text-to-Speech

```python
result = await client.tts(
    setup={"model_name":"default","voice_id":"YTpq7expH9539ERJ","output_format":"wav"},
    text="Hello, world!"
)
open("out.wav","wb").write(result.raw_data)
```

Setup params: `model_name` (default), `voice_id` (library or custom), `output_format` (`pcm`, `wav`, `opus`, `ulaw_8000`, `alaw_8000`, `pcm_8000`, `pcm_16000`, `pcm_24000`). Optional `pronunciation_id`, `cfg_coef` (1.0 to 4.0, default 2.0, voice cloning similarity).

PCM specs: 48 kHz, 16-bit signed mono, 3840 sample chunks (80 ms).

### Streaming

```python
stream = await client.tts_stream(setup={...}, text="...")
async for chunk in stream.iter_bytes():
    ...
```

Async generator input is supported. Split text on whitespace, never inside a word or before punctuation. The server inserts a space between consecutive messages.

### Control tags

- `<flush>` forces audio flush for buffered text.
- `<break time="1.5s" />` inserts a pause (0.1 to 2.0 s, must be space-padded).

### Word-level timestamps

```python
for item in result.text_with_timestamps:
    print(item.text, item.start_s, item.stop_s)
```

### Pronunciation Dictionaries

Create dictionaries in Gradium Studio for brand names, acronyms, and edge-case pronunciations. Pass `pronunciation_id` in setup.

## Speech-to-Text

```python
async def audio_gen(data, chunk_size=1920):
    for i in range(0, len(data), chunk_size):
        yield data[i:i+chunk_size]

stream = await client.stt_stream(
    {"model_name":"default","input_format":"pcm"},
    audio_gen(audio),
)
async for msg in stream.iter_text():
    print(msg)
```

Setup params: `input_format` (`pcm`, `wav`, `opus`), `model_name`. PCM input must be 24 kHz, 16-bit signed mono, ~1920 sample chunks (~80 ms).

Message types streamed back:
- `step` (VAD): voice activity detection, signals end of utterance.
- `text`: transcript with timestamps.

Advanced options pass via `json_options` dict (string to float/string).

## Voices

Library voices and custom clones share the same API. Pick voice IDs from the library section in docs or Studio.

```python
# List
voices = await gradium.voices.list(client)

# Get one
voice = await gradium.voices.get(client, voice_id="YTpq7expH9539ERJ")

# Create clone (10 s minimum, clearer is better)
voice = await gradium.voices.create(
    client,
    audio_file="me.wav",
    name="My Voice",
    description="...",
    start_s=0.0,
)

# Update / delete
await gradium.voices.update(client, voice_id, name="...", description="...")
await gradium.voices.delete(client, voice_id)
```

REST endpoints (`x-api-key` auth):
- `GET /voices` list, `GET /voices/{id}` get
- `POST /voices` create, `PUT /voices/{id}` update, `DELETE /voices/{id}` delete
- `GET /credit` credit info

## WebSocket Endpoints

For lowest-latency realtime use:

- `wss://api.gradium.ai/api/tts` TTS streaming
- `wss://api.gradium.ai/api/stt` STT streaming

Both expect a first JSON setup message: `{"type":"setup", "model_name":"default", "voice_id":"...", "output_format":"wav"}` (TTS) or `{"type":"setup", "model_name":"default", "input_format":"pcm"}` (STT). Server replies with a `ready` message, then audio (binary) and JSON events flow.

For TTS, send `{"type":"text","text":"..."}` messages. For STT, send binary audio frames.

## Notes

- TTS sample rate: 48 kHz mono out of the box. STT sample rate: 24 kHz.
- Servers in EU and US, expected TTFT under 300 ms streaming.
- Five languages today, more coming.
- Use `cfg_coef` carefully; very high values create artifacts.
- Keep punctuation attached to the preceding word when chunking text.
- Custom voices need at least 10 seconds of clean audio.

## Quick TTS curl (REST)

```bash
curl -X POST https://api.gradium.ai/api/tts \
  -H "x-api-key: $GRADIUM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"setup":{"voice_id":"YTpq7expH9539ERJ","output_format":"wav","model_name":"default"},"text":"Hello"}' \
  --output out.wav
```

## When to pick Gradium

- Need EU-hosted, low-latency voice for an agent.
- Want instant cloning from short samples without long onboarding.
- Building phone-grade TTS with `ulaw_8000`/`alaw_8000` outputs.
- Multilingual TTS/STT in en/fr/de/es/pt with semantic VAD.

For a turnkey voice-agent loop on top of Gradium, see `gradbot.md`.
