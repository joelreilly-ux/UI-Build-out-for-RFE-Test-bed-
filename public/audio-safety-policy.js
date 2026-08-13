export const OUTPUT_SAFETY_POLICY = Object.freeze({
  cautionDbfs: -9,
  limiterThresholdDbfs: -9,
  limiterRatio: 12,
  ceilingDbfs: -6,
  overloadInputDbfs: -3,
  peakHoldSeconds: 1.5,
  releaseSeconds: 0.12,
});

export function dbfsToLinear(dbfs) {
  return 10 ** (dbfs / 20);
}

export function linearToDbfs(amplitude) {
  return Number.isFinite(amplitude) && amplitude > 0 ? 20 * Math.log10(amplitude) : Number.NEGATIVE_INFINITY;
}

export function measureSamplePeak(channels) {
  let peak = 0;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      const sample = channel[index];
      if (!Number.isFinite(sample)) return Number.NaN;
      peak = Math.max(peak, Math.abs(sample));
    }
  }
  return peak;
}

export function measureSamplePeakDbfs(channels) {
  return linearToDbfs(measureSamplePeak(channels));
}

export class OutputSafetyCore {
  constructor(sampleRate, policy = OUTPUT_SAFETY_POLICY) {
    this.sampleRate = sampleRate;
    this.policy = policy;
    this.ceilingLinear = dbfsToLinear(policy.ceilingDbfs);
    this.currentGain = 1;
    this.currentPeak = 0;
    this.peakHold = 0;
    this.peakHoldFrames = 0;
    this.reductionDb = 0;
    this.inputPeak = 0;
    this.state = "NORMAL";
    this.safetyMuted = false;
    this.muteReason = "";
  }

  resetSafetyMute() {
    this.currentGain = 0;
    this.currentPeak = 0;
    this.peakHold = 0;
    this.peakHoldFrames = 0;
    this.reductionDb = 0;
    this.inputPeak = 0;
    this.state = "NORMAL";
    this.safetyMuted = false;
    this.muteReason = "";
  }

  process(inputChannels, outputChannels) {
    const frameCount = outputChannels[0]?.length ?? inputChannels[0]?.length ?? 0;
    const inputPeak = measureSamplePeak(inputChannels);
    if (!Number.isFinite(inputPeak)) {
      this.safetyMuted = true;
      this.muteReason = "NON-FINITE AUDIO SAMPLE";
    }

    this.inputPeak = Number.isFinite(inputPeak) ? inputPeak : 0;
    if (this.safetyMuted) {
      for (const output of outputChannels) output.fill(0);
      this.currentPeak = 0;
      this.reductionDb = Number.NEGATIVE_INFINITY;
      this.state = "SAFETY MUTE";
      return;
    }

    const inputDbfs = linearToDbfs(inputPeak);
    let targetGain = 1;
    if (inputDbfs > this.policy.limiterThresholdDbfs) {
      const compressedDbfs = this.policy.limiterThresholdDbfs
        + (inputDbfs - this.policy.limiterThresholdDbfs) / this.policy.limiterRatio;
      targetGain = dbfsToLinear(compressedDbfs - inputDbfs);
    }
    if (inputPeak > 0) targetGain = Math.min(targetGain, this.ceilingLinear / inputPeak);
    const releaseProgress = 1 - Math.exp(-frameCount / Math.max(1, this.sampleRate * this.policy.releaseSeconds));
    const releasingGain = this.currentGain + (1 - this.currentGain) * releaseProgress;
    this.currentGain = Math.max(0, Math.min(1, targetGain, releasingGain));

    let outputPeak = 0;
    for (let channelIndex = 0; channelIndex < outputChannels.length; channelIndex += 1) {
      const input = inputChannels[channelIndex] ?? inputChannels[0];
      const output = outputChannels[channelIndex];
      for (let index = 0; index < output.length; index += 1) {
        const inputSample = input?.[index] ?? 0;
        const bounded = Math.max(-this.ceilingLinear, Math.min(this.ceilingLinear, inputSample * this.currentGain));
        output[index] = bounded;
        outputPeak = Math.max(outputPeak, Math.abs(bounded));
      }
    }

    this.currentPeak = outputPeak;
    if (outputPeak >= this.peakHold || this.peakHoldFrames <= 0) {
      this.peakHold = outputPeak;
      this.peakHoldFrames = Math.round(this.policy.peakHoldSeconds * this.sampleRate);
    } else {
      this.peakHoldFrames -= frameCount;
    }
    this.reductionDb = this.currentGain < 1 ? linearToDbfs(this.currentGain) : 0;
    if (inputDbfs >= this.policy.overloadInputDbfs || this.reductionDb <= -6) this.state = "OVERLOAD";
    else if (this.reductionDb < -0.05) this.state = "LIMITING";
    else if (linearToDbfs(outputPeak) >= this.policy.cautionDbfs) this.state = "CAUTION";
    else this.state = "NORMAL";
  }
}
