import { createChannelDefinition, type ChannelId, type ThreadChannel } from "./channel-routing.ts";
import type { AccentId } from "./ui-config.ts";

export { CHANNEL_ACCENT_IDS } from "./channel-routing.ts";

export const SPATIAL_AXIS = [-2, -1, 0, 1, 2] as const;

export type SpatialAxisValue = (typeof SPATIAL_AXIS)[number];
export type SpatialCoordinate = Readonly<{ x: SpatialAxisValue; y: SpatialAxisValue }>;
export type SpatialPosition = Readonly<{ x: number; y: number }>;

// Screen orientation: X increases left -> right; Y increases bottom -> top.
// Descending Y order places (+Y) at the top while preserving Cartesian coordinates.
export const SPATIAL_COORDINATES: readonly SpatialCoordinate[] = [...SPATIAL_AXIS]
  .reverse()
  .flatMap((y) => SPATIAL_AXIS.map((x) => Object.freeze({ x, y })));

export type SpatialChannel = Readonly<{
  id: ChannelId;
  channelId: ChannelId;
  sourceId: ChannelId;
  label: string;
  shortLabel: string;
  accentId: AccentId;
  assignment: SpatialPosition | null;
  liveTrim: number;
  plotNumber: number;
  layerOrder: number;
  isMultiPlot: boolean;
}>;

export type SpatialRoutingState = Readonly<{
  channels: readonly SpatialChannel[];
  nextPlotSequence: number;
}>;

export type SpatialRoutingAction =
  | { type: "assign-channel"; channelId: string; coordinate: SpatialPosition }
  | { type: "unassign-channel"; channelId: string }
  | { type: "move-plot"; plotId: string; position: SpatialPosition }
  | { type: "move-plot-stack"; plotIds: readonly string[]; position: SpatialPosition }
  | { type: "move-plot-layer"; plotId: string; direction: "forward" | "back" }
  | { type: "add-multi-plot"; channelId: ChannelId }
  | { type: "remove-multi-plot"; plotId: ChannelId }
  | { type: "set-live-trim"; channelId: string; value: number }
  | { type: "sync-channels"; channels: readonly ThreadChannel[] };

export function coordinateKey(coordinate: SpatialPosition): string {
  return `${coordinate.x},${coordinate.y}`;
}

function formatAxisValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function coordinateLabel(coordinate: SpatialPosition): string {
  return `(${formatAxisValue(coordinate.x)},${formatAxisValue(coordinate.y)})`;
}

export function getCoordinateByKey(key: string): SpatialCoordinate | null {
  return SPATIAL_COORDINATES.find((coordinate) => coordinateKey(coordinate) === key) ?? null;
}

export function isCanonicalCoordinate(coordinate: SpatialPosition): boolean {
  return SPATIAL_COORDINATES.some((point) => point.x === coordinate.x && point.y === coordinate.y);
}

export function isSpatialPosition(position: SpatialPosition): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y) && position.x >= -2 && position.x <= 2 && position.y >= -2 && position.y <= 2;
}

export function getChannelsAtCoordinate(state: SpatialRoutingState, coordinate: SpatialPosition): SpatialChannel[] {
  return state.channels.filter((channel) => channel.assignment?.x === coordinate.x && channel.assignment.y === coordinate.y);
}

export function createInitialSpatialRoutingState(channels: readonly ThreadChannel[] = [createChannelDefinition(1)]): SpatialRoutingState {
  return {
    channels: channels.map((channel) => ({
      id: channel.id,
      channelId: channel.id,
      sourceId: channel.sourceId,
      label: channel.label,
      shortLabel: channel.shortLabel,
      accentId: channel.accentId,
      assignment: channel.id === "channel-01" ? getCoordinateByKey("0,0") : null,
      liveTrim: 0,
      plotNumber: 1,
      layerOrder: 1,
      isMultiPlot: false,
    })),
    nextPlotSequence: 1,
  };
}

export function spatialRoutingReducer(state: SpatialRoutingState, action: SpatialRoutingAction): SpatialRoutingState {
  if (action.type === "sync-channels") {
    const definitions = new Map(action.channels.map((channel) => [channel.id, channel]));
    const sourcePlots = action.channels.map((channel) => {
      const existing = state.channels.find((item) => !item.isMultiPlot && item.id === channel.id);
      return {
        id: channel.id,
        channelId: channel.id,
        sourceId: channel.sourceId,
        label: channel.label,
        shortLabel: channel.shortLabel,
        accentId: channel.accentId,
        assignment: existing?.assignment ?? null,
        liveTrim: existing?.liveTrim ?? 0,
        plotNumber: 1,
        layerOrder: existing?.layerOrder ?? 1,
        isMultiPlot: false,
      } satisfies SpatialChannel;
    });
    const multiPlots = state.channels.filter((channel) => channel.isMultiPlot && definitions.has(channel.channelId)).map((channel) => {
      const definition = definitions.get(channel.channelId)!;
      return { ...channel, sourceId: definition.sourceId, accentId: definition.accentId, shortLabel: definition.shortLabel, label: definition.label };
    });
    return {
      channels: [...sourcePlots, ...multiPlots],
      nextPlotSequence: state.nextPlotSequence,
    };
  }
  if (action.type === "add-multi-plot") {
    const sourcePlot = state.channels.find((channel) => !channel.isMultiPlot && channel.channelId === action.channelId);
    if (!sourcePlot?.assignment) return state;
    const plotNumber = Math.max(1, ...state.channels.filter((channel) => channel.channelId === action.channelId).map((channel) => channel.plotNumber)) + 1;
    const plotId = `${action.channelId}-plot-${state.nextPlotSequence}` as ChannelId;
    const offsetIndex = plotNumber - 2;
    const offsetRadius = 0.5 + Math.floor(offsetIndex / 4) * 0.25;
    const offsetAngle = offsetIndex % 4 * Math.PI / 2;
    return {
      channels: [...state.channels, {
        ...sourcePlot,
        id: plotId,
        assignment: {
          x: Math.max(-2, Math.min(2, sourcePlot.assignment.x + Math.cos(offsetAngle) * offsetRadius)),
          y: Math.max(-2, Math.min(2, sourcePlot.assignment.y + Math.sin(offsetAngle) * offsetRadius)),
        },
        liveTrim: 0,
        plotNumber,
        layerOrder: Math.max(0, ...state.channels.map((channel) => channel.layerOrder)) + 1,
        isMultiPlot: true,
      }],
      nextPlotSequence: state.nextPlotSequence + 1,
    };
  }
  if (action.type === "remove-multi-plot") {
    if (!state.channels.some((channel) => channel.id === action.plotId && channel.isMultiPlot)) return state;
    return { ...state, channels: state.channels.filter((channel) => channel.id !== action.plotId) };
  }
  if (action.type === "move-plot") {
    if (!isSpatialPosition(action.position)) return state;
    return { ...state, channels: state.channels.map((channel) => channel.id === action.plotId && channel.assignment ? { ...channel, assignment: { ...action.position } } : channel) };
  }
  if (action.type === "move-plot-stack") {
    if (!isSpatialPosition(action.position) || action.plotIds.length < 2) return state;
    const plotIds = new Set(action.plotIds);
    const members = state.channels.filter((channel) => plotIds.has(channel.id) && channel.assignment);
    if (members.length !== plotIds.size) return state;
    const origin = members[0].assignment!;
    if (!members.every((channel) => channel.assignment!.x === origin.x && channel.assignment!.y === origin.y)) return state;
    return { ...state, channels: state.channels.map((channel) => plotIds.has(channel.id) ? { ...channel, assignment: { ...action.position } } : channel) };
  }
  if (action.type === "move-plot-layer") {
    const plot = state.channels.find((channel) => channel.id === action.plotId && channel.assignment);
    if (!plot?.assignment) return state;
    const stack = state.channels
      .filter((channel) => channel.assignment?.x === plot.assignment!.x && channel.assignment.y === plot.assignment!.y)
      .sort((a, b) => a.layerOrder - b.layerOrder);
    const index = stack.findIndex((channel) => channel.id === plot.id);
    const targetIndex = action.direction === "forward" ? index + 1 : index - 1;
    const target = stack[targetIndex];
    if (!target) return state;
    return {
      ...state,
      channels: state.channels.map((channel) => channel.id === plot.id ? { ...channel, layerOrder: target.layerOrder } : channel.id === target.id ? { ...channel, layerOrder: plot.layerOrder } : channel),
    };
  }
  const channelExists = state.channels.some((channel) => channel.id === action.channelId);
  if (!channelExists) return state;
  if (action.type === "set-live-trim") {
    if (typeof action.value !== "number" || !Number.isFinite(action.value)) return state;
    const liveTrim = Math.max(-100, Math.min(16, Math.round(action.value)));
    return { ...state, channels: state.channels.map((channel) => channel.id === action.channelId ? { ...channel, liveTrim } : channel) };
  }
  if (action.type === "assign-channel" && !isCanonicalCoordinate(action.coordinate)) return state;
  const assignment = action.type === "assign-channel" ? action.coordinate : null;
  return {
    ...state,
    channels: state.channels.map((channel) => channel.id === action.channelId ? { ...channel, assignment } : channel),
  };
}
