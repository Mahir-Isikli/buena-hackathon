# Gradbot

Open source voice agent framework from Gradium. Real-time speech-to-speech loop with STT, LLM, TTS coordinated for you. VAD, turn-taking, fillers, barge-in, and tool calling are handled by the runtime, you write the agent logic.

- GitHub: `https://github.com/gradium-ai/gradbot`
- PyPI: `pip install gradbot` (Python 3.12+)
- Built in Rust with PyO3 bindings; works with any OpenAI-compatible LLM
- Pairs with Gradium APIs (`docs/gradium.md`); for production prefer LiveKit or Pipecat with Gradium

## Where to use Gradbot

Hackathon prototypes, demo agents, NPC dialog in games, quick voice IVR/booking flows, in-product voice assistants, accessibility helpers. Built for prototyping, not production load.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GRADIUM_API_KEY` | yes | Gradium STT/TTS key |
| `LLM_API_KEY` | yes | OpenAI-compatible LLM key (falls back to `OPENAI_API_KEY`) |
| `LLM_BASE_URL` | no | LLM base URL (defaults to OpenAI) |
| `LLM_MODEL` | no | Model name, auto-detected if only one available |
| `GRADIUM_BASE_URL` | no | Override Gradium endpoint |

## Minimal Example

```python
import asyncio, gradbot

async def main():
    voice = gradbot.flagship_voice("Emma")
    config = gradbot.SessionConfig(
        voice_id=voice.voice_id,
        instructions="You are a helpful assistant.",
        language=voice.language,
    )

    input_handle, output_handle = await gradbot.run(
        session_config=config,
        input_format=gradbot.AudioFormat.OggOpus,
        output_format=gradbot.AudioFormat.OggOpus,
    )

    while True:
        msg = await output_handle.receive()
        if msg is None:
            break
        if msg.msg_type == "audio":
            play(msg.data)
        elif msg.msg_type == "tool_call":
            result = handle(msg.tool_call.tool_name, msg.tool_call.args_json)
            await msg.tool_call_handle.send(result)

asyncio.run(main())
```

You feed mic frames in via `input_handle.send_audio(bytes)` and consume audio + events via `output_handle.receive()`.

## Public API

Functions:
- `run(...)` create clients and start a session, returns `(SessionInputHandle, SessionOutputHandle)`.
- `create_clients(...)` reusable `GradbotClients` for many sessions.
- `flagship_voice(name)`, `flagship_voices()` browse curated voices.
- `init_logging()` debug logs.

Enums: `Lang` (En, Fr, Es, De, Pt), `Gender` (Masculine, Feminine), `Country` (Us, Gb, Fr, De, Mx, Es, Br), `AudioFormat` (OggOpus, Pcm, Ulaw).

Classes:
- `SessionConfig`: `voice_id`, `instructions`, `language`, `assistant_speaks_first`, `silence_timeout_s`, `tools`.
- `ToolDef`: `name`, `description`, `parameters_json`.
- `SessionInputHandle`: `send_audio(bytes)`, `send_config(SessionConfig)`, `close()`.
- `SessionOutputHandle`: `receive() -> MsgOut | None`.
- `MsgOut.msg_type`: `audio`, `tts_text`, `stt_text`, `event`, `tool_call`.
- `ToolCallInfo`: `call_id`, `tool_name`, `args_json`.
- `ToolCallHandlePy`: `send(result_json)`, `send_error(msg)`.

Channel semantics: `output.receive()` returns `Err` on processing errors and `None` once the input handle is dropped (clean shutdown). All timestamps (`start_s`, `stop_s`, `time_s`) are seconds from session start.

## Tool Calling

```python
tools = [gradbot.ToolDef(
    name="book_room",
    description="Book a hotel room",
    parameters_json='{"type":"object","properties":{"date":{"type":"string"}}}',
)]
config = gradbot.SessionConfig(voice_id=v, instructions="...", tools=tools)
```

When the LLM calls a tool you receive a `MsgOut` with `msg_type == "tool_call"`. Run your handler, then `await msg.tool_call_handle.send(result_json)` (or `send_error`).

## FastAPI / WebSocket Frontend

```python
import fastapi, gradbot

app = fastapi.FastAPI()
cfg = gradbot.config.from_env()
gradbot.routes.setup(app, config=cfg, static_dir="static", with_voices=True)

@app.websocket("/ws")
async def ws(websocket: fastapi.WebSocket):
    await gradbot.websocket.handle_session(
        websocket,
        config=cfg,
        on_start=lambda msg: gradbot.SessionConfig(instructions="You are a helpful assistant."),
    )
```

`routes.setup` registers `/api/audio-config`, serves your static files, and the bundled JS audio worklet at `/static/js/`.

WebSocket protocol:

| Direction | Format | Purpose |
|---|---|---|
| C to S | `{"type":"start", ...}` | begin session |
| C to S | binary | audio frames |
| C to S | `{"type":"config", ...}` | update mid-session |
| C to S | `{"type":"stop"}` | end session |
| S to C | JSON | transcripts, events, audio timing |
| S to C | binary | audio chunks |

## Remote Mode

Run STT/LLM/TTS on `gradbot_server` and connect from a thin client:

```python
input_handle, output_handle = await gradbot.run(
    gradbot_url="wss://your-server.com/ws",
    gradbot_api_key="grd_...",
    session_config=config,
    input_format=gradbot.AudioFormat.OggOpus,
    output_format=gradbot.AudioFormat.OggOpus,
)
```

When `gradbot_url` is set, all other client params are ignored. Same handles, same API. Ideal for keeping API keys server-side and sharing one infra across many client devices. Enable in `config.yaml`:

```yaml
gradbot_server:
  url: "wss://your-server.com/ws"
  api_key: "grd_..."
```

## Repo Layout

- `gradbot_lib/` Rust core (STT/LLM/TTS multiplex)
- `gradbot_py/` Python bindings (PyO3 + maturin)
- `gradbot_server/` standalone WS server for remote mode
- `src/` server binary supporting OpenAI and Twilio WS protocols
- `js_audio_processor/` browser worklet (Opus encode/decode, jitter buffer)
- `demos/` examples, including 3D NPC, hotel booking, simple chat

## Tips

- Use `OggOpus` over the network for best quality/bandwidth.
- Keep `silence_timeout_s` short for fast turn-taking.
- For low latency LLM use Groq, GPT-4o-mini, or Claude with tool calling.
- Tail logs with `gradbot.init_logging()` while debugging.

For TTS/STT details, voice cloning, and pronunciation tweaks see `gradium.md`.
