"use client";

import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { UIWorkshop } from "./ui-workshop";
import {
  appReducer,
  canConnect,
  createInitialState,
  formatElapsed,
  getElapsedMs,
  getModuleDisplay,
  sanitizeRestoredState,
  type AppState,
  type ModuleInstance,
  type ModuleParameters,
  type ThreadConnection,
} from "./interaction-state";
import {
  BASELINE_UI_CONFIG,
  DARK_UI_CONFIG,
  MUTED_ACCENTS,
  MODULE_ACCENTS_STORAGE_KEY,
  UI_CONFIG_REVISION,
  UI_CONFIG_STORAGE_KEY,
  UI_THEME_STORAGE_KEY,
  configToCSSVariables,
  mergeUIConfig,
  type AccentId,
  type ThemeMode,
  type UIConfig,
} from "./ui-config";

const APP_SNAPSHOT_KEY = "rfe-interaction-harness-snapshot-v1";
const navItems = ["Modules", "Threads", "Triggers", "Sample Slots", "Routing"];
const rootNotes = ["C2", "C3", "C4", "D3", "E3", "G3", "A3"];
const scales = ["Minor Pentatonic", "Major Pentatonic", "Chromatic", "Dorian"];
const durations = ["1/16", "1/8", "1/4", "1/2", "1 bar", "10 ms", "250 ms"];

function WindowFrame({ title, className = "", compactControls = false, trailing, children }: {
  title: string;
  className?: string;
  compactControls?: boolean;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={`window-frame ${className}`} aria-label={title}>
      <header className="window-titlebar">
        <div className="window-controls" aria-label="Window controls unavailable in this milestone">
          <button className="window-dot close" aria-label="Close window unavailable" title="Window closing is unavailable in this milestone" disabled />
          {!compactControls && <button className="window-dot minimise" aria-label="Minimise window unavailable" title="Window minimising is unavailable in this milestone" disabled />}
          {!compactControls && <button className="window-dot expand" aria-label="Expand window unavailable" title="Window resizing is unavailable in this milestone" disabled />}
        </div>
        <div className="window-title"><span className="title-mark">⌁</span>{title}</div>
        {trailing ?? <button className="title-action" aria-label={`Options for ${title} unavailable`} title="Additional window options are unavailable" disabled>•••</button>}
      </header>
      {children}
    </section>
  );
}

function ModuleCard({ module, active, pendingFrom, state, onSelect, onMove, onBeginConnection, onCommitConnection }: {
  module: ModuleInstance;
  active: boolean;
  pendingFrom: string | null;
  state: AppState;
  onSelect: () => void;
  onMove: (position: { x: number; y: number }) => void;
  onBeginConnection: () => void;
  onCommitConnection: () => void;
}) {
  const accent = MUTED_ACCENTS.find((item) => item.id === module.accentId);
  const display = getModuleDisplay(module);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const validTarget = pendingFrom ? canConnect(state, pendingFrom, module.id).valid : false;
  const pointerDown = (event: PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest(".port")) return;
    event.stopPropagation();
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: module.position.x, originY: module.position.y, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const canvas = event.currentTarget.closest(".node-canvas")?.getBoundingClientRect();
    if (!canvas) return;
    const dx = event.clientX - drag.current.startX;
    const dy = event.clientY - drag.current.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
    if (drag.current.moved) onMove({ x: drag.current.originX + dx / canvas.width * 100 / (state.zoom / 100), y: drag.current.originY + dy / canvas.height * 100 / (state.zoom / 100) });
  };
  const pointerUp = (event: PointerEvent<HTMLElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <div
      className={`module-card ${module.kind} ${active ? "selected" : ""} ${accent ? "has-accent" : ""} ${module.enabled ? "" : "unavailable"}`}
      style={{ left: `${module.position.x}%`, top: `${module.position.y}%`, ...(accent ? { "--module-accent": accent.value } : {}) } as CSSProperties}
      data-module-id={module.id}
      data-module-type={module.type}
      data-enabled={module.enabled}
    >
      <button
        className={`port port-in ${validTarget ? "valid-target" : ""}`}
        aria-label={`Input port for ${module.title}${module.enabled ? "" : " unavailable"}`}
        disabled={!module.enabled || !pendingFrom}
        onClick={(event) => { event.stopPropagation(); onCommitConnection(); }}
      />
      <button
        className={`port port-out ${pendingFrom === module.id ? "connecting" : ""}`}
        aria-label={`Output port for ${module.title}${module.enabled ? "" : " unavailable"}`}
        disabled={!module.enabled}
        onClick={(event) => { event.stopPropagation(); onBeginConnection(); }}
      />
      <button
        className="module-body"
        aria-pressed={active}
        aria-label={`${module.eyebrow} ${module.title} ${display.detail} ${display.value}`}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={() => { drag.current = null; }}
        onClick={onSelect}
      >
        <span className="module-eyebrow">{module.eyebrow}</span>
        <span className="module-title">{module.title}</span>
        <span className="module-footer"><span>{display.detail}</span><strong>{display.value}</strong></span>
      </button>
    </div>
  );
}

function ThreadLayer({ connections, modules, selectedId, canvasSize, nodeWidth, nodeHeight, pendingFrom, draftPoint, onSelect }: {
  connections: ThreadConnection[];
  modules: ModuleInstance[];
  selectedId: string | null;
  canvasSize: { width: number; height: number };
  nodeWidth: number;
  nodeHeight: number;
  pendingFrom: string | null;
  draftPoint: { x: number; y: number } | null;
  onSelect: (id: string) => void;
}) {
  const geometry = (connection: ThreadConnection) => {
    const source = modules.find((module) => module.id === connection.fromModuleId);
    const target = modules.find((module) => module.id === connection.toModuleId);
    if (!source || !target) return null;
    return {
      x1: source.position.x / 100 * canvasSize.width + nodeWidth,
      y1: source.position.y / 100 * canvasSize.height + nodeHeight / 2,
      x2: target.position.x / 100 * canvasSize.width,
      y2: target.position.y / 100 * canvasSize.height + nodeHeight / 2,
    };
  };
  const path = ({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) => {
    const bend = Math.max(28, Math.abs(x2 - x1) * .45);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  };
  const draftSource = pendingFrom ? modules.find((module) => module.id === pendingFrom) : null;
  const draftGeometry = draftSource && draftPoint ? {
    x1: draftSource.position.x / 100 * canvasSize.width + nodeWidth,
    y1: draftSource.position.y / 100 * canvasSize.height + nodeHeight / 2,
    x2: draftPoint.x,
    y2: draftPoint.y,
  } : null;
  return (
    <svg className="connection-layer" width="100%" height="100%" aria-label="Thread connections">
      {connections.map((connection) => {
        const points = geometry(connection);
        if (!points) return null;
        const d = path(points);
        return <g key={connection.id} className={selectedId === connection.id ? "selected" : ""} data-connection-id={connection.id}>
          <path className="thread-hit" d={d} onClick={(event) => { event.stopPropagation(); onSelect(connection.id); }} />
          <path className="thread-path" d={d} />
        </g>;
      })}
      {draftGeometry && <path className="thread-path draft" d={path(draftGeometry)} />}
    </svg>
  );
}

function AccentSelector({ value, style, weight, disabled, onChange, onStyleChange, onWeightChange }: {
  value: AccentId | null;
  style: UIConfig["nodes"]["groupingAccentStyle"];
  weight: number;
  disabled?: boolean;
  onChange: (value: AccentId | null) => void;
  onStyleChange: (value: UIConfig["nodes"]["groupingAccentStyle"]) => void;
  onWeightChange: (value: 1 | 1.5) => void;
}) {
  return (
    <div className="accent-assignment" aria-label="Module grouping colour">
      <div><span>Grouping accent</span><small>{value ? MUTED_ACCENTS.find((accent) => accent.id === value)?.name : "None"}</small></div>
      <div className="accent-options">
        <button disabled={disabled} className={!value ? "selected" : ""} onClick={() => onChange(null)} aria-label="Clear grouping accent">×</button>
        {MUTED_ACCENTS.map((accent) => <button disabled={disabled} key={accent.id} className={value === accent.id ? "selected" : ""} style={{ backgroundColor: accent.value }} onClick={() => onChange(accent.id)} aria-label={`Assign ${accent.name} grouping accent`} title={accent.name} />)}
      </div>
      <div className="highlight-picker" aria-label="Highlight style picker">
        <span>Highlight style</span>
        <div className="highlight-style-options">
          <button className={style === "inset-bar" ? "active" : ""} onClick={() => onStyleChange("inset-bar")} aria-pressed={style === "inset-bar"}>Inset bar</button>
          <button className={style === "full-border" ? "active" : ""} onClick={() => onStyleChange("full-border")} aria-pressed={style === "full-border"}>Full border</button>
        </div>
        <span>Weight</span>
        <div className="highlight-weight-options">
          <button className={weight === 1 ? "active" : ""} onClick={() => onWeightChange(1)} aria-pressed={weight === 1}>1 px</button>
          <button className={weight === 1.5 ? "active" : ""} onClick={() => onWeightChange(1.5)} aria-pressed={weight === 1.5}>1.5 px</button>
        </div>
      </div>
    </div>
  );
}

function SliderField({ label, value, disabled, onChange }: { label: string; value: number; disabled?: boolean; onChange: (value: number) => void }) {
  const updateFromPointer = (event: PointerEvent<HTMLInputElement>) => {
    if (disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onChange(Math.max(0, Math.min(100, Math.round((event.clientX - rect.left) / rect.width * 100))));
  };
  return <label className="slider-field"><span><span>{label}</span><output>{value}%</output></span><input disabled={disabled} aria-label={label} type="range" min="0" max="100" value={value} onInput={(event) => onChange(Number(event.currentTarget.value))} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); updateFromPointer(event); }} onPointerMove={(event) => { if (event.buttons === 1) updateFromPointer(event); }} /></label>;
}

function Metric({ label, value, unit, accent = false }: { label: string; value: string; unit?: string; accent?: boolean }) {
  return <div className={`metric ${accent ? "metric-accent" : ""}`}><span className="metric-label">{label}</span><div className="metric-value">{value}<small>{unit}</small></div><div className="metric-bars" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /></div></div>;
}

function Inspector({ state, selectedModule, selectedConnection, uiConfig, updateParameter, setAccent, setHighlightStyle, setHighlightWeight, dispatch }: {
  state: AppState;
  selectedModule: ModuleInstance | null;
  selectedConnection: ThreadConnection | null;
  uiConfig: UIConfig;
  updateParameter: <K extends keyof ModuleParameters>(key: K, value: ModuleParameters[K]) => void;
  setAccent: (value: AccentId | null) => void;
  setHighlightStyle: (value: UIConfig["nodes"]["groupingAccentStyle"]) => void;
  setHighlightWeight: (value: 1 | 1.5) => void;
  dispatch: React.Dispatch<Parameters<typeof appReducer>[1]>;
}) {
  if (selectedConnection) {
    const source = state.modules.find((module) => module.id === selectedConnection.fromModuleId);
    const target = state.modules.find((module) => module.id === selectedConnection.toModuleId);
    return <div className="inspector-content"><div className="selection-summary"><span>Selected Thread</span><strong>{selectedConnection.id}</strong><small>{source?.title} → {target?.title}</small></div><div className="inspector-section"><h3>Connection</h3><div className="connection-summary"><span>Output</span><b>{source?.title}</b><span>Input</span><b>{target?.title}</b><span>State</span><b>Committed</b></div></div><button className="reset-button danger" onClick={() => dispatch({ type: "remove-connection", id: selectedConnection.id })}>Disconnect Thread</button><p className="inspector-note">Delete or Backspace also disconnects the selected Thread.</p></div>;
  }
  if (!selectedModule) return <div className="inspector-content empty-inspector">Select a module or Thread.</div>;
  const disabled = !selectedModule.enabled;
  const p = selectedModule.parameters;
  return <div className="inspector-content">
    <div className="selection-summary"><span>Selected</span><strong>{selectedModule.title}</strong><small>{selectedModule.id} · {selectedModule.eyebrow}</small></div>
    <AccentSelector value={selectedModule.accentId} style={uiConfig.nodes.groupingAccentStyle} weight={uiConfig.nodes.groupingAccentThickness} disabled={disabled} onChange={setAccent} onStyleChange={setHighlightStyle} onWeightChange={setHighlightWeight} />
    {disabled && <div className="unavailable-notice" role="status">Future module — controls and connections are unavailable.</div>}
    <div className="inspector-section"><h3>Note / Chord</h3>
      <div className="segmented">{(["mono", "poly", "arp"] as const).map((mode) => <button disabled={disabled} key={mode} className={p.mode === mode ? "active" : ""} onClick={() => updateParameter("mode", mode)}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}</div>
      <label className="form-row"><span>Note Source</span><select disabled={disabled} className="select-control" value={p.noteSource} onChange={(event) => updateParameter("noteSource", event.target.value)}><option>Chord Trigger</option><option>Note Buttons</option><option>Custom Note</option></select></label>
      <label className="form-row"><span>Root Note</span><select disabled={disabled} className="select-control" value={p.rootNote} onChange={(event) => updateParameter("rootNote", event.target.value)}>{rootNotes.map((note) => <option key={note}>{note}</option>)}</select></label>
      <label className="form-row"><span>Scale</span><select disabled={disabled} className="select-control" value={p.scale} onChange={(event) => updateParameter("scale", event.target.value)}>{scales.map((scale) => <option key={scale}>{scale}</option>)}</select></label>
    </div>
    <div className="inspector-section"><h3>Timing</h3>
      <label className="form-row"><span>Duration</span><select disabled={disabled} className="select-control" value={p.duration} onChange={(event) => updateParameter("duration", event.target.value)}>{durations.map((duration) => <option key={duration}>{duration}</option>)}</select></label>
      <SliderField disabled={disabled} label="Swing" value={p.swing} onChange={(value) => updateParameter("swing", value)} />
      <SliderField disabled={disabled} label="Humanize" value={p.humanize} onChange={(value) => updateParameter("humanize", value)} />
    </div>
    <div className="inspector-section"><h3>Injection</h3>
      <SliderField disabled={disabled} label="Inject Strength" value={p.injectStrength} onChange={(value) => updateParameter("injectStrength", value)} />
      <SliderField disabled={disabled} label="Seed Weight" value={p.seedWeight} onChange={(value) => updateParameter("seedWeight", value)} />
      <label className="toggle-row"><span>Randomize Seed</span><input disabled={disabled} type="checkbox" checked={p.randomizeSeed} onChange={(event) => updateParameter("randomizeSeed", event.target.checked)} /><i /></label>
    </div>
    <div className="inspector-section compact-section"><h3>Routing</h3>
      <label className="form-row"><span>Output</span><select disabled={disabled} className="select-control" value={p.output} onChange={(event) => updateParameter("output", event.target.value)}><option>Sample Slots 01–16</option><option>Field A</option><option>Diagnostics Bus</option></select></label>
      <div className="segmented wide">{(["active", "muted", "bypassed"] as const).map((status) => <button disabled={disabled} key={status} className={p.status === status ? "active" : ""} onClick={() => updateParameter("status", status)}>{status[0].toUpperCase() + status.slice(1)}</button>)}</div>
    </div>
    <button disabled={disabled} className="reset-button" onClick={() => dispatch({ type: "reset-module", id: selectedModule.id })}>Reset to defaults</button>
  </div>;
}

export default function Home() {
  const isDevelopment = process.env.NODE_ENV === "development";
  const [state, dispatch] = useReducer(appReducer, undefined, createInitialState);
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [themeConfigs, setThemeConfigs] = useState<Record<ThemeMode, UIConfig>>({ light: BASELINE_UI_CONFIG, dark: DARK_UI_CONFIG });
  const [configHydrated, setConfigHydrated] = useState(false);
  const [clockNow, setClockNow] = useState(() => typeof performance === "undefined" ? 0 : performance.now());
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 520 });
  const [draftPoint, setDraftPoint] = useState<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const panDrag = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const userEditedRef = useRef(false);
  const uiConfig = themeConfigs[theme];
  const selectedModule = state.selection?.kind === "module" ? state.modules.find((module) => module.id === state.selection?.id) ?? null : null;
  const selectedConnection = state.selection?.kind === "connection" ? state.connections.find((connection) => connection.id === state.selection?.id) ?? null : null;
  const elapsedText = formatElapsed(getElapsedMs(state.session, clockNow));
  const activeModules = state.modules.filter((module) => module.enabled && module.parameters.status === "active").length;
  const selectedDiagnostic = state.selection ? `${state.selection.kind === "module" ? "M" : "T"}:${state.selection.id}` : "None";
  const benchmark = state.modules.length >= 32;

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(performance.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        if ((event.target as HTMLElement)?.matches("input, select, textarea")) return;
        dispatch({ type: "delete-selection" });
      }
      if (event.key === "Escape") dispatch({ type: "cancel-connection" });
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  const persistUIState = (nextTheme: ThemeMode, nextConfigs: Record<ThemeMode, UIConfig>, modules: ModuleInstance[]) => {
    if (!isDevelopment || typeof window === "undefined") return;
    const accents = Object.fromEntries(modules.map((module) => [module.id, module.accentId]));
    try { window.localStorage.setItem(UI_CONFIG_STORAGE_KEY, JSON.stringify({ revision: UI_CONFIG_REVISION, theme: nextTheme, configs: nextConfigs, accents })); } catch { /* Optional local preference. */ }
    try { window.localStorage.setItem(UI_THEME_STORAGE_KEY, nextTheme); } catch { /* Optional local preference. */ }
    try { window.localStorage.setItem(MODULE_ACCENTS_STORAGE_KEY, JSON.stringify(accents)); } catch { /* Optional local preference. */ }
  };
  const selectTheme = (nextTheme: ThemeMode) => { userEditedRef.current = true; setTheme(nextTheme); persistUIState(nextTheme, themeConfigs, state.modules); };
  const setUIConfig = (config: UIConfig) => { userEditedRef.current = true; const nextConfigs = { ...themeConfigs, [theme]: config }; setThemeConfigs(nextConfigs); persistUIState(theme, nextConfigs, state.modules); };
  const setHighlightStyle = (groupingAccentStyle: UIConfig["nodes"]["groupingAccentStyle"]) => setUIConfig({ ...uiConfig, nodes: { ...uiConfig.nodes, groupingAccentStyle } });
  const setHighlightWeight = (groupingAccentThickness: 1 | 1.5) => setUIConfig({ ...uiConfig, nodes: { ...uiConfig.nodes, groupingAccentThickness } });
  const updateParameter = <K extends keyof ModuleParameters>(key: K, value: ModuleParameters[K]) => { if (selectedModule) dispatch({ type: "update-parameter", id: selectedModule.id, key, value }); };

  useEffect(() => {
    if (!isDevelopment) return;
    try {
      const saved = window.localStorage.getItem(UI_CONFIG_STORAGE_KEY);
      const payload = saved ? JSON.parse(saved) as { revision?: string; theme?: ThemeMode; configs?: Partial<Record<ThemeMode, unknown>>; accents?: Record<string, AccentId | null> } : null;
      const savedTheme = window.localStorage.getItem(UI_THEME_STORAGE_KEY);
      const savedAccentsText = window.localStorage.getItem(MODULE_ACCENTS_STORAGE_KEY);
      const savedAccents = savedAccentsText ? JSON.parse(savedAccentsText) as Record<string, AccentId | null> : null;
      const validPayload = payload?.revision === UI_CONFIG_REVISION;
      window.setTimeout(() => {
        if (!userEditedRef.current) {
          setTheme(savedTheme === "light" || savedTheme === "dark" ? savedTheme : validPayload && (payload?.theme === "light" || payload?.theme === "dark") ? payload.theme : "light");
          setThemeConfigs(validPayload ? { light: mergeUIConfig(payload?.configs?.light, BASELINE_UI_CONFIG), dark: mergeUIConfig(payload?.configs?.dark, DARK_UI_CONFIG) } : { light: BASELINE_UI_CONFIG, dark: DARK_UI_CONFIG });
          const accents = savedAccents ?? (validPayload ? payload?.accents : null);
          if (accents) dispatch({ type: "load-state", value: { ...state, modules: state.modules.map((module) => ({ ...module, accentId: accents[module.id] ?? null })) } });
        }
        setConfigHydrated(true);
      }, 0);
    } catch { /* Invalid visual preferences fall back to the approved baseline. */ }
    // Initial repository preferences are restored once; application interaction state remains canonical in the reducer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDevelopment]);
  // Visual preferences and per-module grouping accents are device-local workshop state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (configHydrated) persistUIState(theme, themeConfigs, state.modules); }, [configHydrated, state.modules, theme, themeConfigs]);

  const saveSnapshot = (saveAs = false) => {
    try {
      const name = saveAs ? `RFE_User_${new Date().toISOString().slice(11, 19).replaceAll(":", "")}` : state.presetName;
      const snapshot = { ...state, presetName: name, pendingConnectionFrom: null, session: { running: false, startedAt: null, accumulatedMs: 0 } };
      window.localStorage.setItem(APP_SNAPSHOT_KEY, JSON.stringify(snapshot));
      if (saveAs) dispatch({ type: "set-preset-name", value: name });
      dispatch({ type: "set-status", value: `${name} saved locally` });
    } catch { dispatch({ type: "set-status", value: "Preset save unavailable" }); }
  };
  const loadPreset = (value: string) => {
    if (value === "default" || value === "benchmark") { dispatch({ type: "load-preset", value }); return; }
    try {
      const restored = sanitizeRestoredState(JSON.parse(window.localStorage.getItem(APP_SNAPSHOT_KEY) ?? "null"));
      if (restored) dispatch({ type: "load-state", value: restored }); else dispatch({ type: "set-status", value: "No saved user preset" });
    } catch { dispatch({ type: "set-status", value: "Saved preset is invalid" }); }
  };
  const canvasPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (state.pendingConnectionFrom) setDraftPoint({ x: (event.clientX - rect.left - state.pan.x) / (state.zoom / 100), y: (event.clientY - rect.top - state.pan.y) / (state.zoom / 100) });
    if (state.tool === "pan" && panDrag.current) dispatch({ type: "set-pan", value: { x: panDrag.current.originX + event.clientX - panDrag.current.startX, y: panDrag.current.originY + event.clientY - panDrag.current.startY } });
  };
  const canvasPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    const hitsInteractiveObject = Boolean(target.closest(".module-card, .thread-hit, .canvas-key"));
    if (!hitsInteractiveObject && state.pendingConnectionFrom) dispatch({ type: "cancel-connection" });
    if (state.tool === "pan" && !hitsInteractiveObject) { panDrag.current = { startX: event.clientX, startY: event.clientY, originX: state.pan.x, originY: state.pan.y }; event.currentTarget.setPointerCapture(event.pointerId); }
  };
  const nodeWidth = benchmark ? 108 : uiConfig.nodes.nodeWidth;
  const nodeHeight = benchmark ? 58 : uiConfig.layout.nodeMinHeight + 12;
  const stageStyle = { transform: `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom / 100})` };

  return <main className={`rfe-desktop ${state.layout === "compact" ? "layout-compact" : ""}`} data-theme={theme} data-diagnostics-focus={uiConfig.diagnostics.focusStyle} data-highlight-style={uiConfig.nodes.groupingAccentStyle} style={configToCSSVariables(uiConfig) as CSSProperties}>
    <div className="studio-label"><span className="brand-glyph">RFE</span><span>Prototype Test-Bed</span><div className="theme-switch" aria-label="Colour theme"><button className={theme === "light" ? "active" : ""} onClick={() => selectTheme("light")}>Light</button><button className={theme === "dark" ? "active" : ""} onClick={() => selectTheme("dark")}>Dark</button></div><i className={state.session.running ? "running" : "paused"}>{state.session.running ? "Test session active" : "Test session idle"}</i></div>
    <div className="studio-arrangement">
      <WindowFrame title="Audio Modules / Threads" className="main-window" trailing={<div className="elapsed-readout" aria-label="Elapsed test session time"><span>ELAPSED</span><b>{elapsedText}</b></div>}>
        <div className="main-body"><aside className="sidebar"><div className="project-lockup"><strong>RFE</strong><span>Resonant Field Engine</span><small>Interaction Test-Bed</small></div><nav aria-label="Workspace">{navItems.map((item, index) => <button key={item} className={state.activeNav === item ? "active" : ""} onClick={() => dispatch({ type: "set-nav", value: item })}><span>{["⌘", "≋", "ϟ", "⠿", "⌁"][index]}</span>{item}</button>)}</nav><div className="preset-panel"><label className="preset-label" htmlFor="preset-select">Preset</label><select id="preset-select" className="select-control" value={state.presetName === "RFE_32x32_Benchmark" ? "benchmark" : state.presetName.startsWith("RFE_User") ? "saved" : "default"} onChange={(event) => loadPreset(event.target.value)}><option value="default">RFE_Default_Test</option><option value="benchmark">RFE_32x32_Benchmark</option><option value="saved">Saved User Preset</option></select><div className="preset-actions"><button onClick={() => saveSnapshot(false)}>Save</button><button onClick={() => saveSnapshot(true)}>Save as…</button></div></div><button className={`engine-status ${state.session.running ? "running" : ""}`} onClick={() => dispatch({ type: "toggle-session", now: performance.now() })}><i /> {state.session.running ? "Pause Test Session" : "Start Test Session"}</button></aside>
          <div className="workspace-region"><div className="workspace-toolbar"><div className="tool-cluster" aria-label="Canvas tools"><button className={state.tool === "select" ? "tool-active" : ""} aria-label="Select tool" onClick={() => dispatch({ type: "set-tool", value: "select" })}>↖</button><button className={state.tool === "pan" ? "tool-active" : ""} aria-label="Pan tool" onClick={() => dispatch({ type: "set-tool", value: "pan" })}>✥</button><button className={state.gridVisible ? "tool-active" : ""} aria-label="Toggle grid" aria-pressed={state.gridVisible} onClick={() => dispatch({ type: "toggle-grid" })}>⠿</button></div><span className="workspace-context">{state.activeNav} workspace · {state.statusMessage}</span><div className="session-controls"><button onClick={() => dispatch({ type: "toggle-session", now: performance.now() })}>{state.session.running ? "Pause" : "Start"}</button><button onClick={() => dispatch({ type: "reset-session", now: performance.now() })}>Reset time</button></div><div className="zoom-control"><button aria-label="Zoom out" onClick={() => dispatch({ type: "set-zoom", value: state.zoom - 10 })}>−</button><span>{state.zoom}%</span><button aria-label="Zoom in" onClick={() => dispatch({ type: "set-zoom", value: state.zoom + 10 })}>＋</button></div><div className="layout-switch" aria-label="Layout mode"><button className={state.layout === "studio" ? "active" : ""} onClick={() => dispatch({ type: "set-layout", value: "studio" })}>Studio</button><button className={state.layout === "compact" ? "active" : ""} onClick={() => dispatch({ type: "set-layout", value: "compact" })}>Compact</button></div></div>
            {/* The canvas is an application interaction surface with pointer panning and Escape cancellation. */}
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
            <div ref={canvasRef} className={`node-canvas ${state.gridVisible ? "" : "no-grid"} ${state.tool === "pan" ? "pan-mode" : ""} ${benchmark ? "benchmark-canvas" : ""}`} role="application" tabIndex={0} aria-label="Audio module routing canvas" onPointerMove={canvasPointerMove} onPointerDown={canvasPointerDown} onPointerUp={() => { panDrag.current = null; }} onKeyDown={(event) => { if (event.key === "Escape") dispatch({ type: "cancel-connection" }); }}>
              <div className="canvas-stage" style={stageStyle}><ThreadLayer connections={state.connections} modules={state.modules} selectedId={selectedConnection?.id ?? null} canvasSize={canvasSize} nodeWidth={nodeWidth} nodeHeight={nodeHeight} pendingFrom={state.pendingConnectionFrom} draftPoint={draftPoint} onSelect={(id) => dispatch({ type: "select-connection", id })} />{state.modules.map((module) => <ModuleCard key={module.id} module={module} active={selectedModule?.id === module.id} pendingFrom={state.pendingConnectionFrom} state={state} onSelect={() => dispatch({ type: "select-module", id: module.id })} onMove={(position) => dispatch({ type: "move-module", id: module.id, position })} onBeginConnection={() => dispatch({ type: "begin-connection", fromModuleId: module.id })} onCommitConnection={() => dispatch({ type: "commit-connection", toModuleId: module.id })} />)}</div>
              <div className="canvas-key"><span><i className="key-active" /> Committed</span><span><i className="key-future" /> Unavailable</span></div>
            </div>
          </div></div>
      </WindowFrame>
      <WindowFrame title="Thread Inspector" className="inspector-window"><Inspector state={state} selectedModule={selectedModule} selectedConnection={selectedConnection} uiConfig={uiConfig} updateParameter={updateParameter} setAccent={(accentId) => selectedModule && dispatch({ type: "set-accent", id: selectedModule.id, accentId })} setHighlightStyle={setHighlightStyle} setHighlightWeight={setHighlightWeight} dispatch={dispatch} /></WindowFrame>
      <WindowFrame title="Diagnostics" className="diagnostics-window" compactControls><div className="diagnostics-content"><Metric label="Active Modules" value={String(activeModules)} unit={` / ${state.modules.length}`} /><Metric label="Active Threads" value={String(state.connections.length)} unit=" committed" /><Metric label="Selected Object" value={selectedDiagnostic} /><Metric label="State Updates" value={String(state.updateCount)} unit=" actions" /><Metric label="Elapsed Session" value={elapsedText} accent /><div className="diagnostic-footer"><span>Focus&nbsp; Unavailable</span><span>Preset&nbsp; {state.presetName}</span><span>Session&nbsp; {state.session.running ? "ACTIVE" : "IDLE"}</span></div></div></WindowFrame>
    </div>
    {isDevelopment && <UIWorkshop config={uiConfig} onChange={setUIConfig} onReset={() => setThemeConfigs((current) => ({ ...current, [theme]: theme === "light" ? BASELINE_UI_CONFIG : DARK_UI_CONFIG }))} />}
  </main>;
}
