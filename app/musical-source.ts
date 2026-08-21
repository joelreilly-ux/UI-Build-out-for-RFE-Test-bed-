export const PITCH_FREQUENCY_MIN = 50;
export const PITCH_FREQUENCY_MAX = 10_000;
export const DEFAULT_PITCH_FREQUENCY = 78;
export const ARPEGGIO_PITCH_MIN = 2;
export const ARPEGGIO_PITCH_MAX = 6;
export const ARPEGGIO_RATE_MIN_MS = 160;
export const ARPEGGIO_RATE_MAX_MS = 2_400;
export const DEFAULT_ARPEGGIO_RATE_MS = 650;
export const ARPEGGIO_PATTERNS = {
  major: [0, 4, 7, 12, 16, 19],
  minor: [0, 3, 7, 12, 15, 19],
  fifths: [0, 7, 12, 19, 24, 31],
  octaves: [0, 12, 24, 36, 48, 60],
} as const;

export type PitchInstruction = Readonly<{ frequencyHz: number }>;
export type ArpeggioPattern = keyof typeof ARPEGGIO_PATTERNS;
export type ArpeggioDirection = "up" | "down" | "up-down";
export type ArpeggioInstruction = Readonly<{ enabled: boolean; pattern: ArpeggioPattern; pitchCount: number; rateMs: number; direction: ArpeggioDirection }>;
export type PitchedGeneratorType = "sine" | "triangle" | "saw" | "square";

export const PITCHED_GENERATOR_TYPES = ["sine", "triangle", "saw", "square"] as const satisfies readonly PitchedGeneratorType[];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createPitchInstruction(value: unknown, fallback: number = DEFAULT_PITCH_FREQUENCY): PitchInstruction {
  const finiteFallback = typeof fallback === "number" && Number.isFinite(fallback) ? fallback : DEFAULT_PITCH_FREQUENCY;
  const frequency = typeof value === "number" && Number.isFinite(value) ? value : finiteFallback;
  return Object.freeze({ frequencyHz: Math.round(clamp(frequency, PITCH_FREQUENCY_MIN, PITCH_FREQUENCY_MAX)) });
}

export function normalizeArpeggioPattern(value: unknown, fallback: ArpeggioPattern = "major"): ArpeggioPattern {
  return typeof value === "string" && value in ARPEGGIO_PATTERNS ? value as ArpeggioPattern : fallback;
}

export function normalizeArpeggioDirection(value: unknown, fallback: ArpeggioDirection = "up"): ArpeggioDirection {
  return value === "up" || value === "down" || value === "up-down" ? value : fallback;
}

export function createArpeggioInstruction(value: Partial<ArpeggioInstruction> = {}): ArpeggioInstruction {
  const pitchCount = Math.round(clamp(typeof value.pitchCount === "number" && Number.isFinite(value.pitchCount) ? value.pitchCount : 3, ARPEGGIO_PITCH_MIN, ARPEGGIO_PITCH_MAX));
  const rateMs = Math.round(clamp(typeof value.rateMs === "number" && Number.isFinite(value.rateMs) ? value.rateMs : DEFAULT_ARPEGGIO_RATE_MS, ARPEGGIO_RATE_MIN_MS, ARPEGGIO_RATE_MAX_MS));
  return Object.freeze({ enabled: value.enabled === true, pattern: normalizeArpeggioPattern(value.pattern), pitchCount, rateMs, direction: normalizeArpeggioDirection(value.direction) });
}

export function getArpeggioIntervals(instruction: ArpeggioInstruction): readonly number[] {
  const ascending = [...ARPEGGIO_PATTERNS[instruction.pattern].slice(0, instruction.pitchCount)];
  if (instruction.direction === "down") return Object.freeze(ascending.reverse());
  if (instruction.direction === "up-down" && ascending.length > 2) return Object.freeze([...ascending, ...ascending.slice(1, -1).reverse()]);
  return Object.freeze(ascending);
}

export function getArpeggioPitch(root: PitchInstruction, instruction: ArpeggioInstruction, stepIndex: number): PitchInstruction {
  if (!instruction.enabled) return root;
  const intervals = getArpeggioIntervals(instruction);
  const safeIndex = Math.abs(Math.floor(Number.isFinite(stepIndex) ? stepIndex : 0)) % intervals.length;
  return createPitchInstruction(root.frequencyHz * 2 ** (intervals[safeIndex] / 12), root.frequencyHz);
}

export function isPitchedGeneratorType(value: unknown): value is PitchedGeneratorType {
  return typeof value === "string" && PITCHED_GENERATOR_TYPES.includes(value as PitchedGeneratorType);
}

export function normalizePitchedGeneratorType(value: unknown, fallback: PitchedGeneratorType = "sine"): PitchedGeneratorType {
  return isPitchedGeneratorType(value) ? value : fallback;
}

export function generatorLabel(type: PitchedGeneratorType): "Sine" | "Triangle" | "Saw" | "Square" {
  if (type === "triangle") return "Triangle";
  if (type === "saw") return "Saw";
  if (type === "square") return "Square";
  return "Sine";
}

export function oscillatorTypeForGenerator(type: PitchedGeneratorType): OscillatorType {
  return type === "saw" ? "sawtooth" : type;
}
