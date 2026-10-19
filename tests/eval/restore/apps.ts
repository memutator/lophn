import { appCreate } from "../../../packages/protocol/apps/mod.ts";
import type { Id } from "../../../packages/protocol/base/mod.ts";
import type { SetupContext } from "../types.ts";
import { appProjectName, openAppProject } from "../../support/app/activate.ts";
import { type Material, textOf } from "./manifest.ts";

// 앱이 묶일 project를 먼저 등록하고 world에 이름으로 남긴다. Project Manager를 `place.project`로 가리키는 시나리오가 푼다.
export async function restoreAppProject(
  ctx: SetupContext,
  slug: string,
): Promise<Id<"prj">> {
  const project = await openAppProject(ctx.core, slug) as Id<"prj">;
  ctx.world.projects[appProjectName(slug)] = project;
  return project;
}

// source는 연결하지 않는다. project만으로 그 앱의 Project Manager가 생긴다.
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
    const project = await restoreAppProject(ctx, slug);
    await ctx.core.call(appCreate, { id, slug, project, name, description });
    ctx.world.apps[name] = id;
  }
}
