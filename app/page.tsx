"use client";

import {
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  AUDIO_FREQUENCY_MAX,
  AUDIO_FREQUENCY_MIN,
  LIVE_TRIM_MAX,
  LIVE_TRIM_MIN,
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
  isPitchedGeneratorModule,
  MODULE_LIBRARY,
  sanitizeRestoredState,
  type AppState,
  type ModuleInstance,
  type ModuleParameters,
  type ModuleTemplateType,
  type ThreadConnection,
} from "./interaction-state";
import { PITCHED_GENERATOR_TYPES, generatorLabel, type PitchedGeneratorType } from "./musical-source";
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
  getCoordinateByKey,
  spatialRoutingReducer,
  type SpatialChannel,
  type SpatialPosition,
  type SpatialRoutingState,
} from "./spatial-routing";
import {
  diagnosticMeterEnabled,
  diagnosticScopeEnabled,
  getAudioDiagnosticMode,
  type AudioDiagnosticMode,
} from "./audio-diagnostics.ts";

const APP_SNAPSHOT_KEY = "rfe-interaction-harness-snapshot-v1";
const rootNotes = ["C2", "C3", "C4", "D3", "E3", "G3", "A3"];
const scales = ["Minor Pentatonic", "Major Pentatonic", "Chromatic", "Dorian"];
const durations = ["1/16", "1/8", "1/4", "1/2", "1 bar", "10 ms", "250 ms"];

function useAudioRuntimeRevision() {
  const [, setRevision] = useState(0);
  useEffect(() => applicationAudioRuntime.subscribe(() => setRevision((value) => value + 1)), []);
}

function useMasterSafetyRevision(enabled = true) {
  const [, setRevision] = useState(0);
  useEffect(() => enabled ? applicationAudioRuntime.subscribeMasterSafety(() => setRevision((value) => value + 1)) : undefined, [enabled]);
}

function useAudioDiagnosticMode() {
  return useSyncExternalStore<AudioDiagnosticMode>(() => () => {}, getAudioDiagnosticMode, () => "full");
}

function useAudioChannel(channelId: ChannelId | null) {
  useAudioRuntimeRevision();
  return channelId ? applicationAudioRuntime.getChannelSnapshot(channelId) : null;
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
        disabled={!module.enabled || !module.ports.input || !pendingFrom}
        onClick={(event) => { event.stopPropagation(); onCommitConnection(); }}
      />
      <button
        className={`port port-out ${pendingFrom === module.id ? "connecting" : ""}`}
        aria-label={`Output port for ${module.title}${module.enabled ? "" : " unavailable"}`}
        disabled={!module.enabled || !module.ports.output}
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

function plotLabel(plot: SpatialChannel) {
  const suffix = plot.plotNumber <= 26 ? String.fromCharCode(64 + plot.plotNumber) : String(plot.plotNumber);
  return `${plot.label} · PLOT ${suffix}`;
}

function SpatialGrid({ state, variant, selectedCoordinateKey, selectedPlotId, quickDetachedPlotId, onSelectCoordinate, onSelectPlot, onOpenStack, onQuickDetachPlot, onPreviewPlotMove, onCommitPlotMove, onPreviewPlotStackMove, onCommitPlotStackMove }: {
  state: SpatialRoutingState;
  variant: "sound-desk" | "inspection";
  selectedCoordinateKey?: string | null;
  selectedPlotId?: ChannelId | null;
  quickDetachedPlotId?: ChannelId | null;
  onSelectCoordinate?: (coordinateKey: string) => void;
  onSelectPlot?: (plot: SpatialChannel) => void;
  onOpenStack?: (position: SpatialPosition) => void;
  onQuickDetachPlot?: (plot: SpatialChannel) => void;
  onPreviewPlotMove?: (plotId: ChannelId, position: SpatialPosition) => void;
  onCommitPlotMove?: (plotId: ChannelId, position: SpatialPosition) => void;
  onPreviewPlotStackMove?: (plotIds: readonly ChannelId[], position: SpatialPosition) => void;
  onCommitPlotStackMove?: (plotIds: readonly ChannelId[], position: SpatialPosition) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; plotIds: readonly ChannelId[]; origin: SpatialPosition; lastPosition: SpatialPosition; moved: boolean } | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const suppressFolderClickRef = useRef(false);
  const [dragPreview, setDragPreview] = useState<{ plotIds: readonly ChannelId[]; position: SpatialPosition } | null>(null);
  const pointerPosition = (event: PointerEvent<HTMLElement>): SpatialPosition | null => {
    const points = gridRef.current?.querySelectorAll<HTMLElement>(".spatial-point[data-coordinate]");
    if (!points?.length) return null;
    let nearest: { key: string; distance: number } | null = null;
    for (const point of points) {
      const bounds = point.getBoundingClientRect();
      const distance = Math.hypot(event.clientX - (bounds.left + bounds.width / 2), event.clientY - (bounds.top + bounds.height / 2));
      const key = point.dataset.coordinate;
      if (key && (!nearest || distance < nearest.distance)) nearest = { key, distance };
    }
    return nearest ? getCoordinateByKey(nearest.key) : null;
  };
  const presentDrag = () => {
    dragFrameRef.current = null;
    const drag = dragRef.current;
    if (!drag) return;
    setDragPreview({ plotIds: drag.plotIds, position: drag.lastPosition });
    if (drag.plotIds.length > 1) onPreviewPlotStackMove?.(drag.plotIds, drag.lastPosition);
    else onPreviewPlotMove?.(drag.plotIds[0], drag.lastPosition);
  };
  const updateDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const position = pointerPosition(event);
    if (!position) return;
    drag.lastPosition = position;
    drag.moved = coordinateKey(position) !== coordinateKey(drag.origin);
    if (dragFrameRef.current === null) dragFrameRef.current = window.requestAnimationFrame(presentDrag);
  };
  const finishDrag = (event?: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || (event && drag.pointerId !== event.pointerId)) return;
    if (event) {
      const position = pointerPosition(event);
      if (position) drag.lastPosition = position;
    }
    if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
    dragFrameRef.current = null;
    dragRef.current = null;
    setDragPreview(null);
    if (drag.plotIds.length > 1) {
      suppressFolderClickRef.current = drag.moved;
      onPreviewPlotStackMove?.(drag.plotIds, drag.lastPosition);
      onCommitPlotStackMove?.(drag.plotIds, drag.lastPosition);
    } else {
      onPreviewPlotMove?.(drag.plotIds[0], drag.lastPosition);
      onCommitPlotMove?.(drag.plotIds[0], drag.lastPosition);
    }
  };
  useEffect(() => () => {
    if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
  }, []);
  const assignedPlots = state.channels.filter((plot) => plot.assignment);
  const plotStacks = new Map<string, SpatialChannel[]>();
  assignedPlots.forEach((plot) => {
    const key = `${plot.assignment!.x.toFixed(4)},${plot.assignment!.y.toFixed(4)}`;
    plotStacks.set(key, [...(plotStacks.get(key) ?? []), plot]);
  });
  plotStacks.forEach((stack) => stack.sort((a, b) => a.layerOrder - b.layerOrder));
  return <div ref={gridRef} className={`spatial-grid spatial-grid-${variant}`} role="grid" aria-label={variant === "sound-desk" ? "Sound Desk shared 5 by 5 spatial grid" : "Visualiser routing inspection 5 by 5 spatial grid"}>
    {SPATIAL_COORDINATES.map((coordinate) => {
      const key = coordinateKey(coordinate);
      const dragTarget = dragPreview && coordinateKey(dragPreview.position) === key;
      const className = `spatial-point ${coordinate.x === 0 && coordinate.y === 0 ? "spatial-origin" : ""} ${selectedCoordinateKey === key ? "spatial-point-selected" : ""} ${dragTarget ? "spatial-point-drag-target" : ""}`;
      const content = <span className="spatial-coordinate-label">{key}</span>;
      const ariaLabel = `Coordinate ${coordinateLabel(coordinate)}`;
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
    <div className="spatial-plot-layer" role="presentation">
      {assignedPlots.map((plot) => {
        const position = dragPreview?.plotIds.includes(plot.id) ? dragPreview.position : plot.assignment!;
        const stackKey = `${plot.assignment!.x.toFixed(4)},${plot.assignment!.y.toFixed(4)}`;
        const fullStack = plotStacks.get(stackKey) ?? [plot];
        const quickDetachedInStack = fullStack.some((item) => item.id === quickDetachedPlotId);
        const stack = plot.id === quickDetachedPlotId ? [plot] : quickDetachedInStack ? fullStack.filter((item) => item.id !== quickDetachedPlotId) : fullStack;
        const stackIndex = stack.findIndex((item) => item.id === plot.id);
        const stackColumns = Math.ceil(Math.sqrt(stack.length));
        const stackRows = Math.ceil(stack.length / stackColumns);
        const stackColumn = stackIndex % stackColumns;
        const stackRow = Math.floor(stackIndex / stackColumns);
        const stackOffsetX = stack.length > 1 ? (stackColumn - (stackColumns - 1) / 2) * 8 : 0;
        const stackOffsetY = stack.length > 1 ? (stackRow - (stackRows - 1) / 2) * 8 : 0;
        const accent = MUTED_ACCENTS.find((item) => item.id === plot.accentId);
        const channelInk = plot.accentId === "utility-blue" ? "#ffffff" : "#111827";
        const style = {
          "--channel-color": accent?.value,
          "--channel-ink": channelInk,
          "--plot-stack-x": `${stackOffsetX}px`,
          "--plot-stack-y": `${stackOffsetY}px`,
          left: `${10 + (position.x + 2) / 4 * 80}%`,
          top: `${10 + (2 - position.y) / 4 * 80}%`,
          zIndex: quickDetachedPlotId === plot.id ? 110 : selectedPlotId === plot.id ? 100 : 10 + stackIndex,
        } as CSSProperties;
        const stackLabel = stack.length > 1 ? ` · stack ${stackIndex + 1} of ${stack.length}` : "";
        const label = `${plotLabel(plot)} · ${coordinateLabel(position)}${stackLabel}${plot.liveTrim === LIVE_TRIM_MIN ? " · muted" : ""}`;
        const stackClass = stack.length > 1 ? `stacked ${stackIndex === stack.length - 1 ? "stack-top" : ""}` : "";
        if (variant === "inspection") return <span key={plot.id} className={`spatial-plot-node ${plot.isMultiPlot ? "multi-plot" : ""} ${stackClass}`} data-plot-id={plot.id} data-stack-index={stackIndex + 1} data-stack-size={stack.length} style={style} title={label}>{plot.shortLabel.padStart(2, "0")}<small>{plot.plotNumber}</small></span>;
        if (stack.length >= 3) return stackIndex === stack.length - 1 ? <button
          key={plot.id}
          className={`spatial-plot-node plot-folder-trigger ${plot.isMultiPlot ? "multi-plot" : ""} stacked stack-top`}
          data-plot-id={plot.id}
          data-stack-index={stackIndex + 1}
          data-stack-size={stack.length}
          style={style}
          aria-label={`Open plot point folder for ${coordinateLabel(plot.assignment!)} with ${stack.length} endpoints. Drag to move cluster. Double-click to pull the selected or front endpoint free.`}
          onClick={(event) => {
            event.stopPropagation();
            if (suppressFolderClickRef.current) { suppressFolderClickRef.current = false; return; }
            onOpenStack?.(plot.assignment!);
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const detached = fullStack.find((item) => item.id === selectedPlotId) ?? fullStack.at(-1);
            if (!detached) return;
            onSelectPlot?.(detached);
            onQuickDetachPlot?.(detached);
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { pointerId: event.pointerId, plotIds: stack.map((item) => item.id), origin: plot.assignment!, lastPosition: plot.assignment!, moved: false };
          }}
          onPointerMove={updateDrag}
          onPointerLeave={updateDrag}
          onPointerUp={(event) => { finishDrag(event); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={finishDrag}
          onLostPointerCapture={() => finishDrag()}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 1 : 0.25;
            const delta = event.key === "ArrowLeft" ? { x: -step, y: 0 } : event.key === "ArrowRight" ? { x: step, y: 0 } : event.key === "ArrowUp" ? { x: 0, y: step } : event.key === "ArrowDown" ? { x: 0, y: -step } : null;
            if (!delta) return;
            event.preventDefault();
            const next = { x: Math.max(-2, Math.min(2, plot.assignment!.x + delta.x)), y: Math.max(-2, Math.min(2, plot.assignment!.y + delta.y)) };
            onPreviewPlotStackMove?.(stack.map((item) => item.id), next);
            onCommitPlotStackMove?.(stack.map((item) => item.id), next);
          }}
        >{plot.shortLabel.padStart(2, "0")}<small>{plot.plotNumber}</small></button> : <span
          key={plot.id}
          className={`spatial-plot-node plot-folder-member ${plot.isMultiPlot ? "multi-plot" : ""} stacked`}
          data-plot-id={plot.id}
          data-stack-index={stackIndex + 1}
          data-stack-size={stack.length}
          style={style}
          aria-hidden="true"
        >{plot.shortLabel.padStart(2, "0")}<small>{plot.plotNumber}</small></span>;
        return <button
          key={plot.id}
          className={`spatial-plot-node ${plot.isMultiPlot ? "multi-plot" : ""} ${selectedPlotId === plot.id ? "selected" : ""} ${plot.liveTrim === LIVE_TRIM_MIN ? "muted" : ""} ${quickDetachedPlotId === plot.id ? "quick-detached" : ""} ${stackClass}`}
          data-plot-id={plot.id}
          data-stack-index={stackIndex + 1}
          data-stack-size={stack.length}
          style={style}
          aria-label={`${label}${quickDetachedPlotId === plot.id ? " · pulled free from folder" : ""}. Drag to move live.`}
          aria-pressed={selectedPlotId === plot.id}
          onClick={(event) => { event.stopPropagation(); onSelectPlot?.(plot); }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            onSelectPlot?.(plot);
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { pointerId: event.pointerId, plotIds: [plot.id], origin: plot.assignment!, lastPosition: plot.assignment!, moved: false };
          }}
          onPointerMove={updateDrag}
          onPointerLeave={updateDrag}
          onPointerUp={(event) => { finishDrag(event); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={finishDrag}
          onLostPointerCapture={() => finishDrag()}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 1 : 0.25;
            const delta = event.key === "ArrowLeft" ? { x: -step, y: 0 } : event.key === "ArrowRight" ? { x: step, y: 0 } : event.key === "ArrowUp" ? { x: 0, y: step } : event.key === "ArrowDown" ? { x: 0, y: -step } : null;
            if (!delta) return;
            event.preventDefault();
            const next = { x: Math.max(-2, Math.min(2, plot.assignment!.x + delta.x)), y: Math.max(-2, Math.min(2, plot.assignment!.y + delta.y)) };
            onPreviewPlotMove?.(plot.id, next);
            onCommitPlotMove?.(plot.id, next);
          }}
        >{plot.shortLabel.padStart(2, "0")}<small>{plot.plotNumber}</small></button>;
      })}
    </div>
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

function ChannelPlotter({ incoming, state, selectedChannelId, selectedPlotId, selectedCoordinateKey, openStackKey, onCloseStack, onSelectPlot, onQuickDetachPlot, onRemoveMultiPlot, dispatch }: {
  incoming: IncomingChannel[];
  state: SpatialRoutingState;
  selectedChannelId: ChannelId | null;
  selectedPlotId: ChannelId | null;
  selectedCoordinateKey: string | null;
  openStackKey: string | null;
  onCloseStack: () => void;
  onSelectPlot: (plot: SpatialChannel) => void;
  onQuickDetachPlot: (plot: SpatialChannel) => void;
  onRemoveMultiPlot: (plotId: ChannelId) => void;
  dispatch: React.Dispatch<Parameters<typeof spatialRoutingReducer>[1]>;
}) {
  const [modeDrawerOpen, setModeDrawerOpen] = useState(false);
  const incomingChannel = incoming.find((channel) => channel.id === selectedChannelId && channel.status === "complete") ?? null;
  const spatialChannel = state.channels.find((channel) => channel.id === selectedPlotId) ?? state.channels.find((channel) => !channel.isMultiPlot && channel.channelId === selectedChannelId) ?? null;
  const selectedCoordinate = selectedCoordinateKey ? getCoordinateByKey(selectedCoordinateKey) : null;
  const canPlot = Boolean(incomingChannel && spatialChannel && selectedCoordinate);
  const folderPlots = openStackKey ? state.channels
    .filter((plot) => plot.assignment && coordinateKey(plot.assignment) === openStackKey)
    .sort((a, b) => b.layerOrder - a.layerOrder) : [];
  return <aside className="channel-plotter" aria-labelledby="channel-plotter-title">
    <div className="channel-plotter-heading"><div><span className="fixture-kicker">MANUAL ROUTING INSTRUMENT</span><h2 id="channel-plotter-title">Channel Plotter</h2><p>Select channel → select grid point → plot. Drag plotted endpoints live.</p></div><button className="plotter-mode-toggle" aria-expanded={modeDrawerOpen} aria-controls="plotter-mode-drawer" onClick={() => setModeDrawerOpen((open) => !open)}>{modeDrawerOpen ? "CLOSE MODES" : "PLOT MODES"}</button></div>
    <div className="plotter-proposal" aria-live="polite">
      <span>PROPOSED ROUTE</span>
      <strong>{incomingChannel?.label ?? "NO CHANNEL"}<i>→</i>{selectedCoordinate ? coordinateLabel(selectedCoordinate) : "NO POINT"}</strong>
      <small>Current&nbsp; {spatialChannel ? `${plotLabel(spatialChannel)} · ${spatialChannel.assignment ? coordinateLabel(spatialChannel.assignment) : "UNPLOTTED"}` : "UNPLOTTED"}</small>
    </div>
    <div className="plotter-actions">
      <button className="plot-action" disabled={!canPlot} onClick={() => { if (spatialChannel && selectedCoordinate) dispatch({ type: "assign-channel", channelId: spatialChannel.id, coordinate: selectedCoordinate }); }}>Plot route</button>
      <button className="multi-plot-action" disabled={!incomingChannel || !state.channels.some((plot) => !plot.isMultiPlot && plot.channelId === incomingChannel.id && plot.assignment)} onClick={() => { if (incomingChannel) dispatch({ type: "add-multi-plot", channelId: incomingChannel.id }); }}>＋ MULTI-PLOT</button>
      <button disabled={!spatialChannel?.assignment} onClick={() => { if (spatialChannel) dispatch({ type: "unassign-channel", channelId: spatialChannel.id }); }}>Unplot</button>
    </div>
    <div className="plot-point-folder-slot">{folderPlots.length >= 3 && <section className="plot-point-folder" aria-label={`Plot point folder ${openStackKey}`}>
      <header><div><span>PLOT POINT FOLDER</span><strong>{coordinateLabel(folderPlots[0].assignment!)} · {folderPlots.length} ENDPOINTS</strong></div><button aria-label="Close plot point folder" onClick={onCloseStack}>×</button></header>
      <p>Double-click any member to pull it free for immediate dragging. You can also select a member and double-click the grid folder marker; without a selection, the marker pulls the front endpoint. REMOVE deletes only that endpoint.</p>
      <div className="plot-folder-list">
        {folderPlots.map((plot, index) => <div className={selectedPlotId === plot.id ? "selected" : ""} key={plot.id} data-folder-plot-id={plot.id}>
          <button className="plot-folder-select" aria-pressed={selectedPlotId === plot.id} onClick={() => onSelectPlot(plot)} onDoubleClick={() => onQuickDetachPlot(plot)}><span>{plotLabel(plot)}</span><small>{index === 0 ? "FRONT" : index === folderPlots.length - 1 ? "BACK" : `LAYER ${index + 1}`}</small></button>
          <button aria-label={`Bring ${plotLabel(plot)} forward`} disabled={index === 0} onClick={() => dispatch({ type: "move-plot-layer", plotId: plot.id, direction: "forward" })}>↑</button>
          <button aria-label={`Send ${plotLabel(plot)} backward`} disabled={index === folderPlots.length - 1} onClick={() => dispatch({ type: "move-plot-layer", plotId: plot.id, direction: "back" })}>↓</button>
        </div>)}
      </div>
    </section>}</div>
    <div className="plotted-channel-overview" aria-label="Plotted channel overview">
      <div className="plotter-overview-heading"><span>SPATIAL PLOTS</span><small>{state.channels.filter((channel) => channel.assignment).length} active</small></div>
      {state.channels.map((route) => {
        const channel = incoming.find((item) => item.id === route.channelId);
        if (!channel) return null;
        const accent = MUTED_ACCENTS.find((item) => item.id === route.accentId);
        const trimLabel = route.liveTrim === -100 ? "MUTE" : route.liveTrim === 0 ? "0" : `${route.liveTrim > 0 ? "+" : ""}${route.liveTrim}%`;
        return <div className={`plotter-channel-row ${channel.status} ${selectedPlotId === route.id ? "selected" : ""}`} data-channel-id={route.channelId} data-plot-id={route.id} key={route.id} style={{ "--channel-color": accent?.value } as CSSProperties}>
          <i aria-hidden="true" /><button className="plot-row-select" aria-pressed={selectedPlotId === route.id} onClick={() => onSelectPlot(route)}>{plotLabel(route)}</button><span>{channel.status === "complete" ? route.assignment ? coordinateLabel(route.assignment) : "UNPLOTTED" : "INCOMPLETE"}</span><small>{route.isMultiPlot ? "SHARED SOURCE" : channel.status === "complete" ? "CHANNEL OUT" : "AWAITING OUTPUT"}</small>
          {channel.status === "complete" && route.assignment && <div className="plot-endpoint-controls"><label className={`live-trim-control ${route.liveTrim === 0 ? "at-zero" : ""}`}><span>LIVE TRIM</span><input aria-label={`${plotLabel(route)} Live Trim`} type="range" min={LIVE_TRIM_MIN} max={LIVE_TRIM_MAX} step="1" value={route.liveTrim} onChange={(event) => dispatch({ type: "set-live-trim", channelId: route.id, value: Number(event.target.value) })} /><output>{trimLabel}</output><button type="button" aria-label={`Reset ${plotLabel(route)} Live Trim to 0`} disabled={route.liveTrim === 0} onClick={() => dispatch({ type: "set-live-trim", channelId: route.id, value: 0 })}>0</button></label><button className="plot-mute-action" aria-pressed={route.liveTrim === LIVE_TRIM_MIN} onClick={() => dispatch({ type: "set-live-trim", channelId: route.id, value: route.liveTrim === LIVE_TRIM_MIN ? 0 : LIVE_TRIM_MIN })}>{route.liveTrim === LIVE_TRIM_MIN ? "UNMUTE" : "MUTE"}</button>{route.isMultiPlot && <button className="plot-remove-action" aria-label={`Remove ${plotLabel(route)}`} onClick={() => onRemoveMultiPlot(route.id)}>REMOVE</button>}</div>}
        </div>;
      })}
    </div>
    {modeDrawerOpen && <div className="plotter-mode-drawer" id="plotter-mode-drawer" role="region" aria-label="Plotter modes"><div className="plotter-mode-drawer-heading"><span>PLOTTER MODES</span><button aria-label="Close Plotter modes" onClick={() => setModeDrawerOpen(false)}>×</button></div><button className="current" aria-current="page" onClick={() => setModeDrawerOpen(false)}><strong>MANUAL PLOTTER</strong><small>ACTIVE WORKSPACE</small></button><button disabled><strong>AUTO PLOT</strong><small>FUTURE · UNAVAILABLE</small></button><button disabled><strong>ORCHESTRA</strong><small>FUTURE · UNAVAILABLE</small></button></div>}
  </aside>;
}

function SoundDeskWorkspace({ threadsState, state, dispatch, sessionDispatch }: {
  threadsState: AppState;
  state: SpatialRoutingState;
  dispatch: React.Dispatch<Parameters<typeof spatialRoutingReducer>[1]>;
  sessionDispatch: React.Dispatch<Parameters<typeof appReducer>[1]>;
}) {
  useAudioRuntimeRevision();
  const incoming = getIncomingChannels(threadsState);
  const soundingEndpointIds = new Set(applicationAudioRuntime.getSoundingChannelIds());
  const activeEndpointCount = state.channels.filter((channel) => soundingEndpointIds.has(channel.id)).length;
  const sourceCount = new Set(state.channels.map((channel) => channel.sourceId)).size;
  const [selectedChannelId, setSelectedChannelId] = useState<ChannelId | null>("channel-01");
  const [selectedPlotId, setSelectedPlotId] = useState<ChannelId | null>("channel-01");
  const [selectedCoordinateKey, setSelectedCoordinateKey] = useState<string | null>("0,0");
  const [openStackKey, setOpenStackKey] = useState<string | null>(null);
  const [quickDetachedPlotId, setQuickDetachedPlotId] = useState<ChannelId | null>(null);
  const effectiveSelectedChannelId = incoming.some((channel) => channel.id === selectedChannelId) ? selectedChannelId : incoming.find((channel) => channel.status === "complete")?.id ?? null;
  const effectiveSelectedPlotId = state.channels.some((plot) => plot.id === selectedPlotId && plot.channelId === effectiveSelectedChannelId) ? selectedPlotId : state.channels.find((plot) => !plot.isMultiPlot && plot.channelId === effectiveSelectedChannelId)?.id ?? null;
  const selectChannel = (channel: IncomingChannel) => {
    if (channel.status !== "complete") return;
    setSelectedChannelId(channel.id);
    setSelectedPlotId(channel.id);
    setOpenStackKey(null);
    const current = state.channels.find((item) => !item.isMultiPlot && item.channelId === channel.id)?.assignment;
    if (current) setSelectedCoordinateKey(coordinateKey(current));
  };
  const selectPlot = (plot: SpatialChannel) => {
    setSelectedChannelId(plot.channelId);
    setSelectedPlotId(plot.id);
  };
  const openStack = (position: SpatialPosition) => {
    const key = coordinateKey(position);
    const stack = state.channels.filter((plot) => plot.assignment && coordinateKey(plot.assignment) === key).sort((a, b) => b.layerOrder - a.layerOrder);
    const topPlot = stack[0];
    setSelectedCoordinateKey(key);
    setOpenStackKey(key);
    if (topPlot && !stack.some((plot) => plot.id === selectedPlotId)) selectPlot(topPlot);
  };
  const quickDetachPlot = (plot: SpatialChannel) => {
    selectPlot(plot);
    setQuickDetachedPlotId(plot.id);
    setOpenStackKey(null);
  };
  return <section className="future-workspace spatial-workspace sound-desk-workspace" aria-labelledby="sound-desk-title" data-workspace-surface="sound-desk">
    <WorkspaceTitlebar id="sound-desk-title" title="Sound Desk / Channel Routing" trailing={<div className="sound-desk-title-actions"><SessionTransport dispatch={sessionDispatch} /><span className="spatial-model-status" aria-label="Sound Desk endpoint load tally">SOUNDING {activeEndpointCount} / {state.channels.length} ENDPOINTS · {sourceCount} SOURCES</span></div>} />
    <ChannelRail channels={incoming} selectedChannelId={effectiveSelectedChannelId} onSelect={selectChannel} />
    <div className="sound-desk-routing-instrument">
      <div className="spatial-grid-panel"><SpatialGrid state={state} variant="sound-desk" selectedCoordinateKey={selectedCoordinateKey} selectedPlotId={effectiveSelectedPlotId} quickDetachedPlotId={quickDetachedPlotId} onSelectCoordinate={setSelectedCoordinateKey} onSelectPlot={selectPlot} onOpenStack={openStack} onQuickDetachPlot={quickDetachPlot} onPreviewPlotMove={(plotId, position) => applicationAudioRuntime.setSpatialX(plotId, position.x, false)} onCommitPlotMove={(plotId, position) => { dispatch({ type: "move-plot", plotId, position }); if (plotId === quickDetachedPlotId) setQuickDetachedPlotId(null); }} onPreviewPlotStackMove={(plotIds, position) => plotIds.forEach((plotId) => applicationAudioRuntime.setSpatialX(plotId, position.x, false))} onCommitPlotStackMove={(plotIds, position) => { dispatch({ type: "move-plot-stack", plotIds, position }); setSelectedCoordinateKey(coordinateKey(position)); setOpenStackKey(null); }} /><SpatialOrientation /></div>
      <ChannelPlotter incoming={incoming} state={state} selectedChannelId={effectiveSelectedChannelId} selectedPlotId={effectiveSelectedPlotId} selectedCoordinateKey={selectedCoordinateKey} openStackKey={openStackKey} onCloseStack={() => setOpenStackKey(null)} onSelectPlot={selectPlot} onQuickDetachPlot={quickDetachPlot} onRemoveMultiPlot={(plotId) => { applicationAudioRuntime.disposeChannel(plotId); dispatch({ type: "remove-multi-plot", plotId }); if (plotId === quickDetachedPlotId) setQuickDetachedPlotId(null); }} dispatch={dispatch} />
    </div>
  </section>;
}

function VisualiserWorkspace({ state, sessionDispatch }: { state: SpatialRoutingState; sessionDispatch: React.Dispatch<Parameters<typeof appReducer>[1]> }) {
  const [inspectionVisible, setInspectionVisible] = useState(false);
  useAudioRuntimeRevision();
  return <section className="future-workspace spatial-workspace visualiser-workspace" aria-labelledby="visualiser-title" data-workspace-surface="visualiser">
    <WorkspaceTitlebar id="visualiser-title" title="Visualiser" trailing={<div className="visualiser-title-actions"><SessionTransport dispatch={sessionDispatch} /><button className="inspection-toggle" aria-pressed={inspectionVisible} onClick={() => setInspectionVisible((value) => !value)}>{inspectionVisible ? "Hide routing inspection" : "Reveal routing inspection"}</button></div>} />
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

function SessionTransport({ dispatch }: { dispatch: React.Dispatch<Parameters<typeof appReducer>[1]> }) {
  const playbackState = applicationAudioRuntime.getSessionPlaybackState();
  const now = () => performance.now();
  return <div className="session-transport" aria-label="Session transport"><button aria-label={playbackState === "paused" ? "Resume session" : "Play session"} aria-pressed={playbackState === "playing"} onClick={() => { applicationAudioRuntime.playSession(); dispatch({ type: "play-session", now: now() }); }}>PLAY</button><button aria-label="Pause session" aria-pressed={playbackState === "paused"} onClick={() => { applicationAudioRuntime.pauseSession(); dispatch({ type: "pause-session", now: now() }); }}>PAUSE</button><button aria-label="Stop session" aria-pressed={playbackState === "stopped"} onClick={() => { applicationAudioRuntime.stopSession(); dispatch({ type: "stop-session", now: now() }); }}>STOP</button><output aria-live="polite">{playbackState.toUpperCase()}</output></div>;
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
      const connection = state.channelTerminalConnections.find((item) => item.channelId === channel.id);
      const sourceModule = connection ? state.modules.find((module) => module.id === connection.fromModuleId) : null;
      const complete = Boolean(connection);
      return <div className={`channel-output-terminal ${complete ? "complete" : "incomplete"}`} data-channel-id={channel.id} key={channel.id} style={{ top: `${(index + .5) / Math.max(1, incoming.length) * 100}%`, "--channel-color": accent?.value } as CSSProperties} aria-label={`${channel.label} output ${complete ? `complete · ${sourceModule?.title ?? "source connected"}` : "incomplete"}`}>
        {sourceModule && <span className="channel-terminal-source-tag" title={`${channel.label} receives ${sourceModule.title}`}>{sourceModule.title}</span>}
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

function Inspector({ state, spatialRouting, selectedModule, selectedModules, selectedConnection, uiConfig, updateParameter, setAccent, setHighlightStyle, setHighlightWeight, onDeleteSelection, dispatch }: {
  state: AppState;
  spatialRouting: SpatialRoutingState;
  selectedModule: ModuleInstance | null;
  selectedModules: ModuleInstance[];
  selectedConnection: ThreadConnection | null;
  uiConfig: UIConfig;
  updateParameter: <K extends keyof ModuleParameters>(key: K, value: ModuleParameters[K]) => void;
  setAccent: (value: AccentId | null) => void;
  setHighlightStyle: (value: UIConfig["nodes"]["groupingAccentStyle"]) => void;
  setHighlightWeight: (value: 1 | 1.5) => void;
  onDeleteSelection: () => void;
  dispatch: React.Dispatch<Parameters<typeof appReducer>[1]>;
}) {
  if (selectedConnection) {
    const source = state.modules.find((module) => module.id === selectedConnection.fromModuleId);
    const target = state.modules.find((module) => module.id === selectedConnection.toModuleId);
    return <div className="inspector-content"><div className="selection-summary"><span>Selected Thread</span><strong>{selectedConnection.id}</strong><small>{source?.title} → {target?.title}</small></div><details className="inspector-section"><summary>Connection</summary><div className="connection-summary"><span>Output</span><b>{source?.title}</b><span>Input</span><b>{target?.title}</b><span>State</span><b>Committed</b></div></details><button className="reset-button danger" onClick={() => dispatch({ type: "remove-connection", id: selectedConnection.id })}>Disconnect Thread</button><p className="inspector-note">Delete or Backspace also disconnects the selected Thread.</p></div>;
  }
  if (selectedModules.length > 1) return <div className="inspector-content batch-inspector">
    <div className="selection-summary"><span>Batch selected</span><strong>{selectedModules.length} modules</strong><small>{selectedModules.map((module) => module.title).join(" · ")}</small></div>
    <details className="inspector-section"><summary>Batch actions</summary><p className="inspector-note">Drag any selected module to move the whole group. Shift-click toggles membership.</p><div className="lifecycle-actions"><button onClick={() => dispatch({ type: "duplicate-selection" })}>Duplicate batch</button><button className="danger" onClick={onDeleteSelection}>Delete batch</button></div></details>
  </div>;
  if (!selectedModule) return <div className="inspector-content empty-inspector">Select a module or Thread.</div>;
  if (isPitchedGeneratorModule(selectedModule) && selectedModule.audioChannelId) return <PitchedGeneratorInspector state={state} spatialRouting={spatialRouting} module={selectedModule} dispatch={dispatch} />;
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
    <div className="lifecycle-actions"><button disabled={disabled} onClick={() => dispatch({ type: "reset-module", id: selectedModule.id })}>Reset defaults</button><button onClick={() => dispatch({ type: "duplicate-selection" })}>Duplicate</button><button className="danger" onClick={onDeleteSelection}>Delete</button></div>
  </div>;
}

function InputsAndChannels({ state, spatialRouting, collapsed, onToggle, dispatch }: {
  state: AppState;
  spatialRouting: SpatialRoutingState;
  collapsed: boolean;
  onToggle: () => void;
  dispatch: React.Dispatch<Parameters<typeof appReducer>[1]>;
}) {
  const incoming = getIncomingChannels(state);
  return <aside className={`inputs-sidebar ${collapsed ? "collapsed" : ""}`} aria-label="Inputs and Channels">
    <header><button className="sidebar-collapse" aria-label={collapsed ? "Expand Inputs and Channels" : "Collapse Inputs and Channels"} aria-expanded={!collapsed} onClick={onToggle}>{collapsed ? "→" : "←"}</button>{!collapsed && <div><strong>INPUTS &amp; CHANNELS</strong><small>INTRODUCE</small></div>}</header>
    {!collapsed && <>
      <button className="add-channel-action" onClick={() => dispatch({ type: "add-channel" })}>＋ ADD CHANNEL</button>
      <div className="input-channel-list" aria-label={`${incoming.length} active channel${incoming.length === 1 ? "" : "s"}`}>
        {incoming.filter((channel) => channel.role !== "clone").map((channel) => <div className={`input-channel-fixture ${state.selection?.kind === "channel" && state.selection.id === channel.id ? "selected" : ""}`} key={channel.id} data-channel-id={channel.id}>
          <ChannelAudioControls channel={channel} selected={state.selection?.kind === "channel" && state.selection.id === channel.id} sourceModuleId={state.modules.find((module) => isPitchedGeneratorModule(module) && module.audioChannelId === channel.id)?.id ?? null} sourcePlaced={state.modules.some((module) => isPitchedGeneratorModule(module) && module.audioChannelId === channel.id)} dependentEndpointCount={state.threadChannels.filter((item) => item.role === "clone" && item.sourceId === channel.id).length + spatialRouting.channels.filter((plot) => plot.isMultiPlot && plot.sourceId === channel.id).length} dispatch={dispatch} />
        </div>)}
      </div>
      <div className="future-inputs" aria-label="Future source types reserved"><span>SOURCES</span><p>Import File · Mic / Live · Capture / Loop · Saved Sources</p><small>Reserved for a future milestone</small></div>
    </>}
  </aside>;
}

function ChannelAudioControls({ channel, selected, sourceModuleId, sourcePlaced, dependentEndpointCount, dispatch }: {
  channel: IncomingChannel;
  selected: boolean;
  sourceModuleId: string | null;
  sourcePlaced: boolean;
  dependentEndpointCount: number;
  dispatch: React.Dispatch<Parameters<typeof appReducer>[1]>;
}) {
  const audio = useAudioChannel(channel.id)!;
  const generatorName = generatorLabel(audio.generatorType);
  const [removeConfirmationOpen, setRemoveConfirmationOpen] = useState(false);
  const removeChannel = () => {
    if (dependentEndpointCount) {
      if (sourceModuleId) dispatch({ type: "select-module", id: sourceModuleId });
      dispatch({ type: "set-status", value: `${channel.label} has linked Multi-Plots — confirm source deletion in Inspector` });
      return;
    }
    setRemoveConfirmationOpen(true);
  };
  const confirmRemoveChannel = () => {
    applicationAudioRuntime.disposeSource(channel.id);
    dispatch({ type: "remove-channel", channelId: channel.id });
  };
  return <>
    <div className="input-channel-row">
      <button className="channel-select" onClick={() => dispatch({ type: "select-channel", channelId: channel.id })} aria-pressed={selected}><span>{channel.label}</span><small>{generatorName.toUpperCase()} · {audio.active ? "ACTIVE" : "SILENT"}</small></button>
      <button className="channel-remove" aria-label={`Remove ${channel.label}`} onClick={removeChannel}>×</button>
    </div>
    {removeConfirmationOpen && <div className="channel-remove-confirmation" role="alert" aria-live="assertive">
      <strong>REMOVE {channel.label}?</strong>
      <p>This removes the channel and its downstream route. Other sounding channels remain uninterrupted.</p>
      <div><button onClick={() => setRemoveConfirmationOpen(false)}>CANCEL</button><button className="danger" onClick={confirmRemoveChannel}>REMOVE {channel.label}</button></div>
    </div>}
    {!sourcePlaced && <PitchedGeneratorControls channelId={channel.id} label={channel.label} audio={audio} onPlace={(generatorType) => dispatch({ type: "place-channel-source", channelId: channel.id, generatorType })} onToggle={() => dispatch({ type: "select-channel", channelId: channel.id })} />}
  </>;
}

function PitchedGeneratorControls({ channelId, label, audio, onPlace, onToggle, onGeneratorChange }: {
  channelId: ChannelId;
  label: string;
  audio: AudioChannelSnapshot;
  onPlace?: (generatorType: PitchedGeneratorType) => void;
  onToggle?: () => void;
  onGeneratorChange?: (generatorType: PitchedGeneratorType) => void;
}) {
  const generatorName = generatorLabel(audio.generatorType);
  const generatorAria = generatorName.toLowerCase();
  const signalState = audio.active ? audio.routable ? "ACTIVE" : "ACTIVE · UNROUTED" : audio.availability === "error" ? "ERROR" : "SILENT";
  const selectGenerator = (generatorType: PitchedGeneratorType) => {
    applicationAudioRuntime.setGenerator(channelId, generatorType);
    onGeneratorChange?.(generatorType);
  };
  return <div className="audio-test-controls" aria-label={`${label} pitched generator controls`}>
      <div className="audio-state-line" role="status"><span className={audio.active && audio.routable ? "active" : "silent"} /> <b>{signalState}</b><small>{audio.active && !audio.routable ? "Connect to any free Channel Out" : audio.message}</small></div>
      <div className="generator-selector" aria-label={`${label} generator type`}>
        {PITCHED_GENERATOR_TYPES.map((generatorType) => <button key={generatorType} aria-pressed={audio.generatorType === generatorType} onClick={() => selectGenerator(generatorType)}>{generatorLabel(generatorType).toUpperCase()}</button>)}
      </div>
      <div className="frequency-control">
        <div className="frequency-heading"><span>PITCH</span><output aria-live="polite">{audio.frequency} Hz</output></div>
        <input aria-label={`${label} ${generatorAria} frequency`} type="range" min={AUDIO_FREQUENCY_MIN} max={AUDIO_FREQUENCY_MAX} step="1" value={audio.frequency} onChange={(event) => applicationAudioRuntime.setPitch(channelId, Number(event.target.value))} />
        <small className="commissioning-range">DEVELOPMENT / COMMISSIONING RANGE · 50 Hz–10 kHz · NOT A SAFETY LIMIT</small>
        <div className="frequency-stepper" aria-label={`${label} precise frequency controls`}>
          <button aria-label={`Decrease ${label} frequency by 1 Hz`} disabled={audio.frequency <= AUDIO_FREQUENCY_MIN} onClick={() => applicationAudioRuntime.setPitch(channelId, audio.frequency - 1)}>−</button>
          <small>1 HZ</small>
          <button aria-label={`Increase ${label} frequency by 1 Hz`} disabled={audio.frequency >= AUDIO_FREQUENCY_MAX} onClick={() => applicationAudioRuntime.setPitch(channelId, audio.frequency + 1)}>+</button>
        </div>
      </div>
      <label className="level-control"><span>LEVEL</span><div className="level-dial" style={{ "--level-angle": `${-135 + audio.level * 2.7}deg` } as CSSProperties}><i /></div><output>{audio.level}%</output><input aria-label={`${label} level`} type="range" min="0" max="100" step="1" value={audio.level} onChange={(event) => applicationAudioRuntime.setLevel(channelId, Number(event.target.value))} /></label>
      {onPlace && <button className="place-source-action" aria-label={`Place ${label} ${generatorAria} generator in Threads`} onClick={() => onPlace(audio.generatorType)}>PLACE GENERATOR</button>}
      <button aria-label={`${label} ${audio.active ? "stop" : "start"} ${generatorAria} signal`} className={`signal-toggle ${audio.active ? "stop" : "start"}`} onClick={() => { onToggle?.(); if (audio.active) applicationAudioRuntime.stopChannel(channelId); else void applicationAudioRuntime.startChannel(channelId); }}>{audio.active ? `STOP ${generatorName.toUpperCase()}` : `START ${generatorName.toUpperCase()}`}</button>
    </div>;
}

function PitchedGeneratorInspector({ state, spatialRouting, module, dispatch }: { state: AppState; spatialRouting: SpatialRoutingState; module: ModuleInstance; dispatch: React.Dispatch<Parameters<typeof appReducer>[1]> }) {
  const channel = state.threadChannels.find((item) => item.id === module.audioChannelId);
  const audio = useAudioChannel(channel?.role === "clone" ? channel.sourceId : module.audioChannelId ?? null);
  const [cascadeConfirmationModuleId, setCascadeConfirmationModuleId] = useState<string | null>(null);
  const cascadeConfirmationOpen = cascadeConfirmationModuleId === module.id;
  if (!module.audioChannelId || !audio || !channel) return null;
  const channelLabel = channel.label;
  const source = state.threadChannels.find((item) => item.id === channel.sourceId) ?? channel;
  const sharedEndpoints = state.threadChannels.filter((item) => item.role === "clone" && item.sourceId === channel.id);
  const multiPlots = spatialRouting.channels.filter((plot) => plot.isMultiPlot && plot.sourceId === channel.id);
  const dependentEndpointCount = sharedEndpoints.length + multiPlots.length;
  const generatorName = generatorLabel(audio.generatorType);
  if (channel.role === "clone") return <div className="inspector-content sine-source-inspector clone-source-inspector">
    <div className="selection-summary"><span>Legacy shared endpoint</span><strong>{module.title}</strong><small>SHARED WITH {source.label}</small></div>
    <section className="clone-inherited-source" aria-label={`Inherited source programming from ${source.label}`}>
      <span>SOURCE: {source.label.replace(" ", "")}</span><strong>{generatorName.toUpperCase()}</strong><b>{audio.frequency} Hz</b><b>LEVEL {audio.level}%</b><small>LOCKED — ADJUST AT SOURCE</small>
    </section>
    <details className="inspector-section" open><summary>Endpoint state</summary><div className="connection-summary"><span>Identity</span><b>{channel.label} SHARED ENDPOINT</b><span>Lineage</span><b>{source.label}</b><span>Routing</span><b>{state.channelTerminalConnections.some((connection) => connection.fromModuleId === module.id) ? "ROUTED" : "AWAITING CHANNEL OUT"}</b><span>Control</span><b>POSITION + LIVE TRIM AT SOUND DESK</b></div></details>
    <p className="inspector-note">Waveform, frequency and programmed level are inherited. Select {source.label} to adjust shared source programming.</p>
    <div className="lifecycle-actions clone-actions"><button className="danger" onClick={() => { applicationAudioRuntime.disposeChannel(channel.id); dispatch({ type: "delete-endpoint", channelId: channel.id }); }}>Quick Delete</button></div>
  </div>;
  return <div className="inspector-content sine-source-inspector">
    <div className="selection-summary"><span>{channel.role === "duplicate" ? "Independent duplicate" : "Placed source"}</span><strong>{module.title}</strong><small>{channelLabel} · {generatorName} oscillator{channel.duplicatedFrom ? ` · DUPLICATED FROM ${state.threadChannels.find((item) => item.id === channel.duplicatedFrom)?.label ?? channel.duplicatedFrom}` : ""}</small></div>
    <PitchedGeneratorControls channelId={module.audioChannelId} label={channelLabel} audio={audio} onGeneratorChange={(generatorType) => dispatch({ type: "set-source-generator", sourceChannelId: channel.id, generatorType })} />
    <details className="inspector-section"><summary>Source binding</summary><div className="connection-summary"><span>Identity</span><b>{channelLabel}</b><span>Output</span><b>ONE RESOLVED STREAM</b><span>Destination</span><b>ANY FREE CHANNEL OUT</b></div></details>
    <p className="inspector-note">Connect this source endpoint to any free Channel Out. Removing the node returns its player to Inputs &amp; Channels.</p>
    <details className="inspector-section source-actions" open><summary>Source actions</summary><div className="lifecycle-actions"><button onClick={() => dispatch({ type: "duplicate-source", sourceChannelId: channel.id })}>Duplicate</button><small>Additional spatial manifestations are created with Multi-Plot in Sound Desk.</small></div></details>
    {dependentEndpointCount ? <div className="cascade-delete"><strong>{dependentEndpointCount} LINKED MULTI-PLOT{dependentEndpointCount === 1 ? "" : "S"}</strong><p>Deleting this source will also destroy every associated Multi-Plot manifestation.</p>{cascadeConfirmationOpen ? <div className="cascade-confirmation" role="alert" aria-live="assertive"><strong>DELETE SOURCE?</strong><p>This permanently removes {channel.label} and all {dependentEndpointCount} associated Multi-Plot manifestation{dependentEndpointCount === 1 ? "" : "s"}. Unrelated sources and Duplicates keep playing. This cannot be undone.</p><div><button onClick={() => setCascadeConfirmationModuleId(null)}>CANCEL</button><button className="danger" onClick={() => { applicationAudioRuntime.disposeSource(channel.id); dispatch({ type: "delete-source-family", sourceChannelId: channel.id }); setCascadeConfirmationModuleId(null); }}>DELETE SOURCE + ALL MULTI-PLOTS</button></div></div> : <button className="danger" onClick={() => setCascadeConfirmationModuleId(module.id)}>DELETE SOURCE…</button>}</div> : <div className="lifecycle-actions clone-actions"><button className="danger" onClick={() => dispatch({ type: "delete-selection" })}>Remove from workspace</button></div>}
  </div>;
}

function SignalTrace({ soundingChannelKey, traceColorKey, soundDeskMuted, enabled = true }: { soundingChannelKey: string; traceColorKey: string; soundDeskMuted: boolean; enabled?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const soundingChannelIds = soundingChannelKey ? soundingChannelKey.split(",") as ChannelId[] : [];
    const traceColors = traceColorKey ? traceColorKey.split(",") : [];
    const channelSamples = soundingChannelIds.map(() => new Float32Array(512));
    let frame = 0;
    let lastDraw = 0;
    const draw = (timestamp: number) => {
      frame = window.requestAnimationFrame(draw);
      if (timestamp - lastDraw < 1_000 / 30) return;
      lastDraw = timestamp;
      const width = canvas.width;
      const height = canvas.height;
      context.clearRect(0, 0, width, height);
      const baseColor = getComputedStyle(canvas).color;
      soundingChannelIds.forEach((channelId, traceIndex) => {
        const data = applicationAudioRuntime.getWaveform(channelId, channelSamples[traceIndex]);
        if (!data) return;
        const tracePosition = soundingChannelIds.length === 1 ? 0 : traceIndex / (soundingChannelIds.length - 1) - 0.5;
        const centreY = height * (0.5 + tracePosition * 0.22);
        context.globalAlpha = soundingChannelIds.length === 1 ? 0.95 : 0.78;
        context.strokeStyle = traceColors[traceIndex] || baseColor;
        context.lineWidth = soundingChannelIds.length === 1 ? 1.8 : 1.35;
        context.beginPath();
        data.forEach((sample, index) => {
          const x = index / Math.max(1, data.length - 1) * width;
          const value = Math.max(-1, Math.min(1, sample));
          const y = centreY - value * height * 0.3;
          if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
        });
        context.stroke();
      });
      context.globalAlpha = 1;
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, soundingChannelKey, traceColorKey]);
  const soundingCount = soundingChannelKey ? soundingChannelKey.split(",").length : 0;
  const idleLabel = soundDeskMuted ? "Layered signal monitor idle; focused channel Sound Desk muted" : "Layered signal monitor idle; no sounding channels";
  return <div className={`signal-monitor ${soundingCount ? "signal-active" : ""}`} data-trace-count={soundingCount} aria-label={soundingCount ? `Layered signal monitor active with ${soundingCount} sounding ${soundingCount === 1 ? "channel" : "channels"}` : idleLabel}>
    <canvas ref={canvasRef} width="360" height="72" aria-hidden="true" />
    {!enabled && <><div className="signal-baseline" aria-hidden="true" /><strong>TRACE OFF</strong><small>DIAGNOSTIC MODE</small></>}
    {!soundingCount && <><div className="signal-baseline" aria-hidden="true" /><strong>{soundDeskMuted ? "SD MUTED" : "NO SIGNAL"}</strong><small>{soundDeskMuted ? "Sound Desk Live Trim -100%" : "Start and route a channel, then play the session"}</small></>}
    {soundingCount > 0 && <small>LAYERED VIEW · {soundingCount} {soundingCount === 1 ? "TRACE" : "TRACES"}{soundDeskMuted ? " · FOCUS SD MUTED" : ""}</small>}
  </div>;
}

function formatDbfs(value: number) {
  return Number.isFinite(value) ? `${value.toFixed(1)} dBFS` : "−∞ dBFS";
}

function MasterSafetyMeter({ reportingEnabled = true }: { reportingEnabled?: boolean }) {
  useMasterSafetyRevision(reportingEnabled);
  const safety = applicationAudioRuntime.getMasterSafetySnapshot();
  return <div className={`master-safety-meter safety-${safety.state.toLowerCase().replace(" ", "-")}`} aria-label="Master safety meter">
    <span>MASTER SAFETY</span>
    <strong>{reportingEnabled ? formatDbfs(safety.currentPeakDbfs) : "REPORT OFF"}</strong>
    <small>{reportingEnabled ? <>HOLD {formatDbfs(safety.peakHoldDbfs)} · REDUCTION {Number.isFinite(safety.reductionDb) ? `${safety.reductionDb.toFixed(1)} dB` : "MUTED"}</> : "AUDIO-THREAD PROTECTION RETAINED"}</small>
    <b>{reportingEnabled ? safety.available ? safety.state : "STANDBY" : "DIAGNOSTIC MODE"}</b>
    {safety.muteReason && <em>{safety.muteReason}</em>}
    {safety.state === "SAFETY MUTE" && <button onClick={() => applicationAudioRuntime.resetSafetyMute()}>RESET SAFETY MUTE</button>}
  </div>;
}

function Monitor({ state, spatialRouting, selectedModule, selectedModules, selectedConnection, audioDiagnosticMode = "full" }: {
  state: AppState;
  spatialRouting: SpatialRoutingState;
  selectedModule: ModuleInstance | null;
  selectedModules: ModuleInstance[];
  selectedConnection: ThreadConnection | null;
  audioDiagnosticMode?: AudioDiagnosticMode;
}) {
  const selectedChannel = state.selection?.kind === "channel" ? state.threadChannels.find((channel) => channel.id === state.selection?.id) ?? null : null;
  const sourceChannel = selectedModule?.audioChannelId ?? (selectedModule ? state.channelTerminalConnections.find((connection) => connection.fromModuleId === selectedModule.id)?.channelId : null);
  const currentChannel = selectedChannel ?? state.threadChannels.find((channel) => channel.id === sourceChannel) ?? state.threadChannels[0] ?? null;
  const audio = useAudioChannel(currentChannel?.id ?? null);
  const soundingChannelIds = applicationAudioRuntime.getSoundingChannelIds();
  const soundingChannelKey = soundingChannelIds.join(",");
  const traceColorKey = soundingChannelIds.map((channelId) => MUTED_ACCENTS.find((accent) => accent.id === (state.threadChannels.find((channel) => channel.id === channelId)?.accentId ?? spatialRouting.channels.find((plot) => plot.id === channelId)?.accentId))?.value ?? "").join(",");
  const meterEnabled = diagnosticMeterEnabled(audioDiagnosticMode);
  const scopeEnabled = diagnosticScopeEnabled(audioDiagnosticMode);
  const soundDeskMuted = Boolean(audio?.active && audio.routable && audio.liveTrim === LIVE_TRIM_MIN);
  const display = selectedModule ? getModuleDisplay(selectedModule) : null;
  const audioFocused = Boolean(audio && currentChannel && (selectedChannel || sourceChannel || !state.selection));
  const focusTitle = audioFocused && audio ? generatorLabel(audio.generatorType).toUpperCase() : selectedModules.length > 1 ? `${selectedModules.length} NODES` : selectedModule ? selectedModule.title : selectedConnection ? "THREAD" : selectedChannel ? selectedChannel.label : "IDLE";
  const focusType = audioFocused && audio ? `${audio.frequency} Hz · LEVEL ${audio.level}%` : selectedModule ? selectedModule.type.replaceAll("-", " ").toUpperCase() : selectedConnection ? "COMMITTED CONNECTION" : selectedChannel ? "CHANNEL OUTPUT" : "NO OBJECT SELECTED";
  const focusDetail = audioFocused && audio ? soundDeskMuted ? "SD MUTED · SOUND DESK LIVE TRIM -100%" : audio.active && !audio.routable ? "UNROUTED · NO CHANNEL OUT" : audio.active ? "ACTIVE · CENTRED OUTPUT" : audio.availability === "error" ? audio.message : "SILENT · READY" : selectedModule && display ? `${display.detail} · ${display.value}` : selectedConnection ? selectedConnection.id : selectedChannel ? (state.channelTerminalConnections.some((connection) => connection.channelId === selectedChannel.id) ? "OUTPUT READY" : "AWAITING OUTPUT") : "Select a node, Thread, or channel";
  return <div className="monitor-content" role="status" aria-live="polite" aria-label="Selection monitor">
    <div className="monitor-focus"><span>CURRENT FOCUS</span><strong>{currentChannel ? `${currentChannel.label} / ${String(state.threadChannels.length).padStart(2, "0")}` : "NO CHANNEL"}</strong><small>{focusTitle}</small></div>
    <div className="monitor-object"><span>OBJECT</span><strong>{focusType}</strong><small>{focusDetail}</small></div>
    {audio && currentChannel ? <SignalTrace soundingChannelKey={soundingChannelKey} traceColorKey={traceColorKey} soundDeskMuted={soundDeskMuted} enabled={scopeEnabled} /> : <div className="signal-monitor" aria-label="Signal monitor idle; no channel"><div className="signal-baseline" aria-hidden="true" /><strong>NO CHANNEL</strong><small>Add a channel to begin</small></div>}
    <MasterSafetyMeter reportingEnabled={meterEnabled} />
    <div className="monitor-session"><span>AUDIO</span><strong>{soundDeskMuted ? "SD MUTED" : audio?.active && !audio.routable ? "UNROUTED" : audio?.active ? "ACTIVE" : audio?.availability === "error" ? "ERROR" : "SILENT"}</strong><small>{audio ? soundDeskMuted ? "Sound Desk Live Trim -100%" : audio.active && !audio.routable ? "Connect to any free Channel Out" : audio.active ? `${audio.frequency} Hz · ${audio.level}%` : audio.message : "No channel selected"}</small></div>
  </div>;
}

function deleteSelectionWithSpatialGuard(state: AppState, spatialRouting: SpatialRoutingState, dispatch: React.Dispatch<Parameters<typeof appReducer>[1]>) {
  const selectedIds = getSelectedModuleIds(state.selection);
  const protectedModule = state.modules.find((module) => {
    if (!selectedIds.includes(module.id) || !module.audioChannelId) return false;
    const channel = state.threadChannels.find((item) => item.id === module.audioChannelId && item.role !== "clone");
    return Boolean(channel && spatialRouting.channels.some((plot) => plot.isMultiPlot && plot.sourceId === channel.id));
  });
  if (protectedModule?.audioChannelId) {
    dispatch({ type: "select-module", id: protectedModule.id });
    dispatch({ type: "set-status", value: `${protectedModule.audioChannelId.replace("channel-", "CH ")} has linked Multi-Plots — confirm source deletion in Inspector` });
    return;
  }
  dispatch({ type: "delete-selection" });
}

export default function Home() {
  const isDevelopment = process.env.NODE_ENV === "development";
  const audioDiagnosticMode = useAudioDiagnosticMode();
  const [state, dispatch] = useReducer(appReducer, undefined, createInitialState);
  const [spatialRouting, dispatchSpatialRouting] = useReducer(spatialRoutingReducer, undefined, createInitialSpatialRoutingState);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>("threads");
  useEffect(() => {
    dispatchSpatialRouting({ type: "sync-channels", channels: state.threadChannels });
  }, [state.threadChannels]);
  useEffect(() => {
    const routableIds = new Set(getIncomingChannels(state).filter((channel) => channel.status === "complete").map((channel) => channel.id));
    const assignedSourceIds = new Set(spatialRouting.channels.filter((plot) => plot.assignment).map((plot) => plot.sourceId));
    spatialRouting.channels.forEach((plot) => {
      const threadsAudition = activeWorkspace === "threads" && !plot.isMultiPlot && !assignedSourceIds.has(plot.sourceId);
      applicationAudioRuntime.setChannelRoutable(plot.id, routableIds.has(plot.channelId) && (Boolean(plot.assignment) || threadsAudition));
      if (plot.assignment && !routableIds.has(plot.channelId)) dispatchSpatialRouting({ type: "unassign-channel", channelId: plot.id });
    });
  }, [activeWorkspace, spatialRouting.channels, state]);
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
  const canvasRef = useRef<HTMLDivElement>(null);
  const panDrag = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const userEditedRef = useRef(false);
  const copiedDuplicateIds = useRef(new Set<ChannelId>());
  const uiConfig = themeConfigs[theme];
  const selectedModuleIds = getSelectedModuleIds(state.selection);
  const selectedModules = state.modules.filter((module) => selectedModuleIds.includes(module.id));
  const selectedModule = selectedModules.length === 1 ? selectedModules[0] : null;
  const selectedConnection = state.selection?.kind === "connection" ? state.connections.find((connection) => connection.id === state.selection?.id) ?? null : null;
  const elapsedText = formatElapsed(getElapsedMs(state.session, clockNow));
  const benchmark = state.modules.length >= 32;
  const requestDeleteSelection = () => deleteSelectionWithSpatialGuard(state, spatialRouting, dispatch);

  useEffect(() => {
    (window as Window & { __rfeAudioRuntime?: typeof applicationAudioRuntime }).__rfeAudioRuntime = applicationAudioRuntime;
    return () => { delete (window as Window & { __rfeAudioRuntime?: typeof applicationAudioRuntime }).__rfeAudioRuntime; };
  }, []);

  useEffect(() => {
    const multiPlotTopology = spatialRouting.channels.filter((plot) => plot.isMultiPlot).map((plot) => ({ id: plot.id, sourceId: plot.sourceId }));
    applicationAudioRuntime.synchronizeTopology([...state.threadChannels, ...multiPlotTopology]);
    state.threadChannels.forEach((channel) => {
      if (channel.role !== "duplicate" || !channel.duplicatedFrom || copiedDuplicateIds.current.has(channel.id)) return;
      applicationAudioRuntime.copyProgramming(channel.duplicatedFrom, channel.id);
      copiedDuplicateIds.current.add(channel.id);
    });
  }, [spatialRouting.channels, state.threadChannels]);

  useEffect(() => {
    state.modules.forEach((module) => {
      if (!module.audioChannelId || !isPitchedGeneratorModule(module)) return;
      applicationAudioRuntime.setGenerator(module.audioChannelId, module.generatorType ?? "sine");
    });
  }, [state.modules]);

  useEffect(() => {
    spatialRouting.channels.forEach((channel) => {
      applicationAudioRuntime.setSpatialX(channel.id, channel.assignment?.x ?? 0);
      applicationAudioRuntime.setLiveTrim(channel.id, channel.liveTrim);
    });
  }, [spatialRouting.channels]);

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
        deleteSelectionWithSpatialGuard(state, spatialRouting, dispatch);
      }
      if (event.key === "Escape") dispatch({ type: "cancel-connection" });
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [spatialRouting, state]);

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
          <InputsAndChannels state={state} spatialRouting={spatialRouting} collapsed={inputsCollapsed} onToggle={() => setInputsCollapsed((value) => !value)} dispatch={dispatch} />
          <div className="workspace-region"><div className="workspace-toolbar"><div className="tool-cluster" aria-label="Canvas tools"><button className={state.tool === "select" ? "tool-active" : ""} aria-label="Select tool" onClick={() => dispatch({ type: "set-tool", value: "select" })}>↖</button><button className={state.tool === "pan" ? "tool-active" : ""} aria-label="Pan tool" onClick={() => dispatch({ type: "set-tool", value: "pan" })}>✥</button><button className={state.gridVisible ? "tool-active" : ""} aria-label="Toggle grid" aria-pressed={state.gridVisible} onClick={() => dispatch({ type: "toggle-grid" })}>⠿</button></div><span className="workspace-context">THREAD CONSTRUCTION · {state.statusMessage}</span><SessionTransport dispatch={dispatch} /><div className="zoom-control"><button aria-label="Zoom out" onClick={() => dispatch({ type: "set-zoom", value: state.zoom - 10 })}>−</button><span>{state.zoom}%</span><button aria-label="Zoom in" onClick={() => dispatch({ type: "set-zoom", value: state.zoom + 10 })}>＋</button></div><div className="layout-switch" aria-label="Layout mode"><button className={state.layout === "studio" ? "active" : ""} onClick={() => dispatch({ type: "set-layout", value: "studio" })}>Studio</button><button className={state.layout === "compact" ? "active" : ""} onClick={() => dispatch({ type: "set-layout", value: "compact" })}>Compact</button></div><button className="toolbar-toggle" aria-expanded={toolbarExpanded} aria-controls="workspace-secondary-tools" onClick={() => setToolbarExpanded((value) => !value)}>{toolbarExpanded ? "Hide tools ↑" : "More tools ↓"}</button></div>
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
              <button disabled={!selectedModuleIds.length} className="danger" onClick={requestDeleteSelection}>Delete selected</button>
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
      <WindowFrame title="Thread Inspector" className="inspector-window"><Inspector state={state} spatialRouting={spatialRouting} selectedModule={selectedModule} selectedModules={selectedModules} selectedConnection={selectedConnection} uiConfig={uiConfig} updateParameter={updateParameter} setAccent={(accentId) => selectedModule && dispatch({ type: "set-accent", id: selectedModule.id, accentId })} setHighlightStyle={setHighlightStyle} setHighlightWeight={setHighlightWeight} onDeleteSelection={requestDeleteSelection} dispatch={dispatch} /></WindowFrame>
      <WindowFrame title="Monitor" className="diagnostics-window monitor-window" compactControls><Monitor state={state} spatialRouting={spatialRouting} selectedModule={selectedModule} selectedModules={selectedModules} selectedConnection={selectedConnection} audioDiagnosticMode={audioDiagnosticMode} /></WindowFrame>
    </div> : activeWorkspace === "sound-desk" ? <SoundDeskWorkspace threadsState={state} state={spatialRouting} dispatch={dispatchSpatialRouting} sessionDispatch={dispatch} /> : <VisualiserWorkspace state={spatialRouting} sessionDispatch={dispatch} />}
    </div>
    <WorkspaceNavigation workspace={activeWorkspace} navigate={navigateWorkspace} />
    {isDevelopment && activeWorkspace === "threads" && <UIWorkshop config={uiConfig} onChange={setUIConfig} onReset={() => setThemeConfigs((current) => ({ ...current, [theme]: theme === "light" ? BASELINE_UI_CONFIG : DARK_UI_CONFIG }))} />}
  </main>;
}
