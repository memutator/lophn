import { appCreate } from "../../../packages/protocol/apps/mod.ts";
import type { Id } from "../../../packages/protocol/base/mod.ts";
import type { SetupContext } from "../types.ts";
import { openAppProject } from "../../support/app/activate.ts";
import { type Material, textOf } from "./manifest.ts";

// source는 연결하지 않는다. 등록만으로 그 앱의 App Engineer가 생긴다.
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
    const project = await openAppProject(ctx.core, slug);
    await ctx.core.call(appCreate, { id, slug, project, name, description });
    ctx.world.apps[name] = id;
  }
}
