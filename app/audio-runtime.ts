import type { ChannelId } from "./channel-routing";

export const AUDIO_FREQUENCY_MIN = 40;
export const AUDIO_FREQUENCY_MAX = 2_000;
export const AUDIO_DEFAULT_FREQUENCY = 78;
export const AUDIO_DEFAULT_LEVEL = 20;
export const LIVE_TRIM_MIN = -100;
export const LIVE_TRIM_MAX = 16;
const CHANNEL_GAIN_MAX = 0.2;
const MASTER_GAIN = 0.8;
export const LIVE_AUDIO_RAMP_SECONDS = 0.02;

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

type ChannelAudioInstance = {
  id: ChannelId;
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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function getDefaultChannelFrequency(channelId: ChannelId) {
  const sequence = Number.parseInt(channelId.replace("channel-", ""), 10);
  if (!Number.isFinite(sequence) || sequence < 1) return AUDIO_DEFAULT_FREQUENCY;
  return Math.round(clamp(AUDIO_DEFAULT_FREQUENCY * 2 ** ((sequence - 1) / 2), AUDIO_FREQUENCY_MIN, AUDIO_FREQUENCY_MAX));
}

export type SessionPlaybackState = "playing" | "paused" | "stopped";

export function liveTrimMultiplier(liveTrim: number) {
  return 1 + clamp(liveTrim, LIVE_TRIM_MIN, LIVE_TRIM_MAX) / 100;
}

export function spatialXToPan(x: number) {
  return clamp(x / 2, -1, 1);
}

function ramp(parameter: AudioParamLike, value: number, now: number) {
  parameter.cancelScheduledValues(now);
  parameter.setValueAtTime(parameter.value, now);
  parameter.linearRampToValueAtTime(value, now + LIVE_AUDIO_RAMP_SECONDS);
}

function browserAudioContextFactory(): AudioContextLike {
  const AudioContextConstructor = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) throw new Error("Audio output is unavailable in this browser");
  return new AudioContextConstructor();
}

export class ApplicationAudioRuntime {
  private readonly createContext: AudioContextFactory;
  private context: AudioContextLike | null = null;
  private master: GainNodeLike | null = null;
  private sessionGate: GainNodeLike | null = null;
  private sessionPlaybackState: SessionPlaybackState = "playing";
  private channels = new Map<ChannelId, ChannelAudioInstance>();
  private configurations = new Map<ChannelId, { frequency: number; level: number; liveTrim: number; pan: number; routable: boolean }>();
  private failures = new Map<ChannelId, string>();
  private listeners = new Set<() => void>();
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
  };

  constructor(createContext: AudioContextFactory = browserAudioContextFactory) {
    this.createContext = createContext;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getChannelSnapshot(channelId: ChannelId): AudioChannelSnapshot {
    const channel = this.channels.get(channelId);
    return channel ? {
      channelId,
      frequency: channel.frequency,
      level: channel.level,
      liveTrim: channel.liveTrim,
      effectiveLevel: channel.routable ? channel.level * liveTrimMultiplier(channel.liveTrim) : 0,
      pan: channel.pan,
      routable: channel.routable,
      active: channel.active,
      availability: channel.availability,
      message: channel.message,
    } : {
      channelId,
      frequency: this.configurations.get(channelId)?.frequency ?? getDefaultChannelFrequency(channelId),
      level: this.configurations.get(channelId)?.level ?? AUDIO_DEFAULT_LEVEL,
      liveTrim: this.configurations.get(channelId)?.liveTrim ?? 0,
      effectiveLevel: (this.configurations.get(channelId)?.routable ?? true) ? (this.configurations.get(channelId)?.level ?? AUDIO_DEFAULT_LEVEL) * liveTrimMultiplier(this.configurations.get(channelId)?.liveTrim ?? 0) : 0,
      pan: this.configurations.get(channelId)?.pan ?? 0,
      routable: this.configurations.get(channelId)?.routable ?? true,
      active: false,
      availability: this.failures.has(channelId) ? "error" : typeof globalThis.AudioContext === "undefined" && typeof (globalThis as typeof globalThis & { webkitAudioContext?: unknown }).webkitAudioContext === "undefined" ? "unavailable" : "ready",
      message: this.failures.get(channelId) ?? "Ready to start",
    };
  }

  getDiagnostics() {
    return { ...this.diagnostics };
  }

  getContextIdentity() {
    return this.context;
  }

  getSessionPlaybackState() {
    return this.sessionPlaybackState;
  }

  getActiveChannelIds() {
    return [...this.channels.values()].filter((channel) => channel.active).map((channel) => channel.id);
  }

  getSoundingChannelIds() {
    if (this.sessionPlaybackState !== "playing") return [];
    return [...this.channels.values()]
      .filter((channel) => channel.active && channel.routable && channel.level > 0 && liveTrimMultiplier(channel.liveTrim) > 0)
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

  async startChannel(channelId: ChannelId) {
    try {
      const channel = this.ensureChannel(channelId);
      if (channel.active && channel.source) return;
      if (this.context!.state === "suspended") await this.context!.resume();

      const source = this.context!.createOscillator();
      const envelope = this.context!.createGain();
      source.type = "sine";
      source.frequency.setValueAtTime(channel.frequency, this.context!.currentTime);
      envelope.gain.setValueAtTime(0, this.context!.currentTime);
      source.connect(envelope);
      envelope.connect(channel.gain);
      this.smooth(envelope.gain, 1);
      source.onended = () => {
        source.disconnect();
        envelope.disconnect();
        this.diagnostics = { ...this.diagnostics, sourceDisposals: this.diagnostics.sourceDisposals + 1 };
      };
      source.start();
      channel.source = source;
      channel.sourceEnvelope = envelope;
      channel.active = true;
      channel.availability = "active";
      channel.message = "Sine signal active";
      this.failures.delete(channelId);
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
    const channel = this.channels.get(channelId);
    if (!channel?.source || !this.context) return;
    const source = channel.source;
    const envelope = channel.sourceEnvelope;
    if (envelope) this.smooth(envelope.gain, 0);
    source.stop(this.context.currentTime + LIVE_AUDIO_RAMP_SECONDS);
    channel.source = null;
    channel.sourceEnvelope = null;
    channel.active = false;
    channel.availability = "stopped";
    channel.message = "Signal stopped";
    this.diagnostics = { ...this.diagnostics, activeSources: Math.max(0, this.diagnostics.activeSources - 1) };
    this.emit();
  }

  async restartChannel(channelId: ChannelId) {
    this.stopChannel(channelId);
    await this.startChannel(channelId);
  }

  setFrequency(channelId: ChannelId, frequency: number) {
    const safeFrequency = Math.round(clamp(frequency, AUDIO_FREQUENCY_MIN, AUDIO_FREQUENCY_MAX));
    const channel = this.channels.get(channelId);
    const configuration = this.getOrCreateConfiguration(channelId);
    this.configurations.set(channelId, { ...configuration, frequency: safeFrequency });
    if (!channel) { this.emit(); return; }
    channel.frequency = safeFrequency;
    if (channel.source && this.context) this.smooth(channel.source.frequency, safeFrequency);
    this.emit();
  }

  setLevel(channelId: ChannelId, level: number) {
    const safeLevel = Math.round(clamp(level, 0, 100));
    const channel = this.channels.get(channelId);
    const configuration = this.getOrCreateConfiguration(channelId);
    this.configurations.set(channelId, { ...configuration, level: safeLevel });
    if (!channel) { this.emit(); return; }
    channel.level = safeLevel;
    if (this.context) this.smooth(channel.gain.gain, safeLevel / 100 * CHANNEL_GAIN_MAX);
    this.emit();
  }

  setLiveTrim(channelId: ChannelId, liveTrim: number) {
    const safeLiveTrim = Math.round(clamp(liveTrim, LIVE_TRIM_MIN, LIVE_TRIM_MAX));
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
    if (!channel?.active) return null;
    const data = target.length === channel.analyser.frequencyBinCount ? target : new Float32Array(channel.analyser.frequencyBinCount);
    channel.analyser.getFloatTimeDomainData(data);
    return data;
  }

  disposeChannel(channelId: ChannelId) {
    const channel = this.channels.get(channelId);
    if (!channel) return;
    this.stopChannel(channelId);
    channel.analyser.disconnect();
    channel.panner.disconnect();
    channel.liveTrimGain.disconnect();
    channel.gain.disconnect();
    this.channels.delete(channelId);
    this.configurations.delete(channelId);
    this.failures.delete(channelId);
    this.diagnostics = {
      ...this.diagnostics,
      channelDisposals: this.diagnostics.channelDisposals + 1,
      analyserDisposals: this.diagnostics.analyserDisposals + 1,
      pannerDisposals: this.diagnostics.pannerDisposals + 1,
      activeChannels: Math.max(0, this.diagnostics.activeChannels - 1),
    };
    this.emit();
  }

  async shutdownApplication() {
    for (const channelId of [...this.channels.keys()]) this.disposeChannel(channelId);
    await this.context?.close();
    this.context = null;
    this.master = null;
    this.sessionGate = null;
    this.sessionPlaybackState = "playing";
    this.emit();
  }

  private ensureInfrastructure() {
    if (this.context && this.master && this.sessionGate) return;
    this.context = this.createContext();
    this.diagnostics = { ...this.diagnostics, contextCreations: this.diagnostics.contextCreations + 1 };
    this.master = this.context.createGain();
    this.master.gain.setValueAtTime(MASTER_GAIN, this.context.currentTime);
    this.master.connect(this.context.destination);
    this.sessionGate = this.context.createGain();
    this.sessionGate.gain.setValueAtTime(this.sessionPlaybackState === "playing" ? 1 : 0, this.context.currentTime);
    this.sessionGate.connect(this.master);
    this.diagnostics = { ...this.diagnostics, masterCreations: this.diagnostics.masterCreations + 1, sessionGateCreations: this.diagnostics.sessionGateCreations + 1 };
  }

  private ensureChannel(channelId: ChannelId) {
    const existing = this.channels.get(channelId);
    if (existing) return existing;
    this.ensureInfrastructure();
    const gain = this.context!.createGain();
    const liveTrimGain = this.context!.createGain();
    const analyser = this.context!.createAnalyser();
    const panner = this.context!.createStereoPanner();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.55;
    const configuration = this.getOrCreateConfiguration(channelId);
    gain.gain.setValueAtTime(configuration.level / 100 * CHANNEL_GAIN_MAX, this.context!.currentTime);
    liveTrimGain.gain.setValueAtTime(configuration.routable ? liveTrimMultiplier(configuration.liveTrim) : 0, this.context!.currentTime);
    panner.pan.setValueAtTime(configuration.pan, this.context!.currentTime);
    gain.connect(liveTrimGain);
    liveTrimGain.connect(analyser);
    analyser.connect(panner);
    panner.connect(this.sessionGate!);
    const channel: ChannelAudioInstance = { id: channelId, gain, liveTrimGain, analyser, panner, source: null, sourceEnvelope: null, frequency: configuration.frequency, level: configuration.level, liveTrim: configuration.liveTrim, pan: configuration.pan, routable: configuration.routable, active: false, availability: "ready", message: "Ready to start" };
    this.channels.set(channelId, channel);
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

  private smooth(parameter: AudioParamLike, value: number) {
    if (!this.context) return;
    ramp(parameter, value, this.context.currentTime);
    this.diagnostics = { ...this.diagnostics, smoothingRamps: this.diagnostics.smoothingRamps + 1 };
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }
}

export const applicationAudioRuntime = new ApplicationAudioRuntime();
