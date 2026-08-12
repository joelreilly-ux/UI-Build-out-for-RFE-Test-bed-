import type { AccentId } from "./ui-config";
import {
  canConnectChannelTerminal,
  createChannelDefinition,
  type ChannelId,
  type ChannelTerminalConnection,
  type ThreadChannel,
} from "./channel-routing.ts";

export type ModuleKind = "source" | "control" | "routing" | "future";
export type ModuleStatus = "active" | "muted" | "bypassed";
export type ModuleMode = "mono" | "poly" | "arp";
export type Selection = { kind: "module"; id: string; ids?: string[] } | { kind: "connection"; id: string } | { kind: "channel"; id: ChannelId } | null;
export type CanvasTool = "select" | "pan";
export type WorkspaceWidth = 100 | 150 | 200;
export type ModuleTemplateType = "note-buttons" | "chord-trigger" | "custom-note" | "note-length" | "attack" | "release" | "seed-injection" | "sample-slots" | "particle-mapping";

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
  threadChannels: ThreadChannel[];
  channelTerminalConnections: ChannelTerminalConnection[];
  nextChannelSequence: number;
  selection: Selection;
  pendingConnectionFrom: string | null;
  activeNav: string;
  layout: "studio" | "compact";
  tool: CanvasTool;
  gridVisible: boolean;
  zoom: number;
  workspaceWidth: WorkspaceWidth;
  workspaceWidthDirection: "extend" | "retract";
  pan: { x: number; y: number };
  presetName: string;
  statusMessage: string;
  session: SessionState;
  updateCount: number;
};

export type AppAction =
  | { type: "select-module"; id: string; additive?: boolean }
  | { type: "select-connection"; id: string }
  | { type: "move-module"; id: string; position: { x: number; y: number } }
  | { type: "add-module"; moduleType: ModuleTemplateType }
  | { type: "rename-module"; id: string; title: string }
  | { type: "duplicate-selection" }
  | { type: "select-all-modules" }
  | { type: "clear-workspace" }
  | { type: "update-parameter"; id: string; key: keyof ModuleParameters; value: ModuleParameters[keyof ModuleParameters] }
  | { type: "reset-module"; id: string }
  | { type: "set-accent"; id: string; accentId: AccentId | null }
  | { type: "begin-connection"; fromModuleId: string }
  | { type: "commit-connection"; toModuleId: string }
  | { type: "commit-channel-output"; channelId: ChannelId }
  | { type: "remove-channel-output"; channelId: ChannelId }
  | { type: "add-channel" }
  | { type: "remove-channel"; channelId: ChannelId }
  | { type: "select-channel"; channelId: ChannelId }
  | { type: "cancel-connection" }
  | { type: "remove-connection"; id: string }
  | { type: "delete-selection" }
  | { type: "set-nav"; value: string }
  | { type: "set-layout"; value: "studio" | "compact" }
  | { type: "set-tool"; value: CanvasTool }
  | { type: "toggle-grid" }
  | { type: "set-zoom"; value: number }
  | { type: "set-workspace-width"; value: WorkspaceWidth }
  | { type: "step-workspace-width" }
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

export const MODULE_LIBRARY = moduleDefinitions.filter((definition) => definition.enabled).map((definition) => ({ type: definition.type as ModuleTemplateType, title: definition.title }));

export function getSelectedModuleIds(selection: Selection): string[] {
  if (selection?.kind !== "module") return [];
  return selection.ids?.length ? selection.ids : [selection.id];
}

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
  const threadChannels: ThreadChannel[] = [createChannelDefinition(1)];
  const channelTerminalConnections: ChannelTerminalConnection[] = [{
    id: "channel-output-1",
    channelId: threadChannels[0].id,
    fromModuleId: "chord",
  }];
  return {
    modules,
    connections,
    threadChannels,
    channelTerminalConnections,
    nextChannelSequence: 2,
    selection: { kind: "module", id: "length" },
    pendingConnectionFrom: null,
    activeNav: "Modules",
    layout: "studio",
    tool: "select",
    gridVisible: true,
    zoom: 100,
    workspaceWidth: 100,
    workspaceWidthDirection: "extend",
    pan: { x: 0, y: 0 },
    presetName: "RFE_Default_Test",
    statusMessage: "Interaction harness ready",
    session: { running: false, startedAt: null, accumulatedMs: 0 },
    updateCount: 0,
  };
}

function getNextChannelSequence(channels: readonly ThreadChannel[]): number {
  if (!channels.length) return 1;
  const activeSequences = channels
    .map((channel) => Number.parseInt(channel.id.replace("channel-", ""), 10))
    .filter((sequence) => Number.isFinite(sequence) && sequence > 0);
  return activeSequences.length ? Math.max(...activeSequences) + 1 : 1;
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
    threadChannels: [],
    channelTerminalConnections: [],
    nextChannelSequence: 1,
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

function clampPosition(value: number, maximum: number) {
  return Math.max(0, Math.min(maximum, value));
}

function moduleSelection(ids: string[]): Selection {
  if (!ids.length) return null;
  if (ids.length === 1) return { kind: "module", id: ids[0] };
  return { kind: "module", id: ids[ids.length - 1], ids };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "select-module": {
      const selectedModule = state.modules.find((item) => item.id === action.id);
      if (!selectedModule) return state;
      if (!action.additive) return withUpdate(state, { selection: { kind: "module", id: selectedModule.id }, pendingConnectionFrom: null, statusMessage: selectedModule.enabled ? `${selectedModule.title} selected` : `${selectedModule.title} is unavailable` });
      const current = getSelectedModuleIds(state.selection);
      const ids = current.includes(action.id) ? current.filter((id) => id !== action.id) : [...current, action.id];
      return withUpdate(state, { selection: moduleSelection(ids), pendingConnectionFrom: null, statusMessage: ids.length ? `${ids.length} module${ids.length === 1 ? "" : "s"} selected` : "Selection cleared" });
    }
    case "select-connection": return state.connections.some((item) => item.id === action.id) ? withUpdate(state, { selection: { kind: "connection", id: action.id }, pendingConnectionFrom: null, statusMessage: `${action.id} selected` }) : state;
    case "select-channel": {
      const channel = state.threadChannels.find((item) => item.id === action.channelId);
      return channel ? withUpdate(state, { selection: { kind: "channel", id: channel.id }, pendingConnectionFrom: null, statusMessage: `${channel.label} selected` }) : state;
    }
    case "move-module": {
      const anchor = state.modules.find((module) => module.id === action.id);
      if (!anchor) return state;
      const selectedIds = getSelectedModuleIds(state.selection);
      const movingIds = selectedIds.includes(action.id) ? selectedIds : [action.id];
      const movingModules = state.modules.filter((module) => movingIds.includes(module.id));
      const requestedDx = action.position.x - anchor.position.x;
      const requestedDy = action.position.y - anchor.position.y;
      const dx = Math.max(...movingModules.map((module) => -module.position.x), requestedDx);
      const boundedDx = Math.min(...movingModules.map((module) => 87 - module.position.x), dx);
      const dy = Math.max(...movingModules.map((module) => -module.position.y), requestedDy);
      const boundedDy = Math.min(...movingModules.map((module) => 88 - module.position.y), dy);
      return withUpdate(state, { modules: state.modules.map((module) => movingIds.includes(module.id) ? { ...module, position: { x: module.position.x + boundedDx, y: module.position.y + boundedDy } } : module), statusMessage: movingIds.length > 1 ? `${movingIds.length} modules moved` : `${anchor.title} moved` });
    }
    case "add-module": {
      const definition = moduleDefinitions.find((module) => module.type === action.moduleType && module.enabled);
      if (!definition) return state;
      const instanceNumber = state.modules.filter((module) => module.type === action.moduleType).length + 1;
      const id = `${action.moduleType}-${crypto.randomUUID()}`;
      const offset = state.modules.length % 7;
      const instance = createModule(definition, { id, title: instanceNumber === 1 ? definition.title : `${definition.title} ${instanceNumber}`, position: { x: 38 + offset * 3, y: 36 + offset * 3 } });
      return withUpdate(state, { modules: [...state.modules, instance], selection: { kind: "module", id }, pendingConnectionFrom: null, statusMessage: `${instance.title} added` });
    }
    case "rename-module": {
      const title = action.title.trim().slice(0, 48);
      if (!title || !state.modules.some((module) => module.id === action.id)) return state;
      return withUpdate(state, { modules: state.modules.map((module) => module.id === action.id ? { ...module, title } : module), statusMessage: `Module renamed to ${title}` });
    }
    case "select-all-modules": {
      const ids = state.modules.map((module) => module.id);
      return withUpdate(state, { selection: moduleSelection(ids), pendingConnectionFrom: null, statusMessage: ids.length ? `${ids.length} modules selected` : "Workspace is empty" });
    }
    case "duplicate-selection": {
      const selectedIds = getSelectedModuleIds(state.selection);
      if (!selectedIds.length) return state;
      const idMap = new Map(selectedIds.map((id) => [id, `${state.modules.find((module) => module.id === id)?.type ?? "module"}-${crypto.randomUUID()}`]));
      const duplicates = state.modules.filter((module) => selectedIds.includes(module.id)).map((module) => ({
        ...module,
        id: idMap.get(module.id)!,
        title: `${module.title} Copy`,
        position: { x: clampPosition(module.position.x + 3, 87), y: clampPosition(module.position.y + 4, 88) },
        parameters: { ...module.parameters },
        ports: { ...module.ports },
      }));
      const duplicateConnections = state.connections.filter((connection) => selectedIds.includes(connection.fromModuleId) && selectedIds.includes(connection.toModuleId)).map((connection) => ({ ...connection, id: `thread-${crypto.randomUUID()}`, fromModuleId: idMap.get(connection.fromModuleId)!, toModuleId: idMap.get(connection.toModuleId)! }));
      const duplicateIds = duplicates.map((module) => module.id);
      return withUpdate(state, { modules: [...state.modules, ...duplicates], connections: [...state.connections, ...duplicateConnections], selection: moduleSelection(duplicateIds), pendingConnectionFrom: null, statusMessage: `${duplicates.length} module${duplicates.length === 1 ? "" : "s"} duplicated` });
    }
    case "clear-workspace": return withUpdate(state, { modules: [], connections: [], threadChannels: [], channelTerminalConnections: [], nextChannelSequence: 1, selection: null, pendingConnectionFrom: null, pan: { x: 0, y: 0 }, statusMessage: "Workspace cleared" });
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
    case "commit-channel-output": {
      if (!state.pendingConnectionFrom) return state;
      const result = canConnectChannelTerminal(state, state.pendingConnectionFrom, action.channelId);
      if (!result.valid) return withUpdate(state, { pendingConnectionFrom: null, statusMessage: result.reason });
      const terminalConnection: ChannelTerminalConnection = { id: `channel-output-${crypto.randomUUID()}`, channelId: action.channelId, fromModuleId: state.pendingConnectionFrom };
      return withUpdate(state, { channelTerminalConnections: [...state.channelTerminalConnections, terminalConnection], pendingConnectionFrom: null, statusMessage: `${action.channelId.replace("channel-", "CH ")} output complete` });
    }
    case "remove-channel-output": {
      if (!state.channelTerminalConnections.some((connection) => connection.channelId === action.channelId)) return state;
      return withUpdate(state, { channelTerminalConnections: state.channelTerminalConnections.filter((connection) => connection.channelId !== action.channelId), pendingConnectionFrom: null, statusMessage: `${action.channelId.replace("channel-", "CH ")} output incomplete` });
    }
    case "add-channel": {
      const sequence = getNextChannelSequence(state.threadChannels);
      const channel = createChannelDefinition(sequence);
      return withUpdate(state, {
        threadChannels: [...state.threadChannels, channel],
        nextChannelSequence: sequence + 1,
        selection: { kind: "channel", id: channel.id },
        pendingConnectionFrom: null,
        statusMessage: `${channel.label} added`,
      });
    }
    case "remove-channel": {
      const channel = state.threadChannels.find((item) => item.id === action.channelId);
      if (!channel) return state;
      const threadChannels = state.threadChannels.filter((item) => item.id !== action.channelId);
      return withUpdate(state, {
        threadChannels,
        channelTerminalConnections: state.channelTerminalConnections.filter((connection) => connection.channelId !== action.channelId),
        nextChannelSequence: getNextChannelSequence(threadChannels),
        selection: state.selection?.kind === "channel" && state.selection.id === action.channelId ? null : state.selection,
        pendingConnectionFrom: null,
        statusMessage: `${channel.label} removed`,
      });
    }
    case "cancel-connection": return state.pendingConnectionFrom ? withUpdate(state, { pendingConnectionFrom: null, statusMessage: "Connection cancelled" }) : state;
    case "remove-connection": return state.connections.some((connection) => connection.id === action.id) ? withUpdate(state, { connections: state.connections.filter((connection) => connection.id !== action.id), selection: null, statusMessage: "Thread disconnected" }) : state;
    case "delete-selection": {
      if (state.selection?.kind === "connection") return appReducer(state, { type: "remove-connection", id: state.selection.id });
      const ids = getSelectedModuleIds(state.selection);
      if (!ids.length) return state;
      const removedThreads = state.connections.filter((connection) => ids.includes(connection.fromModuleId) || ids.includes(connection.toModuleId)).length;
      return withUpdate(state, { modules: state.modules.filter((module) => !ids.includes(module.id)), connections: state.connections.filter((connection) => !ids.includes(connection.fromModuleId) && !ids.includes(connection.toModuleId)), channelTerminalConnections: state.channelTerminalConnections.filter((connection) => !ids.includes(connection.fromModuleId)), selection: null, pendingConnectionFrom: null, statusMessage: `${ids.length} module${ids.length === 1 ? "" : "s"} deleted${removedThreads ? ` with ${removedThreads} attached Thread${removedThreads === 1 ? "" : "s"}` : ""}` });
    }
    case "set-nav": return withUpdate(state, { activeNav: action.value });
    case "set-layout": return withUpdate(state, { layout: action.value });
    case "set-tool": return withUpdate(state, { tool: action.value, pendingConnectionFrom: null });
    case "toggle-grid": return withUpdate(state, { gridVisible: !state.gridVisible });
    case "set-zoom": return withUpdate(state, { zoom: Math.max(60, Math.min(140, action.value)) });
    case "set-workspace-width": return withUpdate(state, { workspaceWidth: action.value, workspaceWidthDirection: action.value === 200 ? "retract" : action.value === 100 ? "extend" : state.workspaceWidthDirection, pan: { x: 0, y: state.pan.y }, statusMessage: action.value === 100 ? "Workspace width reset" : `Workspace extended to ${action.value}%` });
    case "step-workspace-width": {
      const extending = state.workspaceWidthDirection === "extend";
      const workspaceWidth: WorkspaceWidth = extending ? state.workspaceWidth === 100 ? 150 : 200 : state.workspaceWidth === 200 ? 150 : 100;
      const workspaceWidthDirection = workspaceWidth === 200 ? "retract" : workspaceWidth === 100 ? "extend" : state.workspaceWidthDirection;
      return withUpdate(state, { workspaceWidth, workspaceWidthDirection, pan: { x: 0, y: state.pan.y }, statusMessage: workspaceWidthDirection === "retract" ? `Workspace width ${workspaceWidth}% · retract mode` : workspaceWidth === 100 ? "Workspace width reset" : `Workspace extended to ${workspaceWidth}%` });
    }
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
  const defaultState = createInitialState();
  const threadChannels = Array.isArray(candidate.threadChannels)
    ? candidate.threadChannels.flatMap((channel, index, channels) => {
      const legacyId = (channel as ThreadChannel & { channelId?: ChannelId })?.channelId;
      const id = typeof channel?.id === "string" ? channel.id : legacyId;
      if (typeof id !== "string" || channels.findIndex((item) => (item as ThreadChannel & { channelId?: ChannelId })?.id === id || (item as ThreadChannel & { channelId?: ChannelId })?.channelId === id) !== index) return [];
      const sequence = Number.parseInt(id.replace("channel-", ""), 10);
      return [typeof channel.label === "string" && typeof channel.shortLabel === "string" && typeof channel.accentId === "string" ? channel : createChannelDefinition(Number.isFinite(sequence) ? sequence : index + 1)];
    })
    : defaultState.threadChannels;
  const channelIds = new Set(threadChannels.map((channel) => channel.id));
  const channelTerminalConnections = Array.isArray(candidate.channelTerminalConnections)
    ? candidate.channelTerminalConnections.filter((connection, index, items) => ids.has(connection.fromModuleId) && channelIds.has(connection.channelId) && items.findIndex((item) => item?.channelId === connection.channelId) === index)
    : defaultState.channelTerminalConnections.filter((connection) => ids.has(connection.fromModuleId));
  const selectedIds = getSelectedModuleIds(candidate.selection ?? null).filter((id) => ids.has(id));
  const selection = candidate.selection?.kind === "connection"
    ? connections.some((connection) => connection.id === candidate.selection?.id) ? candidate.selection : null
    : candidate.selection?.kind === "channel"
      ? channelIds.has(candidate.selection.id) ? candidate.selection : null
      : moduleSelection(selectedIds);
  return {
    ...defaultState,
    ...candidate,
    modules: candidate.modules,
    connections,
    threadChannels,
    channelTerminalConnections,
    nextChannelSequence: getNextChannelSequence(threadChannels),
    selection,
    pendingConnectionFrom: null,
    session: { running: false, startedAt: null, accumulatedMs: 0 },
  };
}
