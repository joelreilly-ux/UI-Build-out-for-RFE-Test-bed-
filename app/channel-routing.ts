import type { AccentId } from "./ui-config";

export type ChannelId = `channel-${string}`;
export type IncomingChannelStatus = "complete" | "incomplete" | "unused";

export type ChannelDefinition = Readonly<{
  id: ChannelId;
  label: string;
  shortLabel: string;
  accentId: AccentId;
}>;

export type ThreadChannel = Readonly<{ channelId: ChannelId }>;
export type ChannelTerminalConnection = Readonly<{
  id: string;
  channelId: ChannelId;
  fromModuleId: string;
}>;

export type ChannelSourceState = Readonly<{
  modules: readonly Readonly<{ id: string; enabled: boolean; ports: Readonly<{ output: boolean }> }>[];
  threadChannels: readonly ThreadChannel[];
  channelTerminalConnections: readonly ChannelTerminalConnection[];
}>;

export type IncomingChannel = ChannelDefinition & Readonly<{
  status: IncomingChannelStatus;
  sourceModuleId: string | null;
}>;

export const CHANNEL_ACCENT_IDS = ["coral", "stone", "moss", "utility-blue", "air-blue"] as const satisfies readonly AccentId[];

// Six visible positions prove that the five-channel test population is a minimum,
// not an architectural maximum. Additional definitions can be appended later.
export const CHANNEL_DEFINITIONS: readonly ChannelDefinition[] = [
  { id: "channel-01", label: "CH 01", shortLabel: "1", accentId: "coral" },
  { id: "channel-02", label: "CH 02", shortLabel: "2", accentId: "stone" },
  { id: "channel-03", label: "CH 03", shortLabel: "3", accentId: "moss" },
  { id: "channel-04", label: "CH 04", shortLabel: "4", accentId: "utility-blue" },
  { id: "channel-05", label: "CH 05", shortLabel: "5", accentId: "air-blue" },
  { id: "channel-06", label: "CH 06", shortLabel: "6", accentId: "signal-red" },
];

export function getChannelDefinition(channelId: string): ChannelDefinition | null {
  return CHANNEL_DEFINITIONS.find((channel) => channel.id === channelId) ?? null;
}

export function getIncomingChannels(state: ChannelSourceState): IncomingChannel[] {
  return CHANNEL_DEFINITIONS.map((definition) => {
    const exists = state.threadChannels.some((channel) => channel.channelId === definition.id);
    if (!exists) return { ...definition, status: "unused", sourceModuleId: null };
    const connection = state.channelTerminalConnections.find((item) => item.channelId === definition.id);
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
  const channel = state.threadChannels.find((item) => item.channelId === channelId);
  if (!source || !channel) return { valid: false, reason: "Channel endpoint unavailable" };
  if (!source.enabled || !source.ports.output) return { valid: false, reason: "This module cannot feed a channel output" };
  if (state.channelTerminalConnections.some((connection) => connection.channelId === channelId)) return { valid: false, reason: "Channel output is already complete" };
  return { valid: true, reason: "Valid channel output" };
}
