// Reads the conversation screens need beyond `data/mod.ts`: the agents that can work in a workspace (the new session's
// picker) and a project's files (pointing the agent at one). Both are routes the phone may call (protocol/remote/allowlist.ts).
import { useMemo } from "react";
import { agentList } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import {
  type AgentId,
  isCodingBuiltin,
  isLophn,
  lophnIdOf,
  type Workspace,
} from "../../../../protocol/lophn-agent/workspaces.ts";
import { projectFilesList } from "../../../../protocol/projects/project-files.ts";
import type { AgentProfile } from "../../../../shell/renderer/conversation/agent-tab-source.ts";
import { useCoreRead } from "../../../../shell/renderer/desktop/connection/core-read.ts";

export interface AgentChoice {
  readonly agent: AgentId;
  readonly name: string;
  readonly profile: AgentProfile;
  /** null: every workspace. */
  readonly scoped: boolean;
}

const sameWorkspace = (
  a: { kind: string; id: string } | null,
  b: Workspace | null,
) => (a === null ? b === null : b !== null && a.kind === b.kind && a.id === b.id);

/**
 * The lophn agents that can work in this workspace: its own lophn first, then the global agents and the ones scoped to
 * it. Coding agents are left out; the phone does not run them yet.
 */
export function useAgentChoices(
  workspace: Workspace | null,
): readonly AgentChoice[] {
  const read = useCoreRead(
    agentList,
    workspace === null ? {} : { workspace },
  ).loaded;
  return useMemo(() => {
    if (read.state !== "ready") return [];
    const own = lophnIdOf(workspace);
    return read.value.agents
      .filter((row) =>
        isLophn(row.agent)
          ? row.agent === own
          : !isCodingBuiltin(row.agent) &&
            (row.workspace === null || sameWorkspace(row.workspace, workspace)),
      )
      .map((row) => ({
        agent: row.agent,
        name: row.name,
        profile:
          row.profile.kind === "character"
            ? row.profile
            : { kind: "initial" as const, text: row.name.slice(0, 1) },
        scoped: row.workspace !== null,
      }))
      .sort((a, b) => Number(b.agent === own) - Number(a.agent === own));
  }, [read, workspace]);
}

/** One folder of a project, folders first. Empty while loading or when it cannot be read. */
export function useProjectFiles(project: string, path: string) {
  const read = useCoreRead(
    projectFilesList,
    path === "" ? { project } : { project, path },
  ).loaded;
  return read.state === "ready" ? read.value.entries : [];
}
