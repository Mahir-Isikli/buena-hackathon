# Meta Ray-Ban (and Ray-Ban Meta Display)

Wearable AI glasses developers can target via the Meta Wearables Device Access Toolkit (DAT). For the SDK setup, lifecycle, and code examples see `meta-wearables.md`. This file is a Ray-Ban specific reference: hardware lineup, what each model exposes, hardware quirks, and how to choose between them.

## Hardware lineup (DAT 0.6.0 supported)

| Model | Use case | Display | Camera | Mics | Speakers | Min firmware |
|---|---|---|---|---|---|---|
| Ray-Ban Meta Gen 1 | Mainstream AI glasses | none | yes | beamforming array | open-ear | v22 |
| Ray-Ban Meta Gen 2 | Refresh of Gen 1 | none | yes (improved) | array | open-ear | v22 |
| Ray-Ban Meta Optics | Prescription frames | none | yes | array | open-ear | v22 |
| Meta Ray-Ban Display | Heads-up display + Neural Band | small in-lens display | yes | array | open-ear | v21 |
| Oakley Meta HSTN | Sport-styled | none | yes | array | open-ear | v22 |
| Oakley Meta Vanguard | Sport / cycling | none | yes | array | open-ear | v22 |

All models reachable through the same SDK surface. Display rendering on the Display model is NOT yet exposed to third-party apps (planned). The Neural Band that ships with the Display model is also not exposed during the developer preview.

## Capabilities developers get

- Live video stream from first-person camera at 720x1280 / 504x896 / 360x640 at 2-30 fps.
- One-shot photo capture (JPEG) while a stream is running.
- Two-way audio over Bluetooth: HFP for mic in (8 kHz mono, beamformed on the wearer), A2DP for output.
- Standard captouch events from the temple: pause / resume / stop the session.
- Wear detection signals: doffed/donned can pause and resume.
- Hinge state implicitly drives Bluetooth connectivity.

## Capabilities NOT exposed yet

- Heads-up display rendering on the Display model.
- Neural Band gestures, IMU, or biosignals.
- Custom captouch gestures beyond the standard set.
- Direct call into "Hey Meta" / Meta AI assistant.
- Background sessions when the app is fully closed.

## Choosing a model for your build

- Best AI/CV demo: any Ray-Ban Meta Gen 2, identical SDK surface, easiest to demo.
- Sport / outdoor: Oakley Meta Vanguard or HSTN.
- Need prescription support out of the box: Ray-Ban Meta Optics.
- Want to future-proof for HUD experiences: Meta Ray-Ban Display, but plan around the SDK NOT yet rendering to it.

## Hardware quirks worth designing around

- HFP mic streams at 8 kHz mono. Voice is clear because of beamforming, but ambient and other speakers are heavily attenuated. Don't expect music transcription.
- Camera framerate is throttled by Bluetooth bandwidth, run at 360x640 / 24fps for low latency, 720x1280 / 24fps for quality demos, 720x1280 / 30fps drops frames in poor link conditions.
- Closing the hinges disconnects Bluetooth and forces `SessionState.STOPPED`. Opening doesn't auto-resume, you must start a new session after the device is back online.
- Streams started while glasses are doffed get auto-paused when donned. User must tap to resume.
- A wedged camera service (reported when hinges close mid-stream) requires a reboot of the glasses, not just the app.

## Practical setup checklist for Ray-Ban Meta

1. User has a Meta account and Meta AI app v254+.
2. Glasses on supported firmware (v22 for Ray-Ban Meta, v21 for Display).
3. Developer Mode enabled in Meta AI app (5 taps on version).
4. Your app added a release channel under the Wearables Developer Center.
5. iOS users tester in TestFlight / Ad-hoc release; App Store store submission is blocked because the SDK depends on `ExternalAccessory` which violates Apple MFi rules.
6. Android users run a build signed with the same `mwdat_application_id`.

## End-to-end demo recipe

Goal: a hackathon demo where the wearer asks a question, the app sees what they see, calls an LLM, and responds with audio.

1. Pair Ray-Ban Meta to the Meta AI app, enable developer mode.
2. Register your iOS or Android app via DAT, request camera permission.
3. Start a session, add a `low` resolution stream at 24 fps.
4. Pipe video frames into your CV/LLM pipeline.
5. Capture mic audio via HFP (`AVAudioSession` on iOS, `setCommunicationDevice(BLUETOOTH_SCO)` on Android), feed it to STT.
6. Run the LLM, generate a TTS response (Gradium works well, see `gradium.md`).
7. Play TTS over A2DP, the open-ear speakers are loud enough for crowds.

## Distribution today

Public store distribution is not available. Use Wearables Developer Center release channels:

- Create a project, add release channels, invite testers by Meta-account email.
- Production builds need the `MWDAT` `APPLICATION_ID` from your project bound to that channel.
- Broader publishing access from Meta is expected later in 2026.

## Where Ray-Ban hardware ends and the SDK begins

The SDK abstracts away which Ray-Ban / Oakley model the user is wearing. Treat the device list returned by `Wearables.devicesStream()` (iOS) or `Wearables.devices` (Android) as the source of truth and avoid hard-coding model names. Capability detection lives in device metadata, not in the model string.

## Further reading

- DAT integration details: `meta-wearables.md`
- Sample apps: `demos/` in both repos (CameraAccess is the main reference).
- Blog posts: `https://developers.meta.com/blog/introducing-meta-wearables-device-access-toolkit/` and `https://developers.meta.com/blog/explore-whats-possible-with-wearables-device-access-toolkit/`.
- Full machine-readable API ref: `https://wearables.developer.meta.com/llms.txt?full=true`.
