import type {
  MemoryProfile,
  Workspace,
} from "../../contracts/hivemem.generated";
export function memoryCan(
  profile: MemoryProfile | null,
  permission: string,
): boolean {
  if (!profile) return false;
  if (
    profile.role === "admin" ||
    profile.scopes.includes("admin:all") ||
    profile.scopes.includes(permission)
  )
    return true;
  // HiveMem requires explicit native administrator authority for these actions.
  if (permission.startsWith("admin:")) return false;
  return profile.scopes.some(
    (scope) =>
      scope === "*" ||
      (scope.endsWith(":*") && permission.startsWith(scope.slice(0, -1))),
  );
}
export function workspaceCan(
  profile: MemoryProfile | null,
  workspace: Workspace,
  permission: "admin" | "owner",
): boolean {
  if (
    !memoryCan(profile, "workspaces:write") ||
    !profile ||
    (profile.workspace_ids &&
      !profile.workspace_ids.includes(workspace.workspace_id))
  )
    return false;
  if (
    profile.role === "admin" ||
    profile.scopes.includes("admin:all") ||
    workspace.owner_agent_id === profile.agent_id
  )
    return true;
  return (
    permission === "admin" &&
    workspace.members.some(
      (member) =>
        member.agent_id === profile.agent_id &&
        ["admin", "owner"].includes(member.role),
    )
  );
}
