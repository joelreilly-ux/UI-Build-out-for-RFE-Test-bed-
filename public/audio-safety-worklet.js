import { OutputSafetyCore, linearToDbfs } from "./audio-safety-policy.js";

class RfeOutputSafetyProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.core = new OutputSafetyCore(sampleRate);
    this.meterReportingEnabled = options.processorOptions?.meterReportingEnabled !== false;
    this.safetyMode = options.processorOptions?.safetyMode === "minimal-fence" ? "minimal-fence" : "full";
    this.minimalSafetyMuted = false;
    this.reportCountdown = 0;
    this.wasSafetyMuted = false;
    this.port.onmessage = (event) => {
      if (event.data?.type === "reset-safety-mute") {
        this.core.resetSafetyMute();
        this.minimalSafetyMuted = false;
        if (this.meterReportingEnabled) this.postReport(event.data.requestId);
      }
    };
  }

  postReport(resetRequestId) {
    this.port.postMessage({
      type: "safety-meter",
      currentPeakDbfs: linearToDbfs(this.core.currentPeak),
      peakHoldDbfs: linearToDbfs(this.core.peakHold),
      reductionDb: this.core.reductionDb,
      inputPeakDbfs: linearToDbfs(this.core.inputPeak),
      state: this.core.state,
      muteReason: this.core.muteReason,
      ...(resetRequestId === undefined ? {} : { resetRequestId }),
    });
  }

  process(inputs, outputs) {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    if (this.safetyMode === "minimal-fence") {
      const ceiling = this.core.ceilingLinear;
      for (const channel of input) {
        for (let index = 0; index < channel.length; index += 1) {
          if (!Number.isFinite(channel[index])) this.minimalSafetyMuted = true;
        }
      }
      for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
        const inputChannel = input[channelIndex] ?? input[0];
        const outputChannel = output[channelIndex];
        for (let index = 0; index < outputChannel.length; index += 1) {
          const sample = inputChannel?.[index] ?? 0;
          outputChannel[index] = this.minimalSafetyMuted ? 0 : Math.max(-ceiling, Math.min(ceiling, sample));
        }
      }
      return true;
    }
    this.core.process(input, output);
    this.reportCountdown -= output[0]?.length ?? 128;
    const safetyMuteJustLatched = this.core.safetyMuted && !this.wasSafetyMuted;
    if (this.meterReportingEnabled && (this.reportCountdown <= 0 || safetyMuteJustLatched)) {
      this.reportCountdown = Math.max(128, Math.round(sampleRate / 30));
      this.postReport();
    }
    this.wasSafetyMuted = this.core.safetyMuted;
    return true;
  }
}

registerProcessor("rfe-output-safety", RfeOutputSafetyProcessor);
