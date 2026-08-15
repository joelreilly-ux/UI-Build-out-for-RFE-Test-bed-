export const PITCH_FREQUENCY_MIN = 50;
export const PITCH_FREQUENCY_MAX = 10_000;
export const DEFAULT_PITCH_FREQUENCY = 78;

export type PitchInstruction = Readonly<{ frequencyHz: number }>;
export type PitchedGeneratorType = "sine" | "triangle" | "saw";

export const PITCHED_GENERATOR_TYPES = ["sine", "triangle", "saw"] as const satisfies readonly PitchedGeneratorType[];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createPitchInstruction(value: unknown, fallback: number = DEFAULT_PITCH_FREQUENCY): PitchInstruction {
  const finiteFallback = typeof fallback === "number" && Number.isFinite(fallback) ? fallback : DEFAULT_PITCH_FREQUENCY;
  const frequency = typeof value === "number" && Number.isFinite(value) ? value : finiteFallback;
  return Object.freeze({ frequencyHz: Math.round(clamp(frequency, PITCH_FREQUENCY_MIN, PITCH_FREQUENCY_MAX)) });
}

export function isPitchedGeneratorType(value: unknown): value is PitchedGeneratorType {
  return typeof value === "string" && PITCHED_GENERATOR_TYPES.includes(value as PitchedGeneratorType);
}

export function normalizePitchedGeneratorType(value: unknown, fallback: PitchedGeneratorType = "sine"): PitchedGeneratorType {
  return isPitchedGeneratorType(value) ? value : fallback;
}

export function generatorLabel(type: PitchedGeneratorType): "Sine" | "Triangle" | "Saw" {
  if (type === "triangle") return "Triangle";
  if (type === "saw") return "Saw";
  return "Sine";
}

export function oscillatorTypeForGenerator(type: PitchedGeneratorType): OscillatorType {
  return type === "saw" ? "sawtooth" : type;
}
