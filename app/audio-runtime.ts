import type { ChannelId } from "./channel-routing";
import type { ThreadChannel } from "./channel-routing";
import { diagnosticMeterEnabled, getAudioDiagnosticMode } from "./audio-diagnostics.ts";

export const AUDIO_FREQUENCY_MIN = 50;
export const AUDIO_FREQUENCY_MAX = 10_000;
export const AUDIO_DEFAULT_FREQUENCY = 78;
export const AUDIO_DEFAULT_LEVEL = 20;
export const LIVE_TRIM_MIN = -100;
export const LIVE_TRIM_MAX = 16;
const CHANNEL_GAIN_MAX = 0.2;
const MASTER_GAIN = 0.8;
export const LIVE_AUDIO_RAMP_SECONDS = 0.02;
export const OUTPUT_SAFETY_CEILING_DBFS = -6;
export const OUTPUT_SAFETY_CAUTION_DBFS = -9;
export const OUTPUT_METER_RATE_HZ = 30;

export type AudioAvailability = "unavailable" | "ready" | "active" | "stopped" | "error";

export type AudioChannelSnapshot = Readonly<{
  channelId: ChannelId;
  frequency: number;
  level: number;
  liveTrim: number;
  effectiveLevel: number;
  pan: number;
  routable: boolean;
  active: boolean;
  availability: AudioAvailability;
  message: string;
}>;

export type AudioRuntimeDiagnostics = Readonly<{
  runtimeCreations: number;
  contextCreations: number;
  masterCreations: number;
  channelCreations: number;
  channelDisposals: number;
  analyserCreations: number;
  analyserDisposals: number;
  pannerCreations: number;
  pannerDisposals: number;
  sessionGateCreations: number;
  smoothingRamps: number;
  activeChannels: number;
  sourceCreations: number;
  sourceDisposals: number;
  activeSources: number;
  safetyCreations: number;
  safetyDisposals: number;
  finalAnalyserCreations: number;
  finalAnalyserDisposals: number;
  knownSources: number;
  runtimeListeners: number;
  safetyListeners: number;
}>;

export type MasterSafetyState = "NORMAL" | "CAUTION" | "LIMITING" | "OVERLOAD" | "SAFETY MUTE" | "RESET REQUESTED";

export type MasterSafetySnapshot = Readonly<{
  currentPeakDbfs: number;
  peakHoldDbfs: number;
  reductionDb: number;
  inputPeakDbfs: number;
  state: MasterSafetyState;
  muteReason: string;
  available: boolean;
  meterRateHz: number;
}>;

type AudioParamLike = {
  value: number;
  cancelScheduledValues(time: number): void;
  setValueAtTime(value: number, time: number): void;
  linearRampToValueAtTime(value: number, time: number): void;
};

type AudioNodeLike = {
  connect(destination: AudioNodeLike): AudioNodeLike | void;
  disconnect(): void;
};
type MessagePortLike = {
  onmessage: ((event: { data?: unknown }) => void) | null;
  postMessage(message: unknown): void;
  close?(): void;
};
type SafetyNodeLike = AudioNodeLike & { input?: AudioNodeLike; port: MessagePortLike };

type GainNodeLike = AudioNodeLike & { gain: AudioParamLike };
type StereoPannerNodeLike = AudioNodeLike & { pan: AudioParamLike };
type AnalyserNodeLike = AudioNodeLike & {
  fftSize: number;
  smoothingTimeConstant: number;
  frequencyBinCount: number;
  getFloatTimeDomainData(data: Float32Array): void;
};
type OscillatorNodeLike = AudioNodeLike & {
  type: OscillatorType;
  frequency: AudioParamLike;
  onended: ((event: Event) => void) | null;
  start(): void;
  stop(when?: number): void;
};
type AudioContextLike = {
  currentTime: number;
  state: AudioContextState;
  destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createAnalyser(): AnalyserNodeLike;
  createOscillator(): OscillatorNodeLike;
  createStereoPanner(): StereoPannerNodeLike;
  resume(): Promise<void>;
  close(): Promise<void>;
};

export type AudioContextFactory = () => AudioContextLike;
export type SafetyNodeFactory = (context: AudioContextLike) => Promise<SafetyNodeLike>;

type ChannelAudioInstance = {
  id: ChannelId;
  sourceId: ChannelId;
  gain: GainNodeLike;
  liveTrimGain: GainNodeLike;
  analyser: AnalyserNodeLike;
  panner: StereoPannerNodeLike;
  source: OscillatorNodeLike | null;
  sourceEnvelope: GainNodeLike | null;
  frequency: number;
  level: number;
  liveTrim: number;
  pan: number;
  routable: boolean;
  active: boolean;
  availability: AudioAvailability;
  message: string;
};

type SourceAudioInstance = {
  id: ChannelId;
  source: OscillatorNodeLike | null;
  envelope: GainNodeLike | null;
  frequency: number;
  level: number;
  active: boolean;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function getDefaultChannelFrequency(channelId: ChannelId) {
  const sequence = Number.parseInt(channelId.replace("channel-", ""), 10);
  if (!Number.isFinite(sequence) || sequence < 1) return AUDIO_DEFAULT_FREQUENCY;
  return Math.round(clamp(AUDIO_DEFAULT_FREQUENCY * 2 ** ((sequence - 1) / 2), AUDIO_FREQUENCY_MIN, AUDIO_FREQUENCY_MAX));
}

export type SessionPlaybackState = "playing" | "paused" | "stopped";

export function liveTrimMultiplier(liveTrim: number) {
  return 1 + clamp(finiteNumber(liveTrim, 0), LIVE_TRIM_MIN, LIVE_TRIM_MAX) / 100;
}

export function spatialXToPan(x: number) {
  return clamp(finiteNumber(x, 0) / 2, -1, 1);
}

function ramp(parameter: AudioParamLike, value: number, now: number) {
  parameter.cancelScheduledValues(now);
  parameter.setValueAtTime(finiteNumber(parameter.value, 0), now);
  parameter.linearRampToValueAtTime(value, now + LIVE_AUDIO_RAMP_SECONDS);
}

function browserAudioContextFactory(): AudioContextLike {
  const AudioContextConstructor = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) throw new Error("Audio output is unavailable in this browser");
  return new AudioContextConstructor();
}

async function browserSafetyNodeFactory(context: AudioContextLike): Promise<SafetyNodeLike> {
  const browserContext = context as AudioContext;
  const diagnosticMode = getAudioDiagnosticMode();
  if (diagnosticMode === "native-fence" || diagnosticMode === "native-fence-scope") {
    const input = browserContext.createGain();
    const compressor = browserContext.createDynamicsCompressor();
    const fence = browserContext.createWaveShaper();
    compressor.threshold.value = -9;
    compressor.knee.value = 0;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.12;
    const ceiling = 10 ** (OUTPUT_SAFETY_CEILING_DBFS / 20);
    fence.curve = Float32Array.from({ length: 65_537 }, (_, index) => {
      const sample = index / 65_536 * 2 - 1;
      return Math.max(-ceiling, Math.min(ceiling, sample));
    });
    fence.oversample = "none";
    input.connect(compressor);
    compressor.connect(fence);
    const port: MessagePortLike = { onmessage: null, postMessage() {}, close() {} };
    return {
      input,
      port,
      connect(destination) { fence.connect(destination as unknown as AudioNode); return destination; },
      disconnect() { input.disconnect(); compressor.disconnect(); fence.disconnect(); },
    };
  }
  if (!browserContext.audioWorklet || typeof globalThis.AudioWorkletNode === "undefined") {
    throw new Error("Required output safety processor is unavailable; audio remains disconnected");
  }
  await browserContext.audioWorklet.addModule("/audio-safety-worklet.js");
  return new AudioWorkletNode(browserContext, "rfe-output-safety", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "clamped-max",
    channelInterpretation: "speakers",
    processorOptions: {
      meterReportingEnabled: diagnosticMeterEnabled(diagnosticMode),
      safetyMode: diagnosticMode === "minimal-fence" ? "minimal-fence" : "full",
    },
  }) as unknown as SafetyNodeLike;
}

export class ApplicationAudioRuntime {
  private readonly createContext: AudioContextFactory;
  private readonly createSafetyNode: SafetyNodeFactory;
  private context: AudioContextLike | null = null;
  private master: GainNodeLike | null = null;
  private sessionGate: GainNodeLike | null = null;
  private safetyNode: SafetyNodeLike | null = null;
  private finalAnalyser: AnalyserNodeLike | null = null;
  private infrastructurePromise: Promise<void> | null = null;
  private sessionPlaybackState: SessionPlaybackState = "playing";
  private channels = new Map<ChannelId, ChannelAudioInstance>();
  private sources = new Map<ChannelId, SourceAudioInstance>();
  private sourceIds = new Map<ChannelId, ChannelId>();
  private configurations = new Map<ChannelId, { frequency: number; level: number; liveTrim: number; pan: number; routable: boolean }>();
  private failures = new Map<ChannelId, string>();
  private listeners = new Set<() => void>();
  private masterSafetyListeners = new Set<() => void>();
  private safetyResetSequence = 0;
  private pendingSafetyReset: number | null = null;
  private masterSafety: MasterSafetySnapshot = {
    currentPeakDbfs: Number.NEGATIVE_INFINITY,
    peakHoldDbfs: Number.NEGATIVE_INFINITY,
    reductionDb: 0,
    inputPeakDbfs: Number.NEGATIVE_INFINITY,
    state: "NORMAL",
    muteReason: "",
    available: false,
    meterRateHz: OUTPUT_METER_RATE_HZ,
  };
  private diagnostics: AudioRuntimeDiagnostics = {
    runtimeCreations: 1,
    contextCreations: 0,
    masterCreations: 0,
    channelCreations: 0,
    channelDisposals: 0,
    analyserCreations: 0,
    analyserDisposals: 0,
    pannerCreations: 0,
    pannerDisposals: 0,
    sessionGateCreations: 0,
    smoothingRamps: 0,
    activeChannels: 0,
    sourceCreations: 0,
    sourceDisposals: 0,
    activeSources: 0,
    safetyCreations: 0,
    safetyDisposals: 0,
    finalAnalyserCreations: 0,
    finalAnalyserDisposals: 0,
    knownSources: 0,
    runtimeListeners: 0,
    safetyListeners: 0,
  };

  constructor(createContext: AudioContextFactory = browserAudioContextFactory, createSafetyNode: SafetyNodeFactory = browserSafetyNodeFactory) {
    this.createContext = createContext;
    this.createSafetyNode = createSafetyNode;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  subscribeMasterSafety = (listener: () => void) => {
    this.masterSafetyListeners.add(listener);
    return () => { this.masterSafetyListeners.delete(listener); };
  };

  getChannelSnapshot(channelId: ChannelId): AudioChannelSnapshot {
    const channel = this.channels.get(channelId);
    const sourceId = this.getSourceId(channelId);
    const source = this.sources.get(sourceId);
    const sourceConfiguration = this.configurations.get(sourceId);
    return channel ? {
      channelId,
      frequency: source?.frequency ?? sourceConfiguration?.frequency ?? channel.frequency,
      level: source?.level ?? sourceConfiguration?.level ?? channel.level,
      liveTrim: channel.liveTrim,
      effectiveLevel: channel.routable ? channel.level * liveTrimMultiplier(channel.liveTrim) : 0,
      pan: channel.pan,
      routable: channel.routable,
      active: source?.active ?? channel.active,
      availability: channel.availability,
      message: channel.message,
    } : {
      channelId,
      frequency: source?.frequency ?? sourceConfiguration?.frequency ?? getDefaultChannelFrequency(sourceId),
      level: source?.level ?? sourceConfiguration?.level ?? AUDIO_DEFAULT_LEVEL,
      liveTrim: this.configurations.get(channelId)?.liveTrim ?? 0,
      effectiveLevel: (this.configurations.get(channelId)?.routable ?? true) ? (this.configurations.get(channelId)?.level ?? AUDIO_DEFAULT_LEVEL) * liveTrimMultiplier(this.configurations.get(channelId)?.liveTrim ?? 0) : 0,
      pan: this.configurations.get(channelId)?.pan ?? 0,
      routable: this.configurations.get(channelId)?.routable ?? true,
      active: source?.active ?? false,
      availability: this.failures.has(channelId) ? "error" : typeof globalThis.AudioContext === "undefined" && typeof (globalThis as typeof globalThis & { webkitAudioContext?: unknown }).webkitAudioContext === "undefined" ? "unavailable" : "ready",
      message: this.failures.get(channelId) ?? "Ready to start",
    };
  }

  getDiagnostics() {
    return {
      ...this.diagnostics,
      knownSources: this.sources.size,
      runtimeListeners: this.listeners.size,
      safetyListeners: this.masterSafetyListeners.size,
    };
  }

  getMasterSafetySnapshot() {
    return { ...this.masterSafety };
  }

  resetSafetyMute() {
    if (this.masterSafety.state !== "SAFETY MUTE") return;
    const requestId = ++this.safetyResetSequence;
    this.pendingSafetyReset = requestId;
    this.safetyNode?.port.postMessage({ type: "reset-safety-mute", requestId });
    this.masterSafety = { ...this.masterSafety, state: "RESET REQUESTED", muteReason: "AWAITING AUDIO ENGINE CONFIRMATION" };
    this.emitMasterSafety();
  }

  getContextIdentity() {
    return this.context;
  }

  getSessionPlaybackState() {
    return this.sessionPlaybackState;
  }

  getActiveChannelIds() {
    return [...this.channels.values()].filter((channel) => this.sources.get(channel.sourceId)?.active).map((channel) => channel.id);
  }

  getSoundingChannelIds() {
    if (this.sessionPlaybackState !== "playing") return [];
    return [...this.channels.values()]
      .filter((channel) => this.sources.get(channel.sourceId)?.active && channel.routable && channel.level > 0 && liveTrimMultiplier(channel.liveTrim) > 0)
      .map((channel) => channel.id);
  }

  synchronizeChannels(channelIds: readonly ChannelId[]) {
    const activeIds = new Set(channelIds);
    const knownIds = new Set([...this.channels.keys(), ...this.configurations.keys(), ...this.failures.keys()]);
    let changed = false;
    knownIds.forEach((channelId) => {
      if (activeIds.has(channelId)) return;
      if (this.channels.has(channelId)) this.disposeChannel(channelId);
      else {
        changed = this.configurations.delete(channelId) || this.failures.delete(channelId) || changed;
      }
    });
    if (changed) this.emit();
  }

  synchronizeTopology(channels: readonly Pick<ThreadChannel, "id" | "sourceId">[]) {
    const previous = new Map(this.sourceIds);
    this.sourceIds = new Map(channels.map((channel) => [channel.id, channel.sourceId ?? channel.id]));
    this.synchronizeChannels(channels.map((channel) => channel.id));
    channels.forEach((channel) => {
      const sourceId = channel.sourceId ?? channel.id;
      if (!this.configurations.has(sourceId)) this.getOrCreateConfiguration(sourceId);
      if (previous.get(channel.id) !== sourceId && this.channels.has(channel.id)) this.disposeChannel(channel.id);
      if (channel.id !== sourceId && this.sources.get(sourceId)?.active) this.ensureChannel(channel.id);
    });
    new Set(this.sourceIds.values()).forEach((sourceId) => this.updateFamilyProgrammedGain(sourceId));
  }

  async startChannel(channelId: ChannelId) {
    try {
      await this.ensureInfrastructure();
      const channel = this.ensureChannel(channelId);
      const sourceId = channel.sourceId;
      const existingSource = this.sources.get(sourceId);
      if (existingSource?.active && existingSource.source) return;
      if (this.context!.state === "suspended") await this.context!.resume();
      this.sourceIds.forEach((mappedSourceId, endpointId) => { if (mappedSourceId === sourceId) this.ensureChannel(endpointId); });

      const source = this.context!.createOscillator();
      const envelope = this.context!.createGain();
      const programming = this.getOrCreateConfiguration(sourceId);
      source.type = "sine";
      source.frequency.setValueAtTime(programming.frequency, this.context!.currentTime);
      envelope.gain.setValueAtTime(0, this.context!.currentTime);
      source.connect(envelope);
      this.channels.forEach((endpoint) => { if (endpoint.sourceId === sourceId) envelope.connect(endpoint.gain); });
      this.smooth(envelope.gain, 1);
      source.onended = () => {
        source.disconnect();
        envelope.disconnect();
        this.diagnostics = { ...this.diagnostics, sourceDisposals: this.diagnostics.sourceDisposals + 1 };
      };
      source.start();
      this.sources.set(sourceId, { id: sourceId, source, envelope, frequency: programming.frequency, level: programming.level, active: true });
      this.channels.forEach((endpoint) => { if (endpoint.sourceId === sourceId) { endpoint.active = true; endpoint.availability = "active"; endpoint.message = "Shared sine signal active"; } });
      this.failures.delete(sourceId);
      this.diagnostics = { ...this.diagnostics, sourceCreations: this.diagnostics.sourceCreations + 1, activeSources: this.diagnostics.activeSources + 1 };
      this.emit();
    } catch (error) {
      const channel = this.channels.get(channelId);
      if (channel) {
        channel.active = false;
        channel.availability = "error";
        channel.message = error instanceof Error ? error.message : "Audio could not start";
      } else this.failures.set(channelId, error instanceof Error ? error.message : "Audio could not start");
      this.emit();
    }
  }

  stopChannel(channelId: ChannelId) {
    const sourceId = this.getSourceId(channelId);
    const sourceState = this.sources.get(sourceId);
    if (!sourceState?.source || !this.context) return;
    const source = sourceState.source;
    const envelope = sourceState.envelope;
    if (envelope) this.smooth(envelope.gain, 0);
    source.stop(this.context.currentTime + LIVE_AUDIO_RAMP_SECONDS);
    sourceState.source = null;
    sourceState.envelope = null;
    sourceState.active = false;
    this.channels.forEach((endpoint) => { if (endpoint.sourceId === sourceId) { endpoint.active = false; endpoint.availability = "stopped"; endpoint.message = "Signal stopped at source"; } });
    this.diagnostics = { ...this.diagnostics, activeSources: Math.max(0, this.diagnostics.activeSources - 1) };
    this.emit();
  }

  async restartChannel(channelId: ChannelId) {
    this.stopChannel(channelId);
    await this.startChannel(channelId);
  }

  setFrequency(channelId: ChannelId, frequency: number) {
    channelId = this.getSourceId(channelId);
    const currentFrequency = this.configurations.get(channelId)?.frequency ?? getDefaultChannelFrequency(channelId);
    const safeFrequency = Math.round(clamp(finiteNumber(frequency, currentFrequency), AUDIO_FREQUENCY_MIN, AUDIO_FREQUENCY_MAX));
    const channel = this.channels.get(channelId);
    const configuration = this.getOrCreateConfiguration(channelId);
    this.configurations.set(channelId, { ...configuration, frequency: safeFrequency });
    if (!channel) { this.emit(); return; }
    channel.frequency = safeFrequency;
    const source = this.sources.get(channelId);
    if (source) source.frequency = safeFrequency;
    if (source?.source && this.context) this.smooth(source.source.frequency, safeFrequency);
    this.emit();
  }

  setLevel(channelId: ChannelId, level: number) {
    channelId = this.getSourceId(channelId);
    const currentLevel = this.configurations.get(channelId)?.level ?? AUDIO_DEFAULT_LEVEL;
    const safeLevel = Math.round(clamp(finiteNumber(level, currentLevel), 0, 100));
    const configuration = this.getOrCreateConfiguration(channelId);
    this.configurations.set(channelId, { ...configuration, level: safeLevel });
    const source = this.sources.get(channelId);
    if (source) source.level = safeLevel;
    this.channels.forEach((endpoint) => {
      if (endpoint.sourceId !== channelId) return;
      endpoint.level = safeLevel;
      if (this.context) this.smooth(endpoint.gain.gain, safeLevel / 100 * CHANNEL_GAIN_MAX * this.getFamilyGainScale(channelId));
    });
    this.emit();
  }

  setLiveTrim(channelId: ChannelId, liveTrim: number) {
    const currentTrim = this.configurations.get(channelId)?.liveTrim ?? 0;
    const safeLiveTrim = Math.round(clamp(finiteNumber(liveTrim, currentTrim), LIVE_TRIM_MIN, LIVE_TRIM_MAX));
    const configuration = this.getOrCreateConfiguration(channelId);
    this.configurations.set(channelId, { ...configuration, liveTrim: safeLiveTrim });
    const channel = this.channels.get(channelId);
    if (channel) {
      channel.liveTrim = safeLiveTrim;
      if (this.context) this.smooth(channel.liveTrimGain.gain, channel.routable ? liveTrimMultiplier(safeLiveTrim) : 0);
    }
    this.emit();
  }

  setChannelRoutable(channelId: ChannelId, routable: boolean) {
    routable = routable === true;
    const configuration = this.getOrCreateConfiguration(channelId);
    const channel = this.channels.get(channelId);
    if (configuration.routable === routable && (!channel || channel.routable === routable)) return;
    this.configurations.set(channelId, { ...configuration, routable });
    if (channel) {
      channel.routable = routable;
      if (this.context) this.smooth(channel.liveTrimGain.gain, routable ? liveTrimMultiplier(channel.liveTrim) : 0);
    }
    this.emit();
  }

  setSpatialX(channelId: ChannelId, x: number) {
    const pan = spatialXToPan(x);
    const configuration = this.getOrCreateConfiguration(channelId);
    this.configurations.set(channelId, { ...configuration, pan });
    const channel = this.channels.get(channelId);
    if (channel) {
      channel.pan = pan;
      if (this.context) this.smooth(channel.panner.pan, pan);
    }
    this.emit();
  }

  playSession() {
    this.sessionPlaybackState = "playing";
    if (this.sessionGate && this.context) this.smooth(this.sessionGate.gain, 1);
    this.emit();
  }

  pauseSession() {
    this.sessionPlaybackState = "paused";
    if (this.sessionGate && this.context) this.smooth(this.sessionGate.gain, 0);
    this.emit();
  }

  stopSession() {
    this.sessionPlaybackState = "stopped";
    if (this.sessionGate && this.context) this.smooth(this.sessionGate.gain, 0);
    this.emit();
  }

  getWaveform(channelId: ChannelId, target = new Float32Array(256)): Float32Array | null {
    const channel = this.channels.get(channelId);
    if (!channel || !this.sources.get(channel.sourceId)?.active) return null;
    const data = target.length === channel.analyser.frequencyBinCount ? target : new Float32Array(channel.analyser.frequencyBinCount);
    channel.analyser.getFloatTimeDomainData(data);
    return data;
  }

  getMasterWaveform(target = new Float32Array(512)): Float32Array | null {
    if (!this.finalAnalyser || this.sessionPlaybackState !== "playing") return null;
    const data = target.length === this.finalAnalyser.frequencyBinCount ? target : new Float32Array(this.finalAnalyser.frequencyBinCount);
    this.finalAnalyser.getFloatTimeDomainData(data);
    return data;
  }

  disposeChannel(channelId: ChannelId) {
    const channel = this.channels.get(channelId);
    if (!channel) return;
    if (channel.id === channel.sourceId) this.stopChannel(channelId);
    channel.analyser.disconnect();
    channel.panner.disconnect();
    channel.liveTrimGain.disconnect();
    channel.gain.disconnect();
    const source = this.sources.get(channel.sourceId);
    source?.envelope?.disconnect();
    if (source?.envelope) this.channels.forEach((endpoint) => { if (endpoint.id !== channelId && endpoint.sourceId === channel.sourceId) source.envelope!.connect(endpoint.gain); });
    this.channels.delete(channelId);
    this.configurations.delete(channelId);
    this.failures.delete(channelId);
    this.sourceIds.delete(channelId);
    const familyRemains = [...this.channels.values()].some((endpoint) => endpoint.sourceId === channel.sourceId);
    if (familyRemains) this.updateFamilyProgrammedGain(channel.sourceId);
    else {
      this.sources.delete(channel.sourceId);
      this.configurations.delete(channel.sourceId);
    }
    this.diagnostics = {
      ...this.diagnostics,
      channelDisposals: this.diagnostics.channelDisposals + 1,
      analyserDisposals: this.diagnostics.analyserDisposals + 1,
      pannerDisposals: this.diagnostics.pannerDisposals + 1,
      activeChannels: Math.max(0, this.diagnostics.activeChannels - 1),
    };
    this.emit();
  }

  disposeSource(sourceId: ChannelId) {
    const family = [...this.channels.values()].filter((channel) => channel.sourceId === sourceId).map((channel) => channel.id);
    this.stopChannel(sourceId);
    family.forEach((channelId) => this.disposeChannel(channelId));
    this.sources.delete(sourceId);
    this.configurations.delete(sourceId);
  }

  copyProgramming(fromChannelId: ChannelId, toChannelId: ChannelId) {
    const snapshot = this.getChannelSnapshot(fromChannelId);
    this.setFrequency(toChannelId, snapshot.frequency);
    this.setLevel(toChannelId, snapshot.level);
  }

  async shutdownApplication() {
    const hadSafetyNode = Boolean(this.safetyNode);
    const hadFinalAnalyser = Boolean(this.finalAnalyser);
    for (const channelId of [...this.channels.keys()]) this.disposeChannel(channelId);
    if (this.safetyNode) this.safetyNode.port.onmessage = null;
    this.safetyNode?.port.close?.();
    await this.context?.close();
    this.safetyNode?.disconnect();
    this.finalAnalyser?.disconnect();
    this.context = null;
    this.master = null;
    this.sessionGate = null;
    this.safetyNode = null;
    this.finalAnalyser = null;
    this.infrastructurePromise = null;
    this.sources.clear();
    this.sourceIds.clear();
    this.sessionPlaybackState = "playing";
    this.pendingSafetyReset = null;
    this.masterSafety = { ...this.masterSafety, currentPeakDbfs: Number.NEGATIVE_INFINITY, peakHoldDbfs: Number.NEGATIVE_INFINITY, reductionDb: 0, inputPeakDbfs: Number.NEGATIVE_INFINITY, state: "NORMAL", muteReason: "", available: false };
    this.diagnostics = {
      ...this.diagnostics,
      safetyDisposals: this.diagnostics.safetyDisposals + (hadSafetyNode ? 1 : 0),
      finalAnalyserDisposals: this.diagnostics.finalAnalyserDisposals + (hadFinalAnalyser ? 1 : 0),
    };
    this.emit();
    this.emitMasterSafety();
  }

  private async ensureInfrastructure() {
    if (this.context && this.master && this.sessionGate && this.safetyNode && this.finalAnalyser) return;
    if (this.infrastructurePromise) return this.infrastructurePromise;
    this.infrastructurePromise = (async () => {
      const context = this.createContext();
      this.context = context;
      this.diagnostics = { ...this.diagnostics, contextCreations: this.diagnostics.contextCreations + 1 };
      try {
        const safetyNode = await this.createSafetyNode(context);
        const master = context.createGain();
        const sessionGate = context.createGain();
        const finalAnalyser = context.createAnalyser();
        master.gain.setValueAtTime(MASTER_GAIN, context.currentTime);
        sessionGate.gain.setValueAtTime(this.sessionPlaybackState === "playing" ? 1 : 0, context.currentTime);
        finalAnalyser.fftSize = 1024;
        finalAnalyser.smoothingTimeConstant = 0;
        sessionGate.connect(master);
        master.connect(safetyNode.input ?? safetyNode);
        safetyNode.connect(finalAnalyser);
        finalAnalyser.connect(context.destination);
        safetyNode.port.onmessage = (event) => this.handleSafetyMessage(event.data);
        this.master = master;
        this.sessionGate = sessionGate;
        this.safetyNode = safetyNode;
        this.finalAnalyser = finalAnalyser;
        this.masterSafety = { ...this.masterSafety, available: true };
        this.diagnostics = {
          ...this.diagnostics,
          masterCreations: this.diagnostics.masterCreations + 1,
          sessionGateCreations: this.diagnostics.sessionGateCreations + 1,
          safetyCreations: this.diagnostics.safetyCreations + 1,
          finalAnalyserCreations: this.diagnostics.finalAnalyserCreations + 1,
        };
      } catch (error) {
        await context.close();
        this.context = null;
        throw error;
      }
    })().finally(() => { this.infrastructurePromise = null; });
    return this.infrastructurePromise;
  }

  private ensureChannel(channelId: ChannelId) {
    const existing = this.channels.get(channelId);
    if (existing) return existing;
    if (!this.context || !this.sessionGate || !this.master || !this.safetyNode || !this.finalAnalyser) {
      throw new Error("Authoritative output safety path is not initialized");
    }
    const gain = this.context!.createGain();
    const liveTrimGain = this.context!.createGain();
    const analyser = this.context!.createAnalyser();
    const panner = this.context!.createStereoPanner();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.55;
    const sourceId = this.getSourceId(channelId);
    const endpointConfiguration = this.getOrCreateConfiguration(channelId);
    const sourceConfiguration = this.getOrCreateConfiguration(sourceId);
    gain.gain.setValueAtTime(sourceConfiguration.level / 100 * CHANNEL_GAIN_MAX * this.getFamilyGainScale(sourceId), this.context!.currentTime);
    liveTrimGain.gain.setValueAtTime(endpointConfiguration.routable ? liveTrimMultiplier(endpointConfiguration.liveTrim) : 0, this.context!.currentTime);
    panner.pan.setValueAtTime(endpointConfiguration.pan, this.context!.currentTime);
    gain.connect(liveTrimGain);
    liveTrimGain.connect(analyser);
    analyser.connect(panner);
    panner.connect(this.sessionGate!);
    const source = this.sources.get(sourceId);
    const channel: ChannelAudioInstance = { id: channelId, sourceId, gain, liveTrimGain, analyser, panner, source: null, sourceEnvelope: null, frequency: sourceConfiguration.frequency, level: sourceConfiguration.level, liveTrim: endpointConfiguration.liveTrim, pan: endpointConfiguration.pan, routable: endpointConfiguration.routable, active: source?.active ?? false, availability: source?.active ? "active" : "ready", message: source?.active ? "Shared sine signal active" : "Ready to start" };
    this.channels.set(channelId, channel);
    if (source?.envelope) source.envelope.connect(gain);
    this.diagnostics = {
      ...this.diagnostics,
      channelCreations: this.diagnostics.channelCreations + 1,
      analyserCreations: this.diagnostics.analyserCreations + 1,
      pannerCreations: this.diagnostics.pannerCreations + 1,
      activeChannels: this.diagnostics.activeChannels + 1,
    };
    return channel;
  }

  private getOrCreateConfiguration(channelId: ChannelId) {
    const configuration = this.configurations.get(channelId) ?? { frequency: getDefaultChannelFrequency(channelId), level: AUDIO_DEFAULT_LEVEL, liveTrim: 0, pan: 0, routable: true };
    this.configurations.set(channelId, configuration);
    return configuration;
  }

  private getSourceId(channelId: ChannelId) {
    return this.sourceIds.get(channelId) ?? channelId;
  }

  // Equal-power family normalisation preserves conservative master headroom as
  // one shared signal fans out. Endpoint trim and pan remain fully independent.
  private getFamilyGainScale(sourceId: ChannelId) {
    const endpointCount = Math.max(1, [...this.sourceIds.values()].filter((id) => id === sourceId).length);
    return 1 / Math.sqrt(endpointCount);
  }

  private updateFamilyProgrammedGain(sourceId: ChannelId) {
    if (!this.context) return;
    const level = this.sources.get(sourceId)?.level ?? this.getOrCreateConfiguration(sourceId).level;
    const gain = level / 100 * CHANNEL_GAIN_MAX * this.getFamilyGainScale(sourceId);
    this.channels.forEach((endpoint) => { if (endpoint.sourceId === sourceId) this.smooth(endpoint.gain.gain, gain); });
  }

  private smooth(parameter: AudioParamLike, value: number) {
    if (!this.context) return;
    const safeValue = finiteNumber(value, 0);
    ramp(parameter, safeValue, this.context.currentTime);
    this.diagnostics = { ...this.diagnostics, smoothingRamps: this.diagnostics.smoothingRamps + 1 };
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  private handleSafetyMessage(data: unknown) {
    if (!data || typeof data !== "object") return;
    const report = data as Record<string, unknown>;
    if (report.type !== "safety-meter") return;
    const state = report.state;
    if (state !== "NORMAL" && state !== "CAUTION" && state !== "LIMITING" && state !== "OVERLOAD" && state !== "SAFETY MUTE") return;
    const resetRequestId = finiteNumber(report.resetRequestId, 0);
    if (this.pendingSafetyReset !== null) {
      if (resetRequestId !== this.pendingSafetyReset) return;
      this.pendingSafetyReset = null;
    }
    this.masterSafety = {
      currentPeakDbfs: finiteNumber(report.currentPeakDbfs, Number.NEGATIVE_INFINITY),
      peakHoldDbfs: finiteNumber(report.peakHoldDbfs, Number.NEGATIVE_INFINITY),
      reductionDb: finiteNumber(report.reductionDb, state === "SAFETY MUTE" ? Number.NEGATIVE_INFINITY : 0),
      inputPeakDbfs: finiteNumber(report.inputPeakDbfs, Number.NEGATIVE_INFINITY),
      state,
      muteReason: typeof report.muteReason === "string" ? report.muteReason : "",
      available: true,
      meterRateHz: OUTPUT_METER_RATE_HZ,
    };
    this.emitMasterSafety();
  }

  private emitMasterSafety() {
    this.masterSafetyListeners.forEach((listener) => listener());
  }
}

export const applicationAudioRuntime = new ApplicationAudioRuntime();
