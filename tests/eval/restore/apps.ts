import { appCreate } from "../../../packages/protocol/apps/mod.ts";
import type { Id } from "../../../packages/protocol/base/mod.ts";
import type { SetupContext } from "../types.ts";
import { appProjectName, openAppProject } from "../../support/app/activate.ts";
import { type Material, textOf } from "./manifest.ts";

// 앱은 project에 묶이지 않는다. 앱 옆에 사람이 둔 보통 project를 `<slug>-project` 이름으로 등록하고 world에 남긴다. 다른 시나리오가 이 이름으로 그 Project Manager를 가리킨다.
export async function restoreAppProject(
  ctx: SetupContext,
  slug: string,
): Promise<Id<"prj">> {
  const project = await openAppProject(ctx.core, slug) as Id<"prj">;
  ctx.world.projects[appProjectName(slug)] = project;
  return project;
}

// source는 연결하지 않는다.
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
    await ctx.core.call(appCreate, { id, slug, name, description });
    ctx.world.apps[name] = id;
  }
}
