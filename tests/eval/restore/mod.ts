// trial마다 새 data root에 재료를 제품 route로 되살린다. 되살리는 동안만 fake provider를 전역 기본 model로 붙이고,
// 끝나면 떼어 root에 model이 어디에도 없게 한다(진짜 model은 ev-provider가 붙인다).
import { ok, type Result } from "../../../packages/base/mod.ts";
import {
  type AgentRef,
  modelDefaultChange,
} from "../../../packages/protocol/lophn-agent/mod.ts";
import type { Core } from "../../support/core/mod.ts";
import { connectFakeProvider } from "../../support/core/human.ts";
import { startFakeServer } from "../../support/fake-server/mod.ts";
import type { Participant, SetupContext, WorldIds } from "../types.ts";
import { restoreApps } from "./apps.ts";
import { restoreContext } from "./context.ts";
import {
  type Material,
  MATERIALS_ROOT,
  orderMaterials,
  verifyMaterial,
} from "./manifest.ts";
import { restoreOperators } from "./operators.ts";
import { restoreProjects } from "./projects.ts";

export async function beginRestore(core: Core): Promise<SetupContext> {
  const fake = await startFakeServer();
  await connectFakeProvider(core, fake);
  return {
    core,
    fake,
    world: { apps: {}, projects: {}, folders: {}, contexts: {}, operators: {} },
  };
}

async function restoreOne(
  ctx: SetupContext,
  material: Material,
): Promise<Result<void>> {
  switch (material.manifest.kind) {
    case "app":
      await restoreApps(ctx, material);
      return ok(undefined);
    case "project":
      await restoreProjects(ctx, material);
      return ok(undefined);
    case "context":
      return await restoreContext(ctx, material);
    case "operator":
      await restoreOperators(ctx, material);
      return ok(undefined);
  }
}

export async function restoreWorld(
  ctx: SetupContext,
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

export async function endRestore(ctx: SetupContext): Promise<void> {
  await ctx.core.call(modelDefaultChange, { default: null });
  await ctx.fake.close();
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
      const project = place !== undefined && "project" in place
        ? place.project
        : undefined;
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
