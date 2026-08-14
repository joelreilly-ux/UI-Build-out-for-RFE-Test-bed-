export type AudioDiagnosticMode = "full" | "no-scope" | "no-meter" | "no-observers" | "minimal-fence" | "native-fence" | "native-fence-scope";

const AUDIO_DIAGNOSTIC_MODES = new Set<AudioDiagnosticMode>(["full", "no-scope", "no-meter", "no-observers", "minimal-fence", "native-fence", "native-fence-scope"]);

export function getAudioDiagnosticMode(): AudioDiagnosticMode {
  if (typeof globalThis.location === "undefined") return "full";
  const requested = new URLSearchParams(globalThis.location.search).get("audioDiagnostic") as AudioDiagnosticMode | null;
  return requested && AUDIO_DIAGNOSTIC_MODES.has(requested) ? requested : "full";
}

export function diagnosticMeterEnabled(mode: AudioDiagnosticMode) {
  return mode !== "no-meter" && mode !== "no-observers" && mode !== "minimal-fence" && mode !== "native-fence" && mode !== "native-fence-scope";
}

export function diagnosticScopeEnabled(mode: AudioDiagnosticMode) {
  return mode !== "no-scope" && mode !== "no-observers" && mode !== "minimal-fence" && mode !== "native-fence";
}
