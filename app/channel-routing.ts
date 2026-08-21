import type { AccentId } from "./ui-config";

export type ChannelId = `channel-${string}`;
export type IncomingChannelStatus = "complete" | "incomplete";
export type ChannelReplicationRole = "source" | "clone" | "duplicate";

export type ChannelDefinition = Readonly<{
  id: ChannelId;
  label: string;
  shortLabel: string;
  accentId: AccentId;
  role: ChannelReplicationRole;
  sourceId: ChannelId;
  duplicatedFrom: ChannelId | null;
}>;

export type ThreadChannel = ChannelDefinition;
export type ChannelTerminalConnection = Readonly<{
  id: string;
  channelId: ChannelId;
  fromModuleId: string;
}>;

export type ChannelSourceState = Readonly<{
  modules: readonly Readonly<{ id: string; enabled: boolean; audioChannelId?: ChannelId; ports: Readonly<{ output: boolean }> }>[];
  threadChannels: readonly ThreadChannel[];
  channelTerminalConnections: readonly ChannelTerminalConnection[];
}>;

export type IncomingChannel = ChannelDefinition & Readonly<{
  status: IncomingChannelStatus;
  sourceModuleId: string | null;
}>;

export const CHANNEL_ACCENT_IDS = ["coral", "stone", "moss", "utility-blue", "air-blue", "signal-red"] as const satisfies readonly AccentId[];

export function createChannelDefinition(sequence: number, replication: Partial<Pick<ChannelDefinition, "role" | "sourceId" | "duplicatedFrom">> = {}): ChannelDefinition {
  const safeSequence = Math.max(1, Math.floor(sequence));
  const number = String(safeSequence).padStart(2, "0");
  const id = `channel-${number}` as ChannelId;
  return {
    id,
    label: `CH ${number}`,
    shortLabel: String(safeSequence),
    accentId: CHANNEL_ACCENT_IDS[(safeSequence - 1) % CHANNEL_ACCENT_IDS.length],
    role: replication.role ?? "source",
    sourceId: replication.sourceId ?? id,
    duplicatedFrom: replication.duplicatedFrom ?? null,
  };
}

export function getSourceChannelId(channel: Pick<ThreadChannel, "id" | "sourceId">): ChannelId {
  return channel.sourceId ?? channel.id;
}

export function getDependentClones(channels: readonly ThreadChannel[], sourceId: ChannelId): ThreadChannel[] {
  return channels.filter((channel) => channel.role === "clone" && getSourceChannelId(channel) === sourceId);
}

export function getChannelDefinition(state: Pick<ChannelSourceState, "threadChannels">, channelId: string): ChannelDefinition | null {
  return state.threadChannels.find((channel) => channel.id === channelId) ?? null;
}

export function getIncomingChannels(state: ChannelSourceState): IncomingChannel[] {
  return state.threadChannels.map((definition) => {
    const boundSourceIds = new Set(state.modules.filter((module) => module.audioChannelId === definition.id).map((module) => module.id));
    const connection = boundSourceIds.size
      ? state.channelTerminalConnections.find((item) => boundSourceIds.has(item.fromModuleId))
      : state.channelTerminalConnections.find((item) => item.channelId === definition.id && !state.modules.find((module) => module.id === item.fromModuleId)?.audioChannelId);
    const source = connection ? state.modules.find((module) => module.id === connection.fromModuleId) : null;
    const complete = Boolean(source?.enabled && source.ports.output);
    return { ...definition, status: complete ? "complete" : "incomplete", sourceModuleId: complete ? source!.id : null };
  });
}

export function isChannelRoutable(state: ChannelSourceState, channelId: string): boolean {
  return getIncomingChannels(state).some((channel) => channel.id === channelId && channel.status === "complete");
}

export function canConnectChannelTerminal(state: ChannelSourceState, fromModuleId: string, channelId: string): { valid: boolean; reason: string } {
  const source = state.modules.find((module) => module.id === fromModuleId);
  const channel = state.threadChannels.find((item) => item.id === channelId);
  if (!source || !channel) return { valid: false, reason: "Channel endpoint unavailable" };
  if (!source.enabled || !source.ports.output) return { valid: false, reason: "This module cannot feed a channel output" };
  if (state.channelTerminalConnections.some((connection) => connection.fromModuleId === source.id)) return { valid: false, reason: "This source endpoint is already connected to a Channel Out" };
  if (state.channelTerminalConnections.some((connection) => connection.channelId === channelId)) return { valid: false, reason: "Channel output is already complete" };
  return { valid: true, reason: "Valid free Channel Out" };
}
