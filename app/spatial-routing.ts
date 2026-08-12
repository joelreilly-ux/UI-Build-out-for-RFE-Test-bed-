import { createChannelDefinition, type ChannelId, type ThreadChannel } from "./channel-routing.ts";
import type { AccentId } from "./ui-config.ts";

export { CHANNEL_ACCENT_IDS } from "./channel-routing.ts";

export const SPATIAL_AXIS = [-2, -1, 0, 1, 2] as const;

export type SpatialAxisValue = (typeof SPATIAL_AXIS)[number];
export type SpatialCoordinate = Readonly<{ x: SpatialAxisValue; y: SpatialAxisValue }>;

// Screen orientation: X increases left -> right; Y increases bottom -> top.
// Descending Y order places (+Y) at the top while preserving Cartesian coordinates.
export const SPATIAL_COORDINATES: readonly SpatialCoordinate[] = [...SPATIAL_AXIS]
  .reverse()
  .flatMap((y) => SPATIAL_AXIS.map((x) => Object.freeze({ x, y })));

export type SpatialChannel = Readonly<{
  id: ChannelId;
  label: string;
  shortLabel: string;
  accentId: AccentId;
  assignment: SpatialCoordinate | null;
  liveTrim: number;
}>;

export type SpatialRoutingState = Readonly<{
  channels: readonly SpatialChannel[];
}>;

export type SpatialRoutingAction =
  | { type: "assign-channel"; channelId: string; coordinate: SpatialCoordinate }
  | { type: "unassign-channel"; channelId: string }
  | { type: "set-live-trim"; channelId: string; value: number }
  | { type: "sync-channels"; channels: readonly ThreadChannel[] };

export function coordinateKey(coordinate: SpatialCoordinate): string {
  return `${coordinate.x},${coordinate.y}`;
}

export function coordinateLabel(coordinate: SpatialCoordinate): string {
  return `(${coordinate.x},${coordinate.y})`;
}

export function getCoordinateByKey(key: string): SpatialCoordinate | null {
  return SPATIAL_COORDINATES.find((coordinate) => coordinateKey(coordinate) === key) ?? null;
}

export function isCanonicalCoordinate(coordinate: SpatialCoordinate): boolean {
  return SPATIAL_COORDINATES.some((point) => point.x === coordinate.x && point.y === coordinate.y);
}

export function getChannelsAtCoordinate(state: SpatialRoutingState, coordinate: SpatialCoordinate): SpatialChannel[] {
  return state.channels.filter((channel) => channel.assignment?.x === coordinate.x && channel.assignment.y === coordinate.y);
}

export function createInitialSpatialRoutingState(channels: readonly ThreadChannel[] = [createChannelDefinition(1)]): SpatialRoutingState {
  return {
    channels: channels.map((channel) => ({ ...channel, assignment: channel.id === "channel-01" ? getCoordinateByKey("0,0") : null, liveTrim: 0 })),
  };
}

export function spatialRoutingReducer(state: SpatialRoutingState, action: SpatialRoutingAction): SpatialRoutingState {
  if (action.type === "sync-channels") {
    return {
      channels: action.channels.map((channel) => ({
        ...channel,
        assignment: state.channels.find((existing) => existing.id === channel.id)?.assignment ?? null,
        liveTrim: state.channels.find((existing) => existing.id === channel.id)?.liveTrim ?? 0,
      })),
    };
  }
  const channelExists = state.channels.some((channel) => channel.id === action.channelId);
  if (!channelExists) return state;
  if (action.type === "set-live-trim") {
    const liveTrim = Math.max(-100, Math.min(16, Math.round(action.value)));
    return { channels: state.channels.map((channel) => channel.id === action.channelId ? { ...channel, liveTrim } : channel) };
  }
  if (action.type === "assign-channel" && !isCanonicalCoordinate(action.coordinate)) return state;
  const assignment = action.type === "assign-channel" ? action.coordinate : null;
  return {
    channels: state.channels.map((channel) => channel.id === action.channelId ? { ...channel, assignment } : channel),
  };
}
