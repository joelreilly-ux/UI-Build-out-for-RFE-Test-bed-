import type { ChannelId } from "./channel-routing";

export const AUDIO_FREQUENCY_MIN = 40;
export const AUDIO_FREQUENCY_MAX = 2_000;
export const AUDIO_DEFAULT_FREQUENCY = 78;
export const AUDIO_DEFAULT_LEVEL = 20;
const CHANNEL_GAIN_MAX = 0.2;
const MASTER_GAIN = 0.8;
const PARAMETER_RAMP_SECONDS = 0.02;

export type AudioAvailability = "unavailable" | "ready" | "active" | "stopped" | "error";

export type AudioChannelSnapshot = Readonly<{
  channelId: ChannelId;
  frequency: number;
  level: number;
  active: boolean;
  availability: AudioAvailability;
  message: string;
}>;

export type AudioRuntimeDiagnostics = Readonly<{
  runtimeCreations: number;
  masterCreations: number;
  channelCreations: number;
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
  resume(): Promise<void>;
  close(): Promise<void>;
};

export type AudioContextFactory = () => AudioContextLike;

type ChannelAudioInstance = {
  id: ChannelId;
  gain: GainNodeLike;
  analyser: AnalyserNodeLike;
  source: OscillatorNodeLike | null;
  sourceEnvelope: GainNodeLike | null;
  frequency: number;
  level: number;
  active: boolean;
  availability: AudioAvailability;
  message: string;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function ramp(parameter: AudioParamLike, value: number, now: number) {
  parameter.cancelScheduledValues(now);
  parameter.setValueAtTime(parameter.value, now);
  parameter.linearRampToValueAtTime(value, now + PARAMETER_RAMP_SECONDS);
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
  private channels = new Map<ChannelId, ChannelAudioInstance>();
  private configurations = new Map<ChannelId, { frequency: number; level: number }>();
  private failures = new Map<ChannelId, string>();
  private listeners = new Set<() => void>();
  private diagnostics: AudioRuntimeDiagnostics = { runtimeCreations: 1, masterCreations: 0, channelCreations: 0, sourceCreations: 0, sourceDisposals: 0, activeSources: 0 };

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
      active: channel.active,
      availability: channel.availability,
      message: channel.message,
    } : {
      channelId,
      frequency: this.configurations.get(channelId)?.frequency ?? AUDIO_DEFAULT_FREQUENCY,
      level: this.configurations.get(channelId)?.level ?? AUDIO_DEFAULT_LEVEL,
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
      envelope.connect(channel.analyser);
      ramp(envelope.gain, 1, this.context!.currentTime);
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
    if (envelope) ramp(envelope.gain, 0, this.context.currentTime);
    source.stop(this.context.currentTime + PARAMETER_RAMP_SECONDS);
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
    const configuration = this.configurations.get(channelId) ?? { frequency: AUDIO_DEFAULT_FREQUENCY, level: AUDIO_DEFAULT_LEVEL };
    this.configurations.set(channelId, { ...configuration, frequency: safeFrequency });
    if (!channel) { this.emit(); return; }
    channel.frequency = safeFrequency;
    if (channel.source && this.context) ramp(channel.source.frequency, safeFrequency, this.context.currentTime);
    this.emit();
  }

  setLevel(channelId: ChannelId, level: number) {
    const safeLevel = Math.round(clamp(level, 0, 100));
    const channel = this.channels.get(channelId);
    const configuration = this.configurations.get(channelId) ?? { frequency: AUDIO_DEFAULT_FREQUENCY, level: AUDIO_DEFAULT_LEVEL };
    this.configurations.set(channelId, { ...configuration, level: safeLevel });
    if (!channel) { this.emit(); return; }
    channel.level = safeLevel;
    if (this.context) ramp(channel.gain.gain, safeLevel / 100 * CHANNEL_GAIN_MAX, this.context.currentTime);
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
    channel.gain.disconnect();
    this.channels.delete(channelId);
    this.configurations.delete(channelId);
    this.failures.delete(channelId);
    this.emit();
  }

  async shutdownApplication() {
    for (const channelId of [...this.channels.keys()]) this.disposeChannel(channelId);
    await this.context?.close();
    this.context = null;
    this.master = null;
    this.emit();
  }

  private ensureInfrastructure() {
    if (this.context && this.master) return;
    this.context = this.createContext();
    this.master = this.context.createGain();
    this.master.gain.setValueAtTime(MASTER_GAIN, this.context.currentTime);
    this.master.connect(this.context.destination);
    this.diagnostics = { ...this.diagnostics, masterCreations: this.diagnostics.masterCreations + 1 };
  }

  private ensureChannel(channelId: ChannelId) {
    const existing = this.channels.get(channelId);
    if (existing) return existing;
    this.ensureInfrastructure();
    const gain = this.context!.createGain();
    const analyser = this.context!.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.55;
    const configuration = this.configurations.get(channelId) ?? { frequency: AUDIO_DEFAULT_FREQUENCY, level: AUDIO_DEFAULT_LEVEL };
    this.configurations.set(channelId, configuration);
    gain.gain.setValueAtTime(configuration.level / 100 * CHANNEL_GAIN_MAX, this.context!.currentTime);
    analyser.connect(gain);
    gain.connect(this.master!);
    const channel: ChannelAudioInstance = { id: channelId, gain, analyser, source: null, sourceEnvelope: null, frequency: configuration.frequency, level: configuration.level, active: false, availability: "ready", message: "Ready to start" };
    this.channels.set(channelId, channel);
    this.diagnostics = { ...this.diagnostics, channelCreations: this.diagnostics.channelCreations + 1 };
    return channel;
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }
}

export const applicationAudioRuntime = new ApplicationAudioRuntime();
