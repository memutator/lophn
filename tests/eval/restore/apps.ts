import { appCreate } from "../../../packages/protocol/apps/mod.ts";
import type { Id } from "../../../packages/protocol/base/mod.ts";
import { runtimePids } from "../../support/core/process.ts";
import { settle } from "../../support/core/human.ts";
import type { SetupContext } from "../types.ts";
import { appProjectName, openAppProject } from "../../support/app/activate.ts";
import { type Material, textOf } from "./manifest.ts";

// 앱은 project에 묶이지 않는다. 앱마다 옆에 사람이 둔 보통 project를 `<slug>-project` 이름으로 등록하고 world에 남긴다. 지금 시나리오는 이 이름을 쓰지 않지만, 지우면 lophn이 보는 project 목록이 달라져 앞선 run과 버전 표시 없이 비교가 깨지므로 world를 그대로 둔다.
export async function restoreAppProject(
  ctx: SetupContext,
  slug: string,
): Promise<Id<"prj">> {
  const project = await openAppProject(ctx.core, slug) as Id<"prj">;
  ctx.world.projects[appProjectName(slug)] = project;
  return project;
}

// `app.create`가 template source를 깔고 앱에 잇는다. 재료는 그 source를 쓰지 않는다.
export async function restoreApps(
  ctx: SetupContext,
  material: Material,
): Promise<void> {
  const apps = JSON.parse(textOf(material, "apps.json")) as {
    slug: string;
    name: string;
    description: string;
  }[];
  for (const { slug, name, description } of apps) {
    const id = material.manifest.ids[name] as Id<"app">;
    await restoreAppProject(ctx, slug);
    // 이 재료만 쓰는 시나리오는 곧 진짜 model turn을 연다. core가 source를 잇고 agent runtime child를 다시 띄우므로 새 child가 ready가 될 때까지 기다린다.
    const before = await runtimePids(ctx.core.run.home);
    await ctx.core.call(appCreate, { id, slug, name, description });
    if (before.length > 0) await settle(ctx.core, before);
    ctx.world.apps[name] = id;
  }
}
