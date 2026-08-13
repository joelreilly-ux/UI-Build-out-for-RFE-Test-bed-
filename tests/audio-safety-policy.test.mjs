import assert from "node:assert/strict";
import test from "node:test";
import {
  OUTPUT_SAFETY_POLICY,
  OutputSafetyCore,
  dbfsToLinear,
  linearToDbfs,
  measureSamplePeakDbfs,
} from "../public/audio-safety-policy.js";

const tolerance = 0.0002;

function mono(values) {
  return [Float32Array.from(values)];
}

function output(length) {
  return [new Float32Array(length)];
}

function sine(frequency, amplitude, frames, sampleRate = 48_000, phase = 0) {
  return Float32Array.from({ length: frames }, (_, index) => amplitude * Math.sin(2 * Math.PI * frequency * index / sampleRate + phase));
}

test("sample-peak calibration maps known normalized amplitudes to dBFS", () => {
  assert.ok(Math.abs(measureSamplePeakDbfs(mono([1, -1])) - 0) < tolerance);
  assert.ok(Math.abs(measureSamplePeakDbfs(mono([0.5, -0.5])) - -6.0205999) < tolerance);
  assert.ok(Math.abs(measureSamplePeakDbfs(mono([0.25, -0.25])) - -12.0411998) < tolerance);
  assert.equal(measureSamplePeakDbfs(mono([0, 0])), Number.NEGATIVE_INFINITY);
});

test("known digital sums are measured from resulting samples rather than control values", () => {
  const first = sine(1_000, 0.25, 4_800);
  const second = sine(1_000, 0.25, 4_800);
  const summed = Float32Array.from(first, (sample, index) => sample + second[index]);
  assert.ok(Math.abs(measureSamplePeakDbfs([summed]) - -6.0205999) < 0.001);
});

test("sample limiter bounds final output at the configured -6 dBFS fence", () => {
  const core = new OutputSafetyCore(48_000);
  const destination = output(256);
  core.process(mono(Array(256).fill(8)), destination);
  const peak = Math.max(...destination[0].map(Math.abs));
  assert.ok(peak <= dbfsToLinear(OUTPUT_SAFETY_POLICY.ceilingDbfs) + 1e-7);
  assert.ok(linearToDbfs(peak) <= OUTPUT_SAFETY_POLICY.ceilingDbfs + tolerance);
  assert.equal(core.state, "OVERLOAD");
  assert.ok(core.reductionDb < 0);
});

test("non-finite audio latches fail-closed safety mute until deliberate reset", () => {
  const core = new OutputSafetyCore(48_000);
  const destination = output(4);
  core.process(mono([0.1, Number.NaN, 0.1, 0.1]), destination);
  assert.deepEqual([...destination[0]], [0, 0, 0, 0]);
  assert.equal(core.state, "SAFETY MUTE");
  assert.equal(core.muteReason, "NON-FINITE AUDIO SAMPLE");
  core.process(mono([0.1, 0.1, 0.1, 0.1]), destination);
  assert.deepEqual([...destination[0]], [0, 0, 0, 0]);
  core.resetSafetyMute();
  core.process(mono([0.1, 0.1, 0.1, 0.1]), destination);
  assert.ok(destination[0].some((sample) => sample !== 0));
});

test("peak hold and limiter reduction release predictably after signal removal", () => {
  const core = new OutputSafetyCore(48_000);
  const loudOutput = output(4_800);
  core.process(mono(Array(4_800).fill(1)), loudOutput);
  const heldPeak = core.peakHold;
  assert.ok(core.reductionDb < 0);
  const silentBlock = mono(Array(4_800).fill(0));
  for (let index = 0; index < 40; index += 1) core.process(silentBlock, output(4_800));
  assert.ok(core.currentGain > 0.999);
  assert.ok(Math.abs(core.reductionDb) < 1e-10);
  assert.equal(core.state, "NORMAL");
  assert.ok(core.peakHold <= heldPeak);
});

test("43/53/56 Hz engineering fixture remains a digital-only summed analysis", () => {
  const frames = 48_000 * 2;
  const tones = [sine(43, 0.08, frames), sine(53, 0.08, frames), sine(56, 0.08, frames)];
  const summed = Float32Array.from(tones[0], (sample, index) => sample + tones[1][index] + tones[2][index]);
  const unprotectedPeakDbfs = measureSamplePeakDbfs([summed]);
  assert.ok(unprotectedPeakDbfs > -13 && unprotectedPeakDbfs < -12);
  const core = new OutputSafetyCore(48_000);
  const destination = output(frames);
  core.process([summed], destination);
  assert.ok(measureSamplePeakDbfs(destination) <= OUTPUT_SAFETY_POLICY.ceilingDbfs + tolerance);
});

test("waveform fixtures preserve expected amplitude, frequency, and period/sample relationship", () => {
  const sampleRate = 48_000;
  const frequency = 1_000;
  const amplitude = 0.25;
  const data = sine(frequency, amplitude, 480, sampleRate);
  assert.ok(Math.abs(measureSamplePeakDbfs([data]) - linearToDbfs(amplitude)) < 0.001);
  assert.ok(Math.abs(data[0]) < tolerance);
  assert.ok(Math.abs(data[12] - amplitude) < tolerance);
  assert.ok(Math.abs(data[24]) < tolerance);
  assert.ok(Math.abs(data[48]) < tolerance);
});

test("near and separated multi-sine fixtures expose real beating and bounded output", () => {
  const frames = 48_000;
  for (const frequencies of [[440, 441], [220, 880]]) {
    const first = sine(frequencies[0], 0.18, frames);
    const second = sine(frequencies[1], 0.18, frames);
    const summed = Float32Array.from(first, (sample, index) => sample + second[index]);
    const core = new OutputSafetyCore(48_000);
    const destination = output(frames);
    core.process([summed], destination);
    assert.ok(measureSamplePeakDbfs(destination) <= OUTPUT_SAFETY_POLICY.ceilingDbfs + tolerance);
    assert.ok(measureSamplePeakDbfs([summed]) > linearToDbfs(0.18));
  }
});
