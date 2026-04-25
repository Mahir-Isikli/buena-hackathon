# Meta Wearables Device Access Toolkit (DAT)

iOS and Android SDK to integrate with Meta AI glasses (Ray-Ban Meta, Ray-Ban Meta Display, Oakley Meta HSTN, Oakley Meta Vanguard). Camera streaming, photo capture, mic and speaker access via Bluetooth, lifecycle events.

- iOS repo: `https://github.com/facebook/meta-wearables-dat-ios`
- Android repo: `https://github.com/facebook/meta-wearables-dat-android`
- Docs: `https://wearables.developer.meta.com/docs/`
- API ref for agents: `https://wearables.developer.meta.com/llms.txt?full=true`
- Status: developer preview. App Store distribution NOT supported (uses ExternalAccessory). Use test release channels.

Recommended workflow: clone both repos. Each ships a `.claude/` folder with skills auto-discovered by Claude Code.

## Supported devices and versions (DAT 0.6.0)

| Component | Version |
|---|---|
| Meta AI app (iOS/Android) | v254+ |
| Ray-Ban Meta (Gen 1, Gen 2, Optics) | v22 |
| Meta Ray-Ban Display | v21 |
| Oakley Meta HSTN / Vanguard | v22 |
| iOS / Android | 15.2+ / 10+ |
| Xcode / Android Studio | 14.0+ / Flamingo+ |

Enable Developer Mode in Meta AI app: Settings → App Info → tap version 5x → toggle on. Only one third-party app can stay registered in developer mode at a time.

## Integration lifecycle

1. Registration: one time deeplink to Meta AI app, returns to your app via custom URL scheme. Your app then appears in the user's App Connections list.
2. Permissions: camera permission granted through Meta AI app (Allow once / Allow always). Mic permission via standard iOS/Android dialog because audio uses Bluetooth HFP.
3. Session: only one session per device at a time. User can pause, resume, or stop via captouch, removing glasses, or closing hinges.

## Key SDK modules

- `MWDATCore`: registration, device discovery, permission state, telemetry.
- `MWDATCamera`: resolution / framerate selection, video stream, frame capture, photo capture.
- `MWDATMockDevice` (Android) and Mock Device Kit (iOS): simulated device for testing.

## iOS quick start (Swift)

`Info.plist` keys: `CFBundleURLTypes` for callback, `MWDAT` dict (`AppLinkURLScheme`, `MetaAppID`, `ClientToken`, `TeamID`), `UISupportedExternalAccessoryProtocols` with `com.meta.ar.wearable`, `UIBackgroundModes` (`bluetooth-peripheral`, `external-accessory`), `NSBluetoothAlwaysUsageDescription`, `NSCameraUsageDescription`.

Add Swift package: `https://github.com/facebook/meta-wearables-dat-ios`.

```swift
import MWDATCore
import MWDATCamera

try Wearables.configure()                                  // app launch
try Wearables.shared.startRegistration()                   // launch flow
_ = try await Wearables.shared.handleUrl(callbackURL)      // in URL handler

for await state in Wearables.shared.registrationStateStream() { ... }
for await devices in Wearables.shared.devicesStream() { ... }

let status = try await Wearables.shared.checkPermissionStatus(.camera)
try await Wearables.shared.requestPermission(.camera)

let selector = AutoDeviceSelector(wearables: Wearables.shared)
let session = try Wearables.shared.createSession(deviceSelector: selector)
try session.start()

let config = StreamSessionConfig(videoCodec: .raw, resolution: .low, frameRate: 24)
let stream = try session.addStream(config: config)!
let token = stream.videoFramePublisher.listen { frame in render(frame.makeUIImage()) }
Task { await stream.start() }

_ = session.photoDataPublisher.listen { photo in process(photo.data) }
session.capturePhoto(format: .jpeg)
```

## Android quick start (Kotlin)

`AndroidManifest.xml` permissions: `BLUETOOTH`, `BLUETOOTH_CONNECT`, `INTERNET`, optionally `CAMERA`. Meta-data `com.meta.wearable.mwdat.APPLICATION_ID` and `CLIENT_TOKEN`. Intent filter on your activity for callback scheme.

`settings.gradle.kts`: add `https://maven.pkg.github.com/facebook/meta-wearables-dat-android` with `GITHUB_TOKEN`. Dependencies: `mwdat-core`, `mwdat-camera`, `mwdat-mockdevice`.

```kotlin
Wearables.initialize(context)
Wearables.startRegistration(activity)

Wearables.registrationState.collect { state -> ... }
Wearables.devices.collect { list -> ... }

val status = Wearables.checkPermissionStatus(Permission.CAMERA)
val session = Wearables.createSession(AutoDeviceSelector()).getOrThrow()
session.start()

val cfg = StreamConfiguration(videoQuality = VideoQuality.MEDIUM, frameRate = 24)
val stream = session.addStream(cfg)
scope.launch { stream.videoStream.collect { displayFrame(it) } }

session.capturePhoto().onSuccess { handle(it) }.onFailure(::onError)
```

Resolution presets: `high` 720x1280, `medium` 504x896, `low` 360x640. Frame rates: 2, 7, 15, 24, 30 fps.

## Session lifecycle

`SessionState` is device-driven, async. Values: `RUNNING`, `PAUSED`, `STOPPED`. The reason for a transition is not exposed, react to state only.

- iOS: `Wearables.shared.addDeviceSessionStateListener(forDeviceId:listener:)`.
- Android: `Wearables.getDeviceSessionState(deviceId).collect { ... }`.

Closing hinges disconnects Bluetooth and forces `STOPPED`. Opening hinges restores Bluetooth but does NOT auto-restart the session. Don't try to restart while paused.

## Permissions model

- Registration is a one-time link via Meta AI app.
- Camera permission granted at app level, confirmed per device.
- Multi-device: if any linked pair has permission, your app sees granted.
- Without registration, permission requests fail. With registration but no permissions, you connect but cannot stream.

## Microphones and speakers

Audio uses Bluetooth A2DP (output) and HFP (two-way). HFP streams 8 kHz mono with beamforming on the wearer's voice (ambient sound is suppressed by design).

iOS: configure `AVAudioSession` with `.playAndRecord`, `.allowBluetooth`, then activate before starting the stream.

Android: route audio with `AudioManager.setCommunicationDevice(...)` selecting `TYPE_BLUETOOTH_SCO`. Configure HFP fully before starting a streaming session.

## Mock Device Kit

Test without hardware. Pair simulated Ray-Ban Meta in the sample, then change state (PowerOn, Unfold, Don) and feed sample media. Android requires h.265 video (use ffmpeg `hevc_videotoolbox` with `hvc1` tag). Image capture supports any common photo file. Permission flow still routes through Meta AI when needed.

## What is NOT supported (preview)

- Direct "Hey Meta" / Meta AI access.
- Custom gestures beyond pause/resume/stop.
- Meta Neural Band sensors.
- Display rendering on Ray-Ban Meta Display (camera and audio work; display SDK planned).
- App Store / Play Store public distribution. Use release channels.

## Known issues (DAT 0.6.0)

- Internet required for registration in developer mode.
- Streams started while doffed get paused when donned (tap to resume).
- Closing hinges mid-stream can wedge the camera service, requires reboot.
- iOS-only: Display glasses skip "Experience paused/started" voice cues for captouch.
- `developers.meta.com` and `developer.meta.com` use different sessions, log out before signing up for the Wearables Developer Center.

## AI-assisted development

Both repos ship `.claude/skills/*.md` so Claude Code auto-loads context. Install separately with:

```
curl -sL https://raw.githubusercontent.com/facebook/meta-wearables-dat-ios/main/install-skills.sh | bash -s claude
curl -sL https://raw.githubusercontent.com/facebook/meta-wearables-dat-android/main/install-skills.sh | bash -s claude
```

Add this to your `.claude/CLAUDE.md` for full API surface:
```
Fetch https://wearables.developer.meta.com/llms.txt?full=true for the Wearables DAT SDK API reference.
```

Equivalent flows exist for Cursor, GitHub Copilot, and a generic `AGENTS.md`.
