// trial마다 새 data root에 재료를 제품 route로 되살린다.
import { ok, type Result } from "../../../packages/base/mod.ts";
import type { AgentRef } from "../../../packages/protocol/lophn-agent/mod.ts";
import type { Core } from "../../support/core/mod.ts";
import type { Participant, RestoreContext, WorldIds } from "../types.ts";
import { restoreApps } from "./apps.ts";
import { restoreKinds } from "./kinds.ts";
import {
  type Material,
  MATERIALS_ROOT,
  orderMaterials,
  verifyMaterial,
} from "./manifest.ts";
import { restoreOperators } from "./operators.ts";
import { restoreProjects } from "./projects.ts";

export function restoreContext(core: Core): RestoreContext {
  return { core, world: { apps: {}, projects: {}, operators: {} } };
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
    case "kinds":
      return await restoreKinds(ctx, material);
    case "operator":
      await restoreOperators(ctx, material);
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

// `Participant`를 이름으로 풀어 `AgentRef`로 만든다. 못 풀면 던진다.
export function agentRefOf(
  world: WorldIds,
  participant: Participant,
): AgentRef {
  const { role, place, name } = participant;
  const found = <T>(id: T | undefined, key: string | undefined): T => {
    if (id === undefined) throw new Error(`cannot resolve ${role} ${key}`);
    return id;
  };
  switch (role) {
    case "lophn":
      return { role };
    case "project_manager": {
      const project =
        place !== undefined && "project" in place ? place.project : undefined;
      return { role, project: found(world.projects[project ?? ""], project) };
    }
    case "app_engineer": {
      const app = place !== undefined && "app" in place ? place.app : undefined;
      return { role, app: found(world.apps[app ?? ""], app) };
    }
    case "operator":
      return { role, agent: found(world.operators[name ?? ""], name) };
  }
}
