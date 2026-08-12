export const WORKSPACES = [
  { id: "threads", label: "Threads", position: 1 },
  { id: "sound-desk", label: "Sound Desk", position: 2 },
  { id: "visualiser", label: "Visualiser", position: 3 },
] as const;

export type WorkspaceId = (typeof WORKSPACES)[number]["id"];
export type WorkspaceDirection = "previous" | "next";
export type WorkspaceTransitionDirection = "backward" | "forward";

export function getWorkspaceIndex(workspace: WorkspaceId): number {
  return WORKSPACES.findIndex((item) => item.id === workspace);
}

export function getWorkspace(workspace: WorkspaceId) {
  return WORKSPACES[getWorkspaceIndex(workspace)];
}

export function getAdjacentWorkspace(workspace: WorkspaceId, direction: WorkspaceDirection): WorkspaceId | null {
  const offset = direction === "next" ? 1 : -1;
  return WORKSPACES[getWorkspaceIndex(workspace) + offset]?.id ?? null;
}

export function getTransitionDirection(from: WorkspaceId, to: WorkspaceId): WorkspaceTransitionDirection | null {
  const distance = getWorkspaceIndex(to) - getWorkspaceIndex(from);
  if (Math.abs(distance) !== 1) return null;
  return distance > 0 ? "forward" : "backward";
}
