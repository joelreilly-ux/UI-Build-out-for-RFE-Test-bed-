import type { AccentId } from "./ui-config";

export type ModuleKind = "source" | "control" | "routing" | "future";
export type ModuleStatus = "active" | "muted" | "bypassed";
export type ModuleMode = "mono" | "poly" | "arp";
export type Selection = { kind: "module" | "connection"; id: string } | null;
export type CanvasTool = "select" | "pan";

export type ModuleParameters = {
  mode: ModuleMode;
  noteSource: string;
  rootNote: string;
  scale: string;
  duration: string;
  swing: number;
  humanize: number;
  injectStrength: number;
  seedWeight: number;
  randomizeSeed: boolean;
  output: string;
  status: ModuleStatus;
};

export type ModuleInstance = {
  id: string;
  type: string;
  title: string;
  eyebrow: string;
  kind: ModuleKind;
  enabled: boolean;
  position: { x: number; y: number };
  parameters: ModuleParameters;
  accentId: AccentId | null;
  ports: { input: boolean; output: boolean };
};

export type ThreadConnection = {
  id: string;
  fromModuleId: string;
  toModuleId: string;
  fromPort: "out";
  toPort: "in";
};

export type SessionState = {
  running: boolean;
  startedAt: number | null;
  accumulatedMs: number;
};

export type AppState = {
  modules: ModuleInstance[];
  connections: ThreadConnection[];
  selection: Selection;
  pendingConnectionFrom: string | null;
  activeNav: string;
  layout: "studio" | "compact";
  tool: CanvasTool;
  gridVisible: boolean;
  zoom: number;
  pan: { x: number; y: number };
  presetName: string;
  statusMessage: string;
  session: SessionState;
  updateCount: number;
};

export type AppAction =
  | { type: "select-module"; id: string }
  | { type: "select-connection"; id: string }
  | { type: "move-module"; id: string; position: { x: number; y: number } }
  | { type: "update-parameter"; id: string; key: keyof ModuleParameters; value: ModuleParameters[keyof ModuleParameters] }
  | { type: "reset-module"; id: string }
  | { type: "set-accent"; id: string; accentId: AccentId | null }
  | { type: "begin-connection"; fromModuleId: string }
  | { type: "commit-connection"; toModuleId: string }
  | { type: "cancel-connection" }
  | { type: "remove-connection"; id: string }
  | { type: "delete-selection" }
  | { type: "set-nav"; value: string }
  | { type: "set-layout"; value: "studio" | "compact" }
  | { type: "set-tool"; value: CanvasTool }
  | { type: "toggle-grid" }
  | { type: "set-zoom"; value: number }
  | { type: "set-pan"; value: { x: number; y: number } }
  | { type: "load-preset"; value: "default" | "benchmark" }
  | { type: "load-state"; value: AppState }
  | { type: "set-preset-name"; value: string }
  | { type: "set-status"; value: string }
  | { type: "toggle-session"; now: number }
  | { type: "reset-session"; now: number };

export const DEFAULT_PARAMETERS: ModuleParameters = {
  mode: "poly",
  noteSource: "Chord Trigger",
  rootNote: "C3",
  scale: "Minor Pentatonic",
  duration: "1/4",
  swing: 54,
  humanize: 8,
  injectStrength: 62,
  seedWeight: 48,
  randomizeSeed: true,
  output: "Sample Slots 01–16",
  status: "active",
};

const moduleDefinitions: Array<Omit<ModuleInstance, "parameters" | "accentId" | "ports"> & { parameters?: Partial<ModuleParameters> }> = [
  { id: "notes", type: "note-buttons", title: "Note Buttons", eyebrow: "Trigger source", kind: "source", enabled: true, position: { x: 5, y: 7 }, parameters: { rootNote: "C3" } },
  { id: "chord", type: "chord-trigger", title: "Chord Trigger", eyebrow: "Trigger", kind: "control", enabled: true, position: { x: 33, y: 8 }, parameters: { mode: "poly" } },
  { id: "custom", type: "custom-note", title: "Custom Note", eyebrow: "Note source", kind: "source", enabled: true, position: { x: 7, y: 33 }, parameters: { rootNote: "C4" } },
  { id: "length", type: "note-length", title: "Note Length", eyebrow: "Timing control", kind: "control", enabled: true, position: { x: 37, y: 34 }, parameters: { duration: "1/4", swing: 54 } },
  { id: "attack", type: "attack", title: "Attack", eyebrow: "Envelope", kind: "control", enabled: true, position: { x: 69, y: 24 }, parameters: { duration: "10 ms" } },
  { id: "release", type: "release", title: "Release", eyebrow: "Envelope", kind: "control", enabled: true, position: { x: 69, y: 45 }, parameters: { duration: "250 ms" } },
  { id: "seed", type: "seed-injection", title: "Seed Injection", eyebrow: "Field control", kind: "control", enabled: true, position: { x: 5, y: 66 }, parameters: { injectStrength: 62, seedWeight: 48 } },
  { id: "slots", type: "sample-slots", title: "Sample Slots 01–16", eyebrow: "Sample bank", kind: "source", enabled: true, position: { x: 32, y: 67 }, parameters: { status: "active" } },
  { id: "mapping", type: "particle-mapping", title: "Particle Mapping", eyebrow: "Route", kind: "routing", enabled: true, position: { x: 60, y: 67 }, parameters: { output: "Field A" } },
  { id: "audio", type: "audio-in", title: "Audio In", eyebrow: "Future module", kind: "future", enabled: false, position: { x: 33, y: 84 }, parameters: { status: "bypassed" } },
];

export function createModule(definition: typeof moduleDefinitions[number], overrides: Partial<ModuleInstance> = {}): ModuleInstance {
  return {
    ...definition,
    ...overrides,
    position: overrides.position ?? { ...definition.position },
    parameters: { ...DEFAULT_PARAMETERS, ...definition.parameters, ...overrides.parameters },
    accentId: overrides.accentId ?? null,
    ports: overrides.ports ?? { input: definition.enabled, output: definition.enabled },
  };
}

const initialConnectionPairs = [
  ["notes", "chord"], ["chord", "length"], ["custom", "length"], ["length", "attack"],
  ["length", "release"], ["seed", "slots"], ["slots", "mapping"], ["seed", "mapping"],
] as const;

export function createInitialState(): AppState {
  const modules = moduleDefinitions.map((definition) => createModule(definition));
  const connections = initialConnectionPairs.map(([fromModuleId, toModuleId], index) => ({
    id: `thread-${index + 1}`,
    fromModuleId,
    toModuleId,
    fromPort: "out" as const,
    toPort: "in" as const,
  }));
  return {
    modules,
    connections,
    selection: { kind: "module", id: "length" },
    pendingConnectionFrom: null,
    activeNav: "Modules",
    layout: "studio",
    tool: "select",
    gridVisible: true,
    zoom: 100,
    pan: { x: 0, y: 0 },
    presetName: "RFE_Default_Test",
    statusMessage: "Interaction harness ready",
    session: { running: false, startedAt: null, accumulatedMs: 0 },
    updateCount: 0,
  };
}

export function createBenchmarkState(moduleCount = 32, threadCount = 32): AppState {
  const usable = moduleDefinitions.filter((definition) => definition.enabled);
  const modules = Array.from({ length: moduleCount }, (_, index) => {
    const source = usable[index % usable.length];
    const column = index % 8;
    const row = Math.floor(index / 8);
    return createModule(source, {
      id: `${source.id}-${index + 1}`,
      title: `${source.title} ${index + 1}`,
      position: { x: 1.5 + column * 12.3, y: 2.5 + row * 23.5 },
      parameters: { ...DEFAULT_PARAMETERS, ...source.parameters, swing: (index * 7) % 101, duration: ["1/8", "1/4", "1/2", "1 bar"][index % 4] },
    });
  });
  const connections = Array.from({ length: Math.min(threadCount, moduleCount ? threadCount : 0) }, (_, index) => ({
    id: `benchmark-thread-${index + 1}`,
    fromModuleId: modules[index % modules.length].id,
    toModuleId: modules[(index + 1) % modules.length].id,
    fromPort: "out" as const,
    toPort: "in" as const,
  }));
  return {
    ...createInitialState(),
    modules,
    connections,
    selection: modules[0] ? { kind: "module", id: modules[0].id } : null,
    presetName: "RFE_32x32_Benchmark",
    statusMessage: `${modules.length} modules / ${connections.length} Threads loaded`,
    zoom: 85,
  };
}

export function canConnect(state: AppState, fromModuleId: string, toModuleId: string): { valid: boolean; reason: string } {
  const source = state.modules.find((module) => module.id === fromModuleId);
  const target = state.modules.find((module) => module.id === toModuleId);
  if (!source || !target) return { valid: false, reason: "Endpoint unavailable" };
  if (!source.enabled || !target.enabled) return { valid: false, reason: "Future modules cannot be connected" };
  if (!source.ports.output || !target.ports.input) return { valid: false, reason: "Port direction is invalid" };
  if (source.id === target.id) return { valid: false, reason: "A module cannot connect to itself" };
  if (state.connections.some((connection) => connection.fromModuleId === source.id && connection.toModuleId === target.id)) return { valid: false, reason: "Thread already exists" };
  return { valid: true, reason: "Valid destination" };
}

export function getElapsedMs(session: SessionState, now: number): number {
  return session.accumulatedMs + (session.running && session.startedAt !== null ? Math.max(0, now - session.startedAt) : 0);
}

export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${remainder}`;
}

export function getModuleDisplay(module: ModuleInstance): { detail: string; value: string } {
  if (!module.enabled) return { detail: "Architectural placeholder", value: "Unavailable" };
  switch (module.type) {
    case "note-buttons": return { detail: `${module.parameters.rootNote} · D3 · E3 · G3 · A3`, value: "5 inputs" };
    case "chord-trigger": return { detail: module.parameters.scale, value: module.parameters.mode[0].toUpperCase() + module.parameters.mode.slice(1) };
    case "custom-note": return { detail: `Humanize ${module.parameters.humanize}%`, value: module.parameters.rootNote };
    case "note-length": return { detail: `Swing ${module.parameters.swing}%`, value: module.parameters.duration };
    case "attack": case "release": return { detail: module.parameters.randomizeSeed ? "Linear" : "Fixed", value: module.parameters.duration };
    case "seed-injection": return { detail: `Weight ${(module.parameters.seedWeight / 100).toFixed(2)}`, value: (module.parameters.injectStrength / 100).toFixed(2) };
    case "sample-slots": return { detail: module.parameters.status[0].toUpperCase() + module.parameters.status.slice(1), value: "12 / 16" };
    case "particle-mapping": return { detail: "Harmonic map", value: module.parameters.output };
    default: return { detail: module.parameters.scale, value: module.parameters.duration };
  }
}

function withUpdate(state: AppState, patch: Partial<AppState>): AppState {
  return { ...state, ...patch, updateCount: state.updateCount + 1 };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "select-module": {
      const selectedModule = state.modules.find((item) => item.id === action.id);
      return selectedModule ? withUpdate(state, { selection: { kind: "module", id: selectedModule.id }, pendingConnectionFrom: null, statusMessage: selectedModule.enabled ? `${selectedModule.title} selected` : `${selectedModule.title} is unavailable` }) : state;
    }
    case "select-connection": return state.connections.some((item) => item.id === action.id) ? withUpdate(state, { selection: { kind: "connection", id: action.id }, pendingConnectionFrom: null, statusMessage: `${action.id} selected` }) : state;
    case "move-module": return withUpdate(state, { modules: state.modules.map((module) => module.id === action.id ? { ...module, position: { x: Math.max(0, Math.min(87, action.position.x)), y: Math.max(0, Math.min(88, action.position.y)) } } : module) });
    case "update-parameter": return withUpdate(state, { modules: state.modules.map((module) => module.id === action.id && module.enabled ? { ...module, parameters: { ...module.parameters, [action.key]: action.value } } : module), statusMessage: `${String(action.key)} updated` });
    case "reset-module": return withUpdate(state, { modules: state.modules.map((module) => module.id === action.id ? { ...module, parameters: { ...DEFAULT_PARAMETERS } } : module), statusMessage: "Module parameters reset" });
    case "set-accent": return withUpdate(state, { modules: state.modules.map((module) => module.id === action.id ? { ...module, accentId: action.accentId } : module) });
    case "begin-connection": {
      const source = state.modules.find((module) => module.id === action.fromModuleId);
      return source?.enabled && source.ports.output ? withUpdate(state, { pendingConnectionFrom: source.id, selection: { kind: "module", id: source.id }, statusMessage: `Connecting from ${source.title}` }) : withUpdate(state, { statusMessage: "This output is unavailable" });
    }
    case "commit-connection": {
      if (!state.pendingConnectionFrom) return state;
      const result = canConnect(state, state.pendingConnectionFrom, action.toModuleId);
      if (!result.valid) return withUpdate(state, { pendingConnectionFrom: null, statusMessage: result.reason });
      const connection: ThreadConnection = { id: `thread-${crypto.randomUUID()}`, fromModuleId: state.pendingConnectionFrom, toModuleId: action.toModuleId, fromPort: "out", toPort: "in" };
      return withUpdate(state, { connections: [...state.connections, connection], selection: { kind: "connection", id: connection.id }, pendingConnectionFrom: null, statusMessage: "Thread connected" });
    }
    case "cancel-connection": return state.pendingConnectionFrom ? withUpdate(state, { pendingConnectionFrom: null, statusMessage: "Connection cancelled" }) : state;
    case "remove-connection": return state.connections.some((connection) => connection.id === action.id) ? withUpdate(state, { connections: state.connections.filter((connection) => connection.id !== action.id), selection: null, statusMessage: "Thread disconnected" }) : state;
    case "delete-selection": return state.selection?.kind === "connection" ? appReducer(state, { type: "remove-connection", id: state.selection.id }) : state;
    case "set-nav": return withUpdate(state, { activeNav: action.value });
    case "set-layout": return withUpdate(state, { layout: action.value });
    case "set-tool": return withUpdate(state, { tool: action.value, pendingConnectionFrom: null });
    case "toggle-grid": return withUpdate(state, { gridVisible: !state.gridVisible });
    case "set-zoom": return withUpdate(state, { zoom: Math.max(60, Math.min(140, action.value)) });
    case "set-pan": return withUpdate(state, { pan: action.value });
    case "load-preset": {
      const next = action.value === "benchmark" ? createBenchmarkState() : createInitialState();
      return { ...next, session: state.session, updateCount: state.updateCount + 1 };
    }
    case "load-state": return { ...action.value, session: state.session, updateCount: state.updateCount + 1, statusMessage: "Saved preset restored" };
    case "set-preset-name": return withUpdate(state, { presetName: action.value });
    case "set-status": return { ...state, statusMessage: action.value };
    case "toggle-session": {
      const session = state.session.running
        ? { running: false, startedAt: null, accumulatedMs: getElapsedMs(state.session, action.now) }
        : { running: true, startedAt: action.now, accumulatedMs: state.session.accumulatedMs };
      return withUpdate(state, { session, statusMessage: session.running ? "Test session started" : "Test session paused" });
    }
    case "reset-session": return withUpdate(state, { session: { running: state.session.running, startedAt: state.session.running ? action.now : null, accumulatedMs: 0 }, statusMessage: "Elapsed time reset" });
    default: return state;
  }
}

export function sanitizeRestoredState(value: unknown): AppState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AppState>;
  if (!Array.isArray(candidate.modules) || !Array.isArray(candidate.connections)) return null;
  const ids = new Set(candidate.modules.map((module) => module?.id).filter(Boolean));
  if (ids.size !== candidate.modules.length) return null;
  const connections = candidate.connections.filter((connection) => ids.has(connection.fromModuleId) && ids.has(connection.toModuleId));
  return {
    ...createInitialState(),
    ...candidate,
    modules: candidate.modules,
    connections,
    pendingConnectionFrom: null,
    session: { running: false, startedAt: null, accumulatedMs: 0 },
  };
}
