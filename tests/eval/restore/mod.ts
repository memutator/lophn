// trial마다 새 data root에 재료를 제품 route로 되살린다.
import { ok, type Result } from "../../../packages/base/mod.ts";
import {
  type AgentAtWorkspace,
  LOPHN_AGENT_ID,
  LOPHN_AGENT_HANDLE,
} from "../../../packages/protocol/lophn-agent/mod.ts";
import type { Core } from "../../support/core/mod.ts";
import type { Participant, RestoreContext, WorldIds } from "../types.ts";
import { restoreAgents } from "./agents.ts";
import { restoreApps } from "./apps.ts";
import {
  type Material,
  MATERIALS_ROOT,
  orderMaterials,
  verifyMaterial,
} from "./manifest.ts";
import { restoreProjects } from "./projects.ts";

export function restoreContext(core: Core): RestoreContext {
  return { core, world: { apps: {}, projects: {}, agents: {} } };
}

async function restoreOne(
  ctx: RestoreContext,
  material: Material,
): Promise<Result<void>> {
  switch (material.manifest.kind) {
    case "app":
      await restoreApps(ctx, material);
      return ok(undefined);
    case "project":
      await restoreProjects(ctx, material);
      return ok(undefined);
    case "agent":
      await restoreAgents(ctx, material);
      return ok(undefined);
  }
}

export async function restoreWorld(
  ctx: RestoreContext,
  refs: string[],
  root = MATERIALS_ROOT,
): Promise<Result<void>> {
  const ordered = await orderMaterials(root, refs);
  if (!ordered.ok) return ordered;
  // 하나라도 hash가 다르면 아무것도 되살리지 않는다.
  for (const material of ordered.value) {
    const verified = await verifyMaterial(material);
    if (!verified.ok) return verified;
  }
  for (const material of ordered.value) {
    const restored = await restoreOne(ctx, material);
    if (!restored.ok) return restored;
  }
  return ok(undefined);
}

// `Participant`를 이름으로 풀어 agent id와 workspace로 만든다. 못 풀면 던진다.
export function agentAtWorkspaceOf(
  world: WorldIds,
  participant: Participant,
): AgentAtWorkspace {
  const { agent, workspace } = participant;
  const found = <T>(id: T | undefined, key: string): T => {
    if (id === undefined) throw new Error(`cannot resolve ${key}`);
    return id;
  };
  const id =
    agent === LOPHN_AGENT_HANDLE
      ? LOPHN_AGENT_ID
      : found(world.agents[agent], `agent ${agent}`);
  if (workspace === undefined) return { agent: id, workspace: null };
  if ("app" in workspace) {
    const app = found(world.apps[workspace.app], `app ${workspace.app}`);
    return { agent: id, workspace: { kind: "app", id: app } };
  }
  const project = found(
    world.projects[workspace.project],
    `project ${workspace.project}`,
  );
  return { agent: id, workspace: { kind: "project", id: project } };
}
