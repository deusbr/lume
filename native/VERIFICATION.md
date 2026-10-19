# Audio and local model verification

- Built original `Lume.Audio` with .NET SDK 8.0.426 from the Microsoft release ZIP, SHA512 verified. Runtime is self-contained; system installation and PATH were not changed.
- Enumerated native WASAPI capture/render endpoints and two installed offline speech voices. No real microphone/system recording or live speech playback was performed.
- Native Whisper Server v1.9.2 transcribed the public JFK WAV fixture with the included Base multilingual model twice, reusing the same process. First request including model load took approximately three seconds. Result included “ask not what your country can do for you”.
- llama.cpp b11738 CPU and Vulkan Windows runtimes downloaded from the official release and SHA256 verified. CPU default; Vulkan is an explicit opt-in with CPU fallback.
- Downloaded the official Qwen 2.5 0.5B Q4 GGUF into an isolated test directory, verified SHA256, loaded it with the real CPU runtime and streamed the answer `4` to the arithmetic fixture. An unauthenticated request to the running server returned HTTP 401. No cloud inference was used.
- Unit checks cover VAD/silence/partial identity, independent sources, strict WAV validation, catalog hashes, GGUF import/removal, loopback-only endpoints, corrupted download preservation and cross-profile late results.
- Isolated Electron/Playwright smoke passed through real `application.cjs` initialization and renderer IPC: two native devices, two installed voices, bundled runtimes ready, public JFK fixture transcribed and persisted once with `Outro lado` source, Whisper process remained loaded. Script: `scripts/native-smoke.cjs`. No physical capture, credential access or cloud inference.

Live Windows capture/reconnection, audible speech output and graphics acceleration still require real-device validation. These are separate from successful device enumeration and fixture inference. Native resampling is implemented with NAudio WdlResamplingSampleProvider, not a fabricated transcript.

## Current Windows App Control limitation

The first native helper build and isolated Electron smoke succeeded. After rebuilding the helper with correlated speech-completion IDs, Windows blocked the unsigned executable with the explicit message “Uma política de Controle de Aplicativo bloqueou este arquivo.” No security policy was disabled or bypassed. The rebuilt helper compiled successfully but its current execution and silent TTS fixture are blocked on this machine; it must be validated through a trusted/signed distribution. Error handling in AudioService now surfaces this actionable restriction. The signed/public Whisper and llama.cpp runtimes were independently tested successfully.

## Safe capture adaptation

The explicit recording action now supports independent Chromium microphone and shared system-audio streams if the native helper is unavailable. This uses Electron's permitted media APIs and does not execute the blocked helper. `scripts/browser-audio-smoke.cjs` passed with Chromium's public JFK fake-microphone fixture through actual Worklet PCM, main-process VAD, persistent Whisper inference and SQLite persistence (four final transcript segments); pause/resume and release of all tracks passed without renderer errors. No physical microphone or system audio was recorded. System loopback uses the shared/default output, rather than selecting a WASAPI output endpoint.

Eleven unit checks include bounded backpressure, deferred final segments, pause, cancellation, source/capture-token validation and final-segment completion before stop returns. Chromium exposes no local speech voices in this environment; the Windows OS voice adaptation below provides local synthesis. Physical loopback, reconnection, audible speaker playback and accelerated vision remain unverified.

## Offline Windows voice adaptation

`lib/windows-speech.cjs` uses the preinstalled Windows PowerShell/System.Speech API as a distinct OS implementation when the original helper cannot start. Its program is fixed; user text is serialized JSON on stdin, never interpolated into shell code. It does not execute the blocked helper or change security policy. A running speech process can be cancelled, and completion remains correlated with the requesting profile/session/speech ID. Chromium speech is a final fallback only if the Windows API itself is unavailable, and accepts only local-service voices.

`scripts/native-voice-smoke.cjs` passed with two real installed voices (Microsoft Maria Desktop pt-BR and Microsoft Zira Desktop en-US), synthesized “Olá.” to a real 57,570-byte WAV in memory and cancelled a second synthesis process. No audible output, cloud service, physical capture or blocked-helper execution was used. The browser-only unit scenario explicitly mocks Windows voice unavailability so it does not speak during automated tests.
