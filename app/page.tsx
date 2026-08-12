"use client";

import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  AUDIO_FREQUENCY_MAX,
  AUDIO_FREQUENCY_MIN,
  applicationAudioRuntime,
  type AudioChannelSnapshot,
} from "./audio-runtime";
import { UIWorkshop } from "./ui-workshop";
import {
  getIncomingChannels,
  type ChannelId,
  type ChannelTerminalConnection,
  type IncomingChannel,
  type ThreadChannel,
} from "./channel-routing";
import {
  appReducer,
  canConnect,
  createInitialState,
  formatElapsed,
  getElapsedMs,
  getModuleDisplay,
  getSelectedModuleIds,
  MODULE_LIBRARY,
  sanitizeRestoredState,
  type AppState,
  type ModuleInstance,
  type ModuleParameters,
  type ModuleTemplateType,
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
import {
  WORKSPACES,
  getAdjacentWorkspace,
  getTransitionDirection,
  getWorkspace,
  type WorkspaceDirection,
  type WorkspaceId,
  type WorkspaceTransitionDirection,
} from "./workspace-navigation";
import {
  SPATIAL_COORDINATES,
  coordinateKey,
  coordinateLabel,
  createInitialSpatialRoutingState,
  getChannelsAtCoordinate,
  getCoordinateByKey,
  spatialRoutingReducer,
  type SpatialRoutingState,
} from "./spatial-routing";

const APP_SNAPSHOT_KEY = "rfe-interaction-harness-snapshot-v1";
const rootNotes = ["C2", "C3", "C4", "D3", "E3", "G3", "A3"];
const scales = ["Minor Pentatonic", "Major Pentatonic", "Chromatic", "Dorian"];
const durations = ["1/16", "1/8", "1/4", "1/2", "1 bar", "10 ms", "250 ms"];

function useAudioChannel(channelId: ChannelId) {
  const [, setRevision] = useState(0);
  useEffect(() => applicationAudioRuntime.subscribe(() => setRevision((value) => value + 1)), []);
  return applicationAudioRuntime.getChannelSnapshot(channelId);
}

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

function WorkspaceTitlebar({ id, title, trailing }: { id: string; title: string; trailing?: React.ReactNode }) {
  return <header className="window-titlebar spatial-workspace-titlebar">
    <div className="window-controls" aria-label="Window controls unavailable in this milestone">
      <button className="window-dot close" aria-label="Close window unavailable" disabled />
      <button className="window-dot minimise" aria-label="Minimise window unavailable" disabled />
      <button className="window-dot expand" aria-label="Expand window unavailable" disabled />
    </div>
    <div className="window-title"><span className="title-mark">⌁</span><h1 id={id}>{title}</h1></div>
    <div className="spatial-titlebar-trailing">{trailing}</div>
  </header>;
}

function ModuleCard({ module, active, pendingFrom, state, onSelect, onMove, onBeginConnection, onCommitConnection }: {
  module: ModuleInstance;
  active: boolean;
  pendingFrom: string | null;
  state: AppState;
  onSelect: (additive: boolean) => void;
  onMove: (position: { x: number; y: number }) => void;
  onBeginConnection: () => void;
  onCommitConnection: () => void;
}) {
  const accent = MUTED_ACCENTS.find((item) => item.id === module.accentId);
  const display = getModuleDisplay(module);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const validTarget = pendingFrom ? canConnect(state, pendingFrom, module.id).valid : false;
  const pointerDown = (event: PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest(".port")) return;
    event.stopPropagation();
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: module.position.x, originY: module.position.y, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const stage = event.currentTarget.closest(".canvas-stage")?.getBoundingClientRect();
    if (!stage) return;
    const dx = event.clientX - drag.current.startX;
    const dy = event.clientY - drag.current.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
    if (drag.current.moved) onMove({ x: drag.current.originX + dx / stage.width * 100, y: drag.current.originY + dy / stage.height * 100 });
  };
  const pointerUp = (event: PointerEvent<HTMLElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    suppressClick.current = drag.current.moved;
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
        onClick={(event) => {
          if (suppressClick.current) { suppressClick.current = false; return; }
          onSelect(event.shiftKey || event.metaKey || event.ctrlKey);
        }}
      >
        <span className="module-eyebrow">{module.eyebrow}</span>
        <span className="module-title">{module.title}</span>
        <span className="module-footer"><span>{display.detail}</span><strong>{display.value}</strong></span>
      </button>
    </div>
  );
}

function ThreadLayer({ connections, terminalConnections, channels, modules, selectedId, canvasSize, nodeWidth, nodeHeight, pendingFrom, draftPoint, onSelect }: {
  connections: ThreadConnection[];
  terminalConnections: readonly ChannelTerminalConnection[];
  channels: readonly ThreadChannel[];
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
  const terminalGeometry = (connection: ChannelTerminalConnection) => {
    const source = modules.find((module) => module.id === connection.fromModuleId);
    const channelIndex = channels.findIndex((channel) => channel.id === connection.channelId);
    if (!source || channelIndex < 0) return null;
    const channelCount = Math.max(1, channels.length);
    return {
      x1: source.position.x / 100 * canvasSize.width + nodeWidth,
      y1: source.position.y / 100 * canvasSize.height + nodeHeight / 2,
      x2: canvasSize.width - 72,
      y2: (channelIndex + .5) / channelCount * canvasSize.height,
    };
  };
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
      {terminalConnections.map((connection) => {
        const points = terminalGeometry(connection);
        const channel = channels.find((item) => item.id === connection.channelId);
        const accent = MUTED_ACCENTS.find((item) => item.id === channel?.accentId);
        return points ? <g key={connection.id} className="channel-output-thread" data-channel-output={connection.channelId} style={{ "--channel-color": accent?.value } as CSSProperties}><path className="thread-path" d={path(points)} /></g> : null;
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

function SpatialGrid({ state, variant, selectedCoordinateKey, onSelectCoordinate }: {
  state: SpatialRoutingState;
  variant: "sound-desk" | "inspection";
  selectedCoordinateKey?: string | null;
  onSelectCoordinate?: (coordinateKey: string) => void;
}) {
  return <div className={`spatial-grid spatial-grid-${variant}`} role="grid" aria-label={variant === "sound-desk" ? "Sound Desk shared 5 by 5 spatial grid" : "Visualiser routing inspection 5 by 5 spatial grid"}>
    {SPATIAL_COORDINATES.map((coordinate) => {
      const channels = getChannelsAtCoordinate(state, coordinate);
      const key = coordinateKey(coordinate);
      const className = `spatial-point ${coordinate.x === 0 && coordinate.y === 0 ? "spatial-origin" : ""} ${channels.length ? "spatial-occupied" : ""} ${selectedCoordinateKey === key ? "spatial-point-selected" : ""}`;
      const content = <>
        <span className="spatial-coordinate-label">{key}</span>
        <span className="spatial-node-stack">
          {channels.map((channel) => {
            const accent = MUTED_ACCENTS.find((item) => item.id === channel.accentId);
            const channelInk = channel.accentId === "utility-blue" ? "#ffffff" : "#111827";
            return <span key={channel.id} className="spatial-channel-node" data-channel-id={channel.id} style={{ "--channel-color": accent?.value, "--channel-ink": channelInk } as CSSProperties} title={`${channel.label} · ${coordinateLabel(coordinate)}`}>{channel.shortLabel.padStart(2, "0")}</span>;
          })}
        </span>
      </>;
      const ariaLabel = `Coordinate ${coordinateLabel(coordinate)}${channels.length ? ` · ${channels.map((channel) => channel.label).join(", ")}` : " · empty"}`;
      return onSelectCoordinate ? <button
        key={key}
        className={className}
        role="gridcell"
        aria-label={ariaLabel}
        aria-selected={selectedCoordinateKey === key}
        data-coordinate={key}
        onClick={() => onSelectCoordinate(key)}
      >{content}</button> : <div key={key} className={className} role="gridcell" aria-label={ariaLabel} data-coordinate={key}>{content}</div>;
    })}
  </div>;
}

function SpatialOrientation() {
  return <div className="spatial-orientation" aria-label="Coordinate orientation">
    <span>Y increases ↑</span><b>Origin (0,0)</b><span>X increases →</span>
  </div>;
}

function ChannelRail({ channels, selectedChannelId, onSelect }: { channels: IncomingChannel[]; selectedChannelId: ChannelId | null; onSelect: (channel: IncomingChannel) => void }) {
  return <section className="channel-rail" aria-labelledby="channel-rail-title">
    <div className="channel-rail-heading"><span id="channel-rail-title">CHANNEL RAIL</span><small>THREADS INPUT</small></div>
    <div className="channel-rail-track">
      {channels.map((channel) => {
        const accent = MUTED_ACCENTS.find((item) => item.id === channel.accentId);
        const channelInk = channel.accentId === "utility-blue" ? "#ffffff" : "#111827";
        const complete = channel.status === "complete";
        const stateLabel = complete ? "complete and routable" : "incomplete";
        return <button key={channel.id} className={`channel-rail-node ${channel.status} ${selectedChannelId === channel.id ? "selected" : ""}`} style={{ "--channel-color": accent?.value, "--channel-ink": channelInk } as CSSProperties} disabled={!complete} onClick={() => onSelect(channel)} aria-label={`${channel.label} · ${stateLabel}`} aria-pressed={complete ? selectedChannelId === channel.id : undefined} title={`${channel.label} · ${stateLabel}`}>
          <span aria-hidden="true">{complete ? channel.shortLabel.padStart(2, "0") : "/"}</span>
          <small aria-hidden="true">{channel.label}</small>
        </button>;
      })}
    </div>
    <div className="channel-rail-key" aria-hidden="true"><span><i className="complete" />Routable</span><span><i className="incomplete" />Incomplete</span></div>
  </section>;
}

function ChannelPlotter({ incoming, state, selectedChannelId, selectedCoordinateKey, dispatch }: {
  incoming: IncomingChannel[];
  state: SpatialRoutingState;
  selectedChannelId: ChannelId | null;
  selectedCoordinateKey: string | null;
  dispatch: React.Dispatch<Parameters<typeof spatialRoutingReducer>[1]>;
}) {
  const incomingChannel = incoming.find((channel) => channel.id === selectedChannelId && channel.status === "complete") ?? null;
  const spatialChannel = state.channels.find((channel) => channel.id === selectedChannelId) ?? null;
  const selectedCoordinate = selectedCoordinateKey ? getCoordinateByKey(selectedCoordinateKey) : null;
  const canPlot = Boolean(incomingChannel && spatialChannel && selectedCoordinate);
  return <aside className="channel-plotter" aria-labelledby="channel-plotter-title">
    <div className="channel-plotter-heading"><span className="fixture-kicker">ROUTING INSTRUMENT</span><h2 id="channel-plotter-title">Channel Plotter</h2><p>Select channel → select grid point → plot.</p></div>
    <div className="plotter-proposal" aria-live="polite">
      <span>PROPOSED ROUTE</span>
      <strong>{incomingChannel?.label ?? "NO CHANNEL"}<i>→</i>{selectedCoordinate ? coordinateLabel(selectedCoordinate) : "NO POINT"}</strong>
      <small>Current&nbsp; {spatialChannel?.assignment ? coordinateLabel(spatialChannel.assignment) : "UNPLOTTED"}</small>
    </div>
    <div className="plotter-actions">
      <button className="plot-action" disabled={!canPlot} onClick={() => { if (incomingChannel && selectedCoordinate) dispatch({ type: "assign-channel", channelId: incomingChannel.id, coordinate: selectedCoordinate }); }}>Plot route</button>
      <button disabled={!incomingChannel || !spatialChannel?.assignment} onClick={() => { if (incomingChannel) dispatch({ type: "unassign-channel", channelId: incomingChannel.id }); }}>Unplot</button>
    </div>
    <div className="plotted-channel-overview" aria-label="Plotted channel overview">
      <div className="plotter-overview-heading"><span>ROUTED CHANNELS</span><small>{state.channels.filter((channel) => channel.assignment).length} plotted</small></div>
      {incoming.map((channel) => {
        const route = state.channels.find((item) => item.id === channel.id);
        const accent = MUTED_ACCENTS.find((item) => item.id === channel.accentId);
        return <div className={`plotter-channel-row ${channel.status}`} data-channel-id={channel.id} key={channel.id} style={{ "--channel-color": accent?.value } as CSSProperties}>
          <i aria-hidden="true" /><b>{channel.label}</b><span>{channel.status === "complete" ? route?.assignment ? coordinateLabel(route.assignment) : "UNPLOTTED" : "INCOMPLETE"}</span><small>{channel.status === "complete" ? "ROUTABLE" : "AWAITING OUTPUT"}</small>
        </div>;
      })}
    </div>
  </aside>;
}

function SoundDeskWorkspace({ threadsState, state, dispatch }: {
  threadsState: AppState;
  state: SpatialRoutingState;
  dispatch: React.Dispatch<Parameters<typeof spatialRoutingReducer>[1]>;
}) {
  const incoming = getIncomingChannels(threadsState);
  const [selectedChannelId, setSelectedChannelId] = useState<ChannelId | null>("channel-01");
  const [selectedCoordinateKey, setSelectedCoordinateKey] = useState<string | null>("0,0");
  const effectiveSelectedChannelId = incoming.some((channel) => channel.id === selectedChannelId) ? selectedChannelId : incoming.find((channel) => channel.status === "complete")?.id ?? null;
  const selectChannel = (channel: IncomingChannel) => {
    if (channel.status !== "complete") return;
    setSelectedChannelId(channel.id);
    const current = state.channels.find((item) => item.id === channel.id)?.assignment;
    if (current) setSelectedCoordinateKey(coordinateKey(current));
  };
  return <section className="future-workspace spatial-workspace sound-desk-workspace" aria-labelledby="sound-desk-title" data-workspace-surface="sound-desk">
    <WorkspaceTitlebar id="sound-desk-title" title="Sound Desk / Channel Routing" trailing={<span className="spatial-model-status">{incoming.filter((channel) => channel.status === "complete").length} routable · 25 points</span>} />
    <ChannelRail channels={incoming} selectedChannelId={effectiveSelectedChannelId} onSelect={selectChannel} />
    <div className="sound-desk-routing-instrument">
      <div className="spatial-grid-panel"><SpatialGrid state={state} variant="sound-desk" selectedCoordinateKey={selectedCoordinateKey} onSelectCoordinate={setSelectedCoordinateKey} /><SpatialOrientation /></div>
      <ChannelPlotter incoming={incoming} state={state} selectedChannelId={effectiveSelectedChannelId} selectedCoordinateKey={selectedCoordinateKey} dispatch={dispatch} />
    </div>
    <details className="orchestra-placeholder"><summary>ORCHESTRA / ADVANCED <span>Reserved</span></summary></details>
  </section>;
}

function VisualiserWorkspace({ state }: { state: SpatialRoutingState }) {
  const [inspectionVisible, setInspectionVisible] = useState(false);
  return <section className="future-workspace spatial-workspace visualiser-workspace" aria-labelledby="visualiser-title" data-workspace-surface="visualiser">
    <WorkspaceTitlebar id="visualiser-title" title="Visualiser" trailing={<button className="inspection-toggle" aria-pressed={inspectionVisible} onClick={() => setInspectionVisible((value) => !value)}>{inspectionVisible ? "Hide routing inspection" : "Reveal routing inspection"}</button>} />
    <div className="visualiser-surface" aria-label="Visualiser workspace surface">
      <div className="visualiser-empty-state"><span>VISUAL FIELD</span><small>No simulation system active</small></div>
      {inspectionVisible && <div className="routing-inspection-layer" aria-label="Routing inspection layer">
        <div className="inspection-heading"><span>ROUTING INSPECTION</span><small>{state.channels.filter((channel) => channel.assignment).length} assigned channels</small></div>
        <SpatialGrid state={state} variant="inspection" />
        <SpatialOrientation />
      </div>}
    </div>
  </section>;
}

function ThreadChannelBands({ channels }: { channels: readonly ThreadChannel[] }) {
  return <div className="thread-channel-bands" aria-hidden="true">
    {channels.map((channel) => {
      const accent = MUTED_ACCENTS.find((item) => item.id === channel.accentId);
      return <div className="thread-channel-band" key={channel.id} style={{ "--channel-color": accent?.value } as CSSProperties}><span>{channel.shortLabel.padStart(2, "0")}</span></div>;
    })}
  </div>;
}

function ChannelOutputTerminals({ state, dispatch }: { state: AppState; dispatch: React.Dispatch<Parameters<typeof appReducer>[1]> }) {
  const incoming = getIncomingChannels(state);
  return <div className="channel-output-terminals" aria-label="Thread channel output terminals">
    {incoming.map((channel, index) => {
      const accent = MUTED_ACCENTS.find((item) => item.id === channel.accentId);
      const complete = channel.status === "complete";
      return <div className={`channel-output-terminal ${complete ? "complete" : "incomplete"}`} data-channel-id={channel.id} key={channel.id} style={{ top: `${(index + .5) / Math.max(1, incoming.length) * 100}%`, "--channel-color": accent?.value } as CSSProperties} aria-label={`${channel.label} output ${complete ? "complete" : "incomplete"}`}>
        <button className="channel-terminal-input" aria-disabled={complete || !state.pendingConnectionFrom} aria-label={`${channel.label} output terminal ${complete ? "complete" : "incomplete"}`} onClick={(event) => {
          event.stopPropagation();
          if (!complete && state.pendingConnectionFrom) dispatch({ type: "commit-channel-output", channelId: channel.id });
          else dispatch({ type: "set-status", value: complete ? `${channel.label} is routed to Sound Desk` : `Choose a module output to complete ${channel.label}` });
        }}><span>{channel.shortLabel.padStart(2, "0")}</span></button>
        {complete && <button className="channel-terminal-unlink" aria-label={`Disconnect ${channel.label} output`} title={`Make ${channel.label} incomplete`} onClick={(event) => { event.stopPropagation(); dispatch({ type: "remove-channel-output", channelId: channel.id }); }}>×</button>}
      </div>;
    })}
  </div>;
}

function WorkspaceNavigation({ workspace, navigate }: {
  workspace: WorkspaceId;
  navigate: (direction: WorkspaceDirection) => void;
}) {
  const previous = getAdjacentWorkspace(workspace, "previous");
  const next = getAdjacentWorkspace(workspace, "next");
  return <>
    {previous && <div className="workspace-edge workspace-edge-previous">
      <button onClick={() => navigate("previous")} aria-label={`Go to ${getWorkspace(previous).label}`}>
        <span aria-hidden="true">←</span><small>{getWorkspace(previous).label}</small>
      </button>
    </div>}
    {next && <div className="workspace-edge workspace-edge-next">
      <button onClick={() => navigate("next")} aria-label={`Go to ${getWorkspace(next).label}`}>
        <small>{getWorkspace(next).label}</small><span aria-hidden="true">→</span>
      </button>
    </div>}
    <nav className="touch-workspace-navigation" aria-label="Workspace navigation">
      {previous && <button onClick={() => navigate("previous")} aria-label={`Go to ${getWorkspace(previous).label}`}><span aria-hidden="true">←</span></button>}
      <output aria-live="polite">{getWorkspace(workspace).position} / {WORKSPACES.length}</output>
      {next && <button onClick={() => navigate("next")} aria-label={`Go to ${getWorkspace(next).label}`}><span aria-hidden="true">→</span></button>}
    </nav>
  </>;
}

function Inspector({ state, selectedModule, selectedModules, selectedConnection, uiConfig, updateParameter, setAccent, setHighlightStyle, setHighlightWeight, dispatch }: {
  state: AppState;
  selectedModule: ModuleInstance | null;
  selectedModules: ModuleInstance[];
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
    return <div className="inspector-content"><div className="selection-summary"><span>Selected Thread</span><strong>{selectedConnection.id}</strong><small>{source?.title} → {target?.title}</small></div><details className="inspector-section"><summary>Connection</summary><div className="connection-summary"><span>Output</span><b>{source?.title}</b><span>Input</span><b>{target?.title}</b><span>State</span><b>Committed</b></div></details><button className="reset-button danger" onClick={() => dispatch({ type: "remove-connection", id: selectedConnection.id })}>Disconnect Thread</button><p className="inspector-note">Delete or Backspace also disconnects the selected Thread.</p></div>;
  }
  if (selectedModules.length > 1) return <div className="inspector-content batch-inspector">
    <div className="selection-summary"><span>Batch selected</span><strong>{selectedModules.length} modules</strong><small>{selectedModules.map((module) => module.title).join(" · ")}</small></div>
    <details className="inspector-section"><summary>Batch actions</summary><p className="inspector-note">Drag any selected module to move the whole group. Shift-click toggles membership.</p><div className="lifecycle-actions"><button onClick={() => dispatch({ type: "duplicate-selection" })}>Duplicate batch</button><button className="danger" onClick={() => dispatch({ type: "delete-selection" })}>Delete batch</button></div></details>
  </div>;
  if (!selectedModule) return <div className="inspector-content empty-inspector">Select a module or Thread.</div>;
  const disabled = !selectedModule.enabled;
  const p = selectedModule.parameters;
  return <div className="inspector-content">
    <div className="selection-summary"><span>Selected</span><strong>{selectedModule.title}</strong><small>{selectedModule.id} · {selectedModule.eyebrow}</small></div>
    <label className="rename-field"><span>Node name</span><input aria-label="Node name" maxLength={48} value={selectedModule.title} onChange={(event) => dispatch({ type: "rename-module", id: selectedModule.id, title: event.target.value })} /></label>
    <details className="inspector-section appearance-section"><summary>Appearance</summary><AccentSelector value={selectedModule.accentId} style={uiConfig.nodes.groupingAccentStyle} weight={uiConfig.nodes.groupingAccentThickness} disabled={disabled} onChange={setAccent} onStyleChange={setHighlightStyle} onWeightChange={setHighlightWeight} /></details>
    {disabled && <div className="unavailable-notice" role="status">Future module — controls and connections are unavailable.</div>}
    <details className="inspector-section"><summary>Note / Chord</summary>
      <div className="segmented">{(["mono", "poly", "arp"] as const).map((mode) => <button disabled={disabled} key={mode} className={p.mode === mode ? "active" : ""} onClick={() => updateParameter("mode", mode)}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}</div>
      <label className="form-row"><span>Note Source</span><select disabled={disabled} className="select-control" value={p.noteSource} onChange={(event) => updateParameter("noteSource", event.target.value)}><option>Chord Trigger</option><option>Note Buttons</option><option>Custom Note</option></select></label>
      <label className="form-row"><span>Root Note</span><select disabled={disabled} className="select-control" value={p.rootNote} onChange={(event) => updateParameter("rootNote", event.target.value)}>{rootNotes.map((note) => <option key={note}>{note}</option>)}</select></label>
      <label className="form-row"><span>Scale</span><select disabled={disabled} className="select-control" value={p.scale} onChange={(event) => updateParameter("scale", event.target.value)}>{scales.map((scale) => <option key={scale}>{scale}</option>)}</select></label>
    </details>
    <details className="inspector-section"><summary>Timing</summary>
      <label className="form-row"><span>Duration</span><select disabled={disabled} className="select-control" value={p.duration} onChange={(event) => updateParameter("duration", event.target.value)}>{durations.map((duration) => <option key={duration}>{duration}</option>)}</select></label>
      <SliderField disabled={disabled} label="Swing" value={p.swing} onChange={(value) => updateParameter("swing", value)} />
      <SliderField disabled={disabled} label="Humanize" value={p.humanize} onChange={(value) => updateParameter("humanize", value)} />
    </details>
    <details className="inspector-section"><summary>Injection</summary>
      <SliderField disabled={disabled} label="Inject Strength" value={p.injectStrength} onChange={(value) => updateParameter("injectStrength", value)} />
      <SliderField disabled={disabled} label="Seed Weight" value={p.seedWeight} onChange={(value) => updateParameter("seedWeight", value)} />
      <label className="toggle-row"><span>Randomize Seed</span><input disabled={disabled} type="checkbox" checked={p.randomizeSeed} onChange={(event) => updateParameter("randomizeSeed", event.target.checked)} /><i /></label>
    </details>
    <details className="inspector-section compact-section"><summary>Routing</summary>
      <label className="form-row"><span>Output</span><select disabled={disabled} className="select-control" value={p.output} onChange={(event) => updateParameter("output", event.target.value)}><option>Sample Slots 01–16</option><option>Field A</option><option>Diagnostics Bus</option></select></label>
      <div className="segmented wide">{(["active", "muted", "bypassed"] as const).map((status) => <button disabled={disabled} key={status} className={p.status === status ? "active" : ""} onClick={() => updateParameter("status", status)}>{status[0].toUpperCase() + status.slice(1)}</button>)}</div>
    </details>
    <div className="lifecycle-actions"><button disabled={disabled} onClick={() => dispatch({ type: "reset-module", id: selectedModule.id })}>Reset defaults</button><button onClick={() => dispatch({ type: "duplicate-selection" })}>Duplicate</button><button className="danger" onClick={() => dispatch({ type: "delete-selection" })}>Delete</button></div>
  </div>;
}

function InputsAndChannels({ state, collapsed, onToggle, dispatch }: {
  state: AppState;
  collapsed: boolean;
  onToggle: () => void;
  dispatch: React.Dispatch<Parameters<typeof appReducer>[1]>;
}) {
  const incoming = getIncomingChannels(state);
  const audio = useAudioChannel("channel-01");
  return <aside className={`inputs-sidebar ${collapsed ? "collapsed" : ""}`} aria-label="Inputs and Channels">
    <header><button className="sidebar-collapse" aria-label={collapsed ? "Expand Inputs and Channels" : "Collapse Inputs and Channels"} aria-expanded={!collapsed} onClick={onToggle}>{collapsed ? "→" : "←"}</button>{!collapsed && <div><strong>INPUTS &amp; CHANNELS</strong><small>INTRODUCE</small></div>}</header>
    {!collapsed && <>
      <button className="add-channel-action" onClick={() => dispatch({ type: "add-channel" })}>＋ ADD CHANNEL</button>
      <div className="input-channel-list" aria-label={`${incoming.length} active channel${incoming.length === 1 ? "" : "s"}`}>
        {incoming.map((channel) => <div className={`input-channel-fixture ${state.selection?.kind === "channel" && state.selection.id === channel.id ? "selected" : ""}`} key={channel.id} data-channel-id={channel.id}>
          <div className="input-channel-row">
            <button className="channel-select" onClick={() => dispatch({ type: "select-channel", channelId: channel.id })} aria-pressed={state.selection?.kind === "channel" && state.selection.id === channel.id}><span>{channel.label}</span><small>{channel.id === "channel-01" ? audio.active ? "SINE · ACTIVE" : "SINE · SILENT" : channel.status === "complete" ? "OUTPUT READY" : "AWAITING OUTPUT"}</small></button>
            <button className="channel-remove" aria-label={`Remove ${channel.label}`} onClick={() => { if (window.confirm(`Remove ${channel.label} and its downstream route?`)) { applicationAudioRuntime.disposeChannel(channel.id); dispatch({ type: "remove-channel", channelId: channel.id }); } }}>×</button>
          </div>
          {channel.id === "channel-01" && <div className="audio-test-controls" aria-label="CH 01 sine signal controls">
            <div className="audio-state-line" role="status"><span className={audio.active ? "active" : "silent"} /> <b>{audio.active ? "ACTIVE" : audio.availability === "error" ? "ERROR" : "SILENT"}</b><small>{audio.message}</small></div>
            <div className="frequency-control">
              <div className="frequency-heading"><span>FREQUENCY</span><output aria-live="polite">{audio.frequency} Hz</output></div>
              <input aria-label="CH 01 sine frequency" type="range" min={AUDIO_FREQUENCY_MIN} max={AUDIO_FREQUENCY_MAX} step="1" value={audio.frequency} onChange={(event) => applicationAudioRuntime.setFrequency(channel.id, Number(event.target.value))} />
              <div className="frequency-stepper" aria-label="CH 01 precise frequency controls">
                <button aria-label="Decrease CH 01 frequency by 1 Hz" disabled={audio.frequency <= AUDIO_FREQUENCY_MIN} onClick={() => applicationAudioRuntime.setFrequency(channel.id, audio.frequency - 1)}>−</button>
                <small>1 HZ</small>
                <button aria-label="Increase CH 01 frequency by 1 Hz" disabled={audio.frequency >= AUDIO_FREQUENCY_MAX} onClick={() => applicationAudioRuntime.setFrequency(channel.id, audio.frequency + 1)}>+</button>
              </div>
            </div>
            <label className="level-control"><span>LEVEL</span><div className="level-dial" style={{ "--level-angle": `${-135 + audio.level * 2.7}deg` } as CSSProperties}><i /></div><output>{audio.level}%</output><input aria-label="CH 01 level" type="range" min="0" max="100" step="1" value={audio.level} onChange={(event) => applicationAudioRuntime.setLevel(channel.id, Number(event.target.value))} /></label>
            <button className={`signal-toggle ${audio.active ? "stop" : "start"}`} onClick={() => { dispatch({ type: "select-channel", channelId: channel.id }); if (audio.active) applicationAudioRuntime.stopChannel(channel.id); else void applicationAudioRuntime.startChannel(channel.id); }}>{audio.active ? "STOP SINE" : "START SINE"}</button>
          </div>}
        </div>)}
      </div>
      <div className="future-inputs" aria-label="Future source types reserved"><span>SOURCES</span><p>Import File · Mic / Live · Capture / Loop · Saved Sources</p><small>Reserved for a future milestone</small></div>
    </>}
  </aside>;
}

function SignalTrace({ audio }: { audio: AudioChannelSnapshot }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audio.active) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let frame = 0;
    const draw = () => {
      const data = applicationAudioRuntime.getWaveform("channel-01");
      const width = canvas.width;
      const height = canvas.height;
      context.clearRect(0, 0, width, height);
      context.strokeStyle = getComputedStyle(canvas).color;
      context.lineWidth = 1.5;
      context.beginPath();
      if (data) data.forEach((value, index) => {
        const x = index / Math.max(1, data.length - 1) * width;
        const y = (0.5 - value * 0.42) * height;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.stroke();
      frame = window.requestAnimationFrame(draw);
    };
    draw();
    return () => window.cancelAnimationFrame(frame);
  }, [audio.active]);
  return <div className={`signal-monitor ${audio.active ? "signal-active" : ""}`} aria-label={audio.active ? `Real CH 01 signal active at ${audio.frequency} hertz` : "Signal monitor idle; no signal"}>
    <canvas ref={canvasRef} width="360" height="72" aria-hidden="true" />
    {!audio.active && <><div className="signal-baseline" aria-hidden="true" /><strong>{audio.availability === "error" ? "AUDIO ERROR" : "NO SIGNAL"}</strong><small>{audio.message}</small></>}
    {audio.active && <small>REAL SIGNAL · ANALYSER</small>}
  </div>;
}

function Monitor({ state, selectedModule, selectedModules, selectedConnection, audio }: {
  state: AppState;
  selectedModule: ModuleInstance | null;
  selectedModules: ModuleInstance[];
  selectedConnection: ThreadConnection | null;
  audio: AudioChannelSnapshot;
}) {
  const selectedChannel = state.selection?.kind === "channel" ? state.threadChannels.find((channel) => channel.id === state.selection?.id) ?? null : null;
  const sourceChannel = selectedModule ? state.channelTerminalConnections.find((connection) => connection.fromModuleId === selectedModule.id)?.channelId : null;
  const currentChannel = selectedChannel ?? state.threadChannels.find((channel) => channel.id === sourceChannel) ?? state.threadChannels[0] ?? null;
  const display = selectedModule ? getModuleDisplay(selectedModule) : null;
  const audioFocused = currentChannel?.id === "channel-01" && (selectedChannel?.id === "channel-01" || !selectedModule && !selectedConnection);
  const focusTitle = audioFocused ? "SINE" : selectedModules.length > 1 ? `${selectedModules.length} NODES` : selectedModule ? selectedModule.title : selectedConnection ? "THREAD" : selectedChannel ? selectedChannel.label : "IDLE";
  const focusType = audioFocused ? `${audio.frequency} Hz · LEVEL ${audio.level}%` : selectedModule ? selectedModule.type.replaceAll("-", " ").toUpperCase() : selectedConnection ? "COMMITTED CONNECTION" : selectedChannel ? "CHANNEL OUTPUT" : "NO OBJECT SELECTED";
  const focusDetail = audioFocused ? audio.active ? "ACTIVE · CENTRED OUTPUT" : audio.availability === "error" ? audio.message : "SILENT · READY" : selectedModule && display ? `${display.detail} · ${display.value}` : selectedConnection ? selectedConnection.id : selectedChannel ? (state.channelTerminalConnections.some((connection) => connection.channelId === selectedChannel.id) ? "OUTPUT READY" : "AWAITING OUTPUT") : "Select a node, Thread, or channel";
  return <div className="monitor-content" role="status" aria-live="polite" aria-label="Selection monitor">
    <div className="monitor-focus"><span>CURRENT FOCUS</span><strong>{currentChannel ? `${currentChannel.label} / ${String(state.threadChannels.length).padStart(2, "0")}` : "NO CHANNEL"}</strong><small>{focusTitle}</small></div>
    <div className="monitor-object"><span>OBJECT</span><strong>{focusType}</strong><small>{focusDetail}</small></div>
    <SignalTrace audio={audio} />
    <div className="monitor-session"><span>AUDIO</span><strong>{audio.active ? "ACTIVE" : audio.availability === "error" ? "ERROR" : "SILENT"}</strong><small>{audio.active ? `${audio.frequency} Hz · ${audio.level}%` : audio.message}</small></div>
  </div>;
}

export default function Home() {
  const isDevelopment = process.env.NODE_ENV === "development";
  const [state, dispatch] = useReducer(appReducer, undefined, createInitialState);
  const [spatialRouting, dispatchSpatialRouting] = useReducer(spatialRoutingReducer, undefined, createInitialSpatialRoutingState);
  useEffect(() => {
    dispatchSpatialRouting({ type: "sync-channels", channels: state.threadChannels });
  }, [state.threadChannels]);
  useEffect(() => {
    const routableIds = new Set(getIncomingChannels(state).filter((channel) => channel.status === "complete").map((channel) => channel.id));
    spatialRouting.channels.forEach((channel) => {
      if (channel.assignment && !routableIds.has(channel.id)) dispatchSpatialRouting({ type: "unassign-channel", channelId: channel.id });
    });
  }, [spatialRouting.channels, state]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>("threads");
  const [workspaceTransition, setWorkspaceTransition] = useState<WorkspaceTransitionDirection | null>(null);
  const [workspaceTransitionKey, setWorkspaceTransitionKey] = useState(0);
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [themeConfigs, setThemeConfigs] = useState<Record<ThemeMode, UIConfig>>({ light: BASELINE_UI_CONFIG, dark: DARK_UI_CONFIG });
  const [configHydrated, setConfigHydrated] = useState(false);
  const [clockNow, setClockNow] = useState(() => typeof performance === "undefined" ? 0 : performance.now());
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 520 });
  const [narrowViewport, setNarrowViewport] = useState(false);
  const [draftPoint, setDraftPoint] = useState<{ x: number; y: number } | null>(null);
  const [addModuleType, setAddModuleType] = useState<ModuleTemplateType>("note-length");
  const [inputsCollapsed, setInputsCollapsed] = useState(false);
  const [toolbarExpanded, setToolbarExpanded] = useState(false);
  const audio = useAudioChannel("channel-01");
  const canvasRef = useRef<HTMLDivElement>(null);
  const panDrag = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const userEditedRef = useRef(false);
  const uiConfig = themeConfigs[theme];
  const selectedModuleIds = getSelectedModuleIds(state.selection);
  const selectedModules = state.modules.filter((module) => selectedModuleIds.includes(module.id));
  const selectedModule = selectedModules.length === 1 ? selectedModules[0] : null;
  const selectedConnection = state.selection?.kind === "connection" ? state.connections.find((connection) => connection.id === state.selection?.id) ?? null : null;
  const elapsedText = formatElapsed(getElapsedMs(state.session, clockNow));
  const benchmark = state.modules.length >= 32;

  useEffect(() => {
    (window as Window & { __rfeAudioRuntime?: typeof applicationAudioRuntime }).__rfeAudioRuntime = applicationAudioRuntime;
    return () => { delete (window as Window & { __rfeAudioRuntime?: typeof applicationAudioRuntime }).__rfeAudioRuntime; };
  }, []);

  useEffect(() => {
    if (!state.session.running) return;
    const timer = window.setInterval(() => setClockNow(performance.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [state.session.running]);
  useEffect(() => {
    if (activeWorkspace !== "threads") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const updateCanvasSize = (width: number, height: number) => {
      if (width > 0 && height > 0) setCanvasSize({ width, height });
    };
    const bounds = canvas.getBoundingClientRect();
    updateCanvasSize(bounds.width, bounds.height);
    const observer = new ResizeObserver(([entry]) => updateCanvasSize(entry.contentRect.width, entry.contentRect.height));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [activeWorkspace]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 980px)");
    const update = () => setNarrowViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
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
    const stage = event.currentTarget.querySelector(".canvas-stage")?.getBoundingClientRect();
    if (state.pendingConnectionFrom && stage) setDraftPoint({ x: (event.clientX - stage.left) / (state.zoom / 100), y: (event.clientY - stage.top) / (state.zoom / 100) });
    if (state.tool === "pan" && panDrag.current) dispatch({ type: "set-pan", value: { x: panDrag.current.originX + event.clientX - panDrag.current.startX, y: panDrag.current.originY + event.clientY - panDrag.current.startY } });
  };
  const canvasPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    const hitsInteractiveObject = Boolean(target.closest(".module-card, .thread-hit, .channel-output-terminal, .canvas-key"));
    if (!hitsInteractiveObject && state.pendingConnectionFrom) dispatch({ type: "cancel-connection" });
    if (state.tool === "pan" && !hitsInteractiveObject) { panDrag.current = { startX: event.clientX, startY: event.clientY, originX: state.pan.x, originY: state.pan.y }; event.currentTarget.setPointerCapture(event.pointerId); }
  };
  const nodeWidth = benchmark ? 108 : uiConfig.nodes.nodeWidth;
  // Text and footer content establish a small intrinsic floor below the configured minimum.
  // Thread geometry must use the effective rendered height so paths continue to meet port centres.
  const nodeHeight = benchmark ? 58 : Math.max(uiConfig.layout.nodeMinHeight + 12, 66.3);
  const nodeScale = state.layout === "compact" && !narrowViewport ? .9 : 1;
  const extendedCanvasSize = { width: canvasSize.width * state.workspaceWidth / 100, height: canvasSize.height };
  const stageStyle = { transform: `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom / 100})` };
  const activeWorkspaceDefinition = getWorkspace(activeWorkspace);
  const navigateWorkspace = (direction: WorkspaceDirection) => {
    const destination = getAdjacentWorkspace(activeWorkspace, direction);
    if (!destination) return;
    const transition = getTransitionDirection(activeWorkspace, destination);
    if (!transition) return;
    if (activeWorkspace === "threads") dispatch({ type: "cancel-connection" });
    setWorkspaceTransition(transition);
    setWorkspaceTransitionKey((value) => value + 1);
    setActiveWorkspace(destination);
  };

  return <main className={`rfe-desktop ${state.layout === "compact" ? "layout-compact" : ""}`} data-theme={theme} data-diagnostics-focus={uiConfig.diagnostics.focusStyle} data-highlight-style={uiConfig.nodes.groupingAccentStyle} data-current-workspace={activeWorkspace} style={configToCSSVariables(uiConfig) as CSSProperties}>
    <div className="studio-label"><span className="brand-glyph">RFE</span><span>Prototype Test-Bed</span><span className="workspace-position" aria-live="polite"><b>{activeWorkspaceDefinition.label}</b><small>{String(activeWorkspaceDefinition.position).padStart(2, "0")} / {String(WORKSPACES.length).padStart(2, "0")}</small></span><div className="theme-switch" aria-label="Colour theme"><button className={theme === "light" ? "active" : ""} onClick={() => selectTheme("light")}>Light</button><button className={theme === "dark" ? "active" : ""} onClick={() => selectTheme("dark")}>Dark</button></div><div className="elapsed-readout shell-elapsed-readout" aria-label="Elapsed test session time"><span>ELAPSED</span><b>{elapsedText}</b></div><i className={state.session.running ? "running" : "paused"}>{state.session.running ? "Test session active" : "Test session idle"}</i></div>
    <div key={`${activeWorkspace}-${workspaceTransitionKey}`} className={`workspace-surface ${workspaceTransition ? `workspace-enter-${workspaceTransition}` : ""}`}>
    {activeWorkspace === "threads" ? <div className="studio-arrangement" aria-label="Threads workspace" data-workspace-surface="threads">
      <WindowFrame title="Threads / Construction" className="main-window" trailing={<span aria-hidden="true" />}>
        <div className={`main-body ${inputsCollapsed ? "inputs-collapsed" : ""}`}>
          <InputsAndChannels state={state} collapsed={inputsCollapsed} onToggle={() => setInputsCollapsed((value) => !value)} dispatch={dispatch} />
          <div className="workspace-region"><div className="workspace-toolbar"><div className="tool-cluster" aria-label="Canvas tools"><button className={state.tool === "select" ? "tool-active" : ""} aria-label="Select tool" onClick={() => dispatch({ type: "set-tool", value: "select" })}>↖</button><button className={state.tool === "pan" ? "tool-active" : ""} aria-label="Pan tool" onClick={() => dispatch({ type: "set-tool", value: "pan" })}>✥</button><button className={state.gridVisible ? "tool-active" : ""} aria-label="Toggle grid" aria-pressed={state.gridVisible} onClick={() => dispatch({ type: "toggle-grid" })}>⠿</button></div><span className="workspace-context">THREAD CONSTRUCTION · {state.statusMessage}</span><div className="session-controls"><button onClick={() => dispatch({ type: "toggle-session", now: performance.now() })}>{state.session.running ? "Pause" : "Start"}</button><button onClick={() => dispatch({ type: "reset-session", now: performance.now() })}>Reset time</button></div><div className="zoom-control"><button aria-label="Zoom out" onClick={() => dispatch({ type: "set-zoom", value: state.zoom - 10 })}>−</button><span>{state.zoom}%</span><button aria-label="Zoom in" onClick={() => dispatch({ type: "set-zoom", value: state.zoom + 10 })}>＋</button></div><div className="layout-switch" aria-label="Layout mode"><button className={state.layout === "studio" ? "active" : ""} onClick={() => dispatch({ type: "set-layout", value: "studio" })}>Studio</button><button className={state.layout === "compact" ? "active" : ""} onClick={() => dispatch({ type: "set-layout", value: "compact" })}>Compact</button></div><button className="toolbar-toggle" aria-expanded={toolbarExpanded} aria-controls="workspace-secondary-tools" onClick={() => setToolbarExpanded((value) => !value)}>{toolbarExpanded ? "Hide tools ↑" : "More tools ↓"}</button></div>
            {toolbarExpanded && <div id="workspace-secondary-tools" className="workspace-editbar" aria-label="Module editing tools">
              <label><span>Add</span><select aria-label="Module type to add" value={addModuleType} onChange={(event) => setAddModuleType(event.target.value as ModuleTemplateType)}>{MODULE_LIBRARY.map((item) => <option key={item.type} value={item.type}>{item.title}</option>)}</select></label>
              <button onClick={() => dispatch({ type: "add-module", moduleType: addModuleType })}>Add module</button>
              <div className="workspace-width-controls" aria-label="Workspace width controls">
                <span className="workspace-size" aria-live="polite">{Math.round(extendedCanvasSize.width)} px · {state.workspaceWidth}%</span>
                <button aria-label={state.workspaceWidthDirection === "extend" ? "Extend workspace by 50%" : "Retract workspace by 50%"} onClick={() => dispatch({ type: "step-workspace-width" })}>{state.workspaceWidthDirection === "extend" ? "Extend +50%" : "Retract −50%"}</button>
              </div>
              <i aria-hidden="true" />
              <button onClick={() => dispatch({ type: "select-all-modules" })}>Select all</button>
              <button disabled={!selectedModuleIds.length} onClick={() => dispatch({ type: "duplicate-selection" })}>Duplicate selected</button>
              <button disabled={!selectedModuleIds.length} className="danger" onClick={() => dispatch({ type: "delete-selection" })}>Delete selected</button>
              <button disabled={!state.modules.length} className="danger clear-workspace" onClick={() => { if (window.confirm("Clear all modules and Threads from the workspace?")) dispatch({ type: "clear-workspace" }); }}>Clear workspace</button>
              <label className="toolbar-preset"><span>Preset</span><select aria-label="Preset" value={state.presetName === "RFE_32x32_Benchmark" ? "benchmark" : state.presetName.startsWith("RFE_User") ? "saved" : "default"} onChange={(event) => loadPreset(event.target.value)}><option value="default">RFE_Default_Test</option><option value="benchmark">RFE_32x32_Benchmark</option><option value="saved">Saved User Preset</option></select></label>
              <button onClick={() => saveSnapshot(false)}>Save</button><button onClick={() => saveSnapshot(true)}>Save as…</button>
            </div>}
            {/* The canvas is an application interaction surface with pointer panning and Escape cancellation. */}
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
            <div ref={canvasRef} className={`node-canvas ${state.gridVisible ? "" : "no-grid"} ${state.tool === "pan" ? "pan-mode" : ""} ${benchmark ? "benchmark-canvas" : ""}`} role="application" tabIndex={0} aria-label="Audio module routing canvas" onPointerMove={canvasPointerMove} onPointerDown={canvasPointerDown} onPointerUp={() => { panDrag.current = null; }} onKeyDown={(event) => { if (event.key === "Escape") dispatch({ type: "cancel-connection" }); }}>
              <div className="canvas-stage" style={{ ...stageStyle, width: `${state.workspaceWidth}%` }}>
                <ThreadChannelBands channels={state.threadChannels} />
                {state.workspaceWidth > 100 && <div className="workspace-extension-marker extension-50" style={{ left: `${100 / state.workspaceWidth * 100}%` }}><span>Extension +50%</span></div>}
                {state.workspaceWidth > 150 && <div className="workspace-extension-marker extension-100" style={{ left: `${150 / state.workspaceWidth * 100}%` }}><span>Extension +100%</span></div>}
                <ThreadLayer connections={state.connections} terminalConnections={state.channelTerminalConnections} channels={state.threadChannels} modules={state.modules} selectedId={selectedConnection?.id ?? null} canvasSize={extendedCanvasSize} nodeWidth={nodeWidth * nodeScale} nodeHeight={nodeHeight * nodeScale} pendingFrom={state.pendingConnectionFrom} draftPoint={draftPoint} onSelect={(id) => dispatch({ type: "select-connection", id })} />
                <ChannelOutputTerminals state={state} dispatch={dispatch} />
                {state.modules.map((module) => <ModuleCard key={module.id} module={module} active={selectedModuleIds.includes(module.id)} pendingFrom={state.pendingConnectionFrom} state={state} onSelect={(additive) => dispatch({ type: "select-module", id: module.id, additive })} onMove={(position) => dispatch({ type: "move-module", id: module.id, position })} onBeginConnection={() => dispatch({ type: "begin-connection", fromModuleId: module.id })} onCommitConnection={() => dispatch({ type: "commit-connection", toModuleId: module.id })} />)}
              </div>
              {!state.modules.length && <div className="empty-workspace"><strong>Workspace cleared</strong><span>Choose a module type above and add it to begin a new patch.</span></div>}
              <div className="canvas-key"><span><i className="key-active" /> Committed</span><span><i className="key-future" /> Unavailable</span><span>Shift-click&nbsp; Multi-select</span></div>
            </div>
          </div></div>
      </WindowFrame>
      <WindowFrame title="Thread Inspector" className="inspector-window"><Inspector state={state} selectedModule={selectedModule} selectedModules={selectedModules} selectedConnection={selectedConnection} uiConfig={uiConfig} updateParameter={updateParameter} setAccent={(accentId) => selectedModule && dispatch({ type: "set-accent", id: selectedModule.id, accentId })} setHighlightStyle={setHighlightStyle} setHighlightWeight={setHighlightWeight} dispatch={dispatch} /></WindowFrame>
      <WindowFrame title="Monitor" className="diagnostics-window monitor-window" compactControls><Monitor state={state} selectedModule={selectedModule} selectedModules={selectedModules} selectedConnection={selectedConnection} audio={audio} /></WindowFrame>
    </div> : activeWorkspace === "sound-desk" ? <SoundDeskWorkspace threadsState={state} state={spatialRouting} dispatch={dispatchSpatialRouting} /> : <VisualiserWorkspace state={spatialRouting} />}
    </div>
    <WorkspaceNavigation workspace={activeWorkspace} navigate={navigateWorkspace} />
    {isDevelopment && activeWorkspace === "threads" && <UIWorkshop config={uiConfig} onChange={setUIConfig} onReset={() => setThemeConfigs((current) => ({ ...current, [theme]: theme === "light" ? BASELINE_UI_CONFIG : DARK_UI_CONFIG }))} />}
  </main>;
}
