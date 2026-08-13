import { OutputSafetyCore, linearToDbfs } from "./audio-safety-policy.js";

class RfeOutputSafetyProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.core = new OutputSafetyCore(sampleRate);
    this.reportCountdown = 0;
    this.wasSafetyMuted = false;
    this.port.onmessage = (event) => {
      if (event.data?.type === "reset-safety-mute") this.core.resetSafetyMute();
    };
  }

  process(inputs, outputs) {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    this.core.process(input, output);
    this.reportCountdown -= output[0]?.length ?? 128;
    const safetyMuteJustLatched = this.core.safetyMuted && !this.wasSafetyMuted;
    if (this.reportCountdown <= 0 || safetyMuteJustLatched) {
      this.reportCountdown = Math.max(128, Math.round(sampleRate / 30));
      this.port.postMessage({
        type: "safety-meter",
        currentPeakDbfs: linearToDbfs(this.core.currentPeak),
        peakHoldDbfs: linearToDbfs(this.core.peakHold),
        reductionDb: this.core.reductionDb,
        inputPeakDbfs: linearToDbfs(this.core.inputPeak),
        state: this.core.state,
        muteReason: this.core.muteReason,
      });
    }
    this.wasSafetyMuted = this.core.safetyMuted;
    return true;
  }
}

registerProcessor("rfe-output-safety", RfeOutputSafetyProcessor);
