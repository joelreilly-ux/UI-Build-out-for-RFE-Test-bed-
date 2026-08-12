import { CHANNEL_DEFINITIONS, type ChannelId } from "./channel-routing.ts";

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
  accentId: (typeof CHANNEL_DEFINITIONS)[number]["accentId"];
  assignment: SpatialCoordinate | null;
}>;

export type SpatialRoutingState = Readonly<{
  channels: readonly SpatialChannel[];
}>;

export type SpatialRoutingAction =
  | { type: "assign-channel"; channelId: string; coordinate: SpatialCoordinate }
  | { type: "unassign-channel"; channelId: string };

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

export function createInitialSpatialRoutingState(): SpatialRoutingState {
  const initialAssignments: Readonly<Record<string, string>> = {
    "channel-01": "0,0",
    "channel-02": "-2,-1",
    "channel-03": "1,2",
    "channel-04": "-1,1",
    "channel-05": "2,-2",
  };
  return {
    channels: CHANNEL_DEFINITIONS.map((channel) => ({ ...channel, assignment: getCoordinateByKey(initialAssignments[channel.id] ?? "") })),
  };
}

export function spatialRoutingReducer(state: SpatialRoutingState, action: SpatialRoutingAction): SpatialRoutingState {
  const channelExists = state.channels.some((channel) => channel.id === action.channelId);
  if (!channelExists) return state;
  if (action.type === "assign-channel" && !isCanonicalCoordinate(action.coordinate)) return state;
  const assignment = action.type === "assign-channel" ? action.coordinate : null;
  return {
    channels: state.channels.map((channel) => channel.id === action.channelId ? { ...channel, assignment } : channel),
  };
}
