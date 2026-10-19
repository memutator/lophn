import { appCreate } from "../../../packages/protocol/apps/mod.ts";
import type { Id } from "../../../packages/protocol/base/mod.ts";
import type { SetupContext } from "../types.ts";
import { restoreAppProject } from "./apps.ts";
import { type Material, textOf } from "./manifest.ts";

// 앱 등록만 되살린다. 받는 Project Manager는 앱의 project라서 call.json의 `to.place.project`가 이 이름이다. source는 잇지 않고 call 본문은 deliverCall이 시나리오의 첫 단계에서 보낸다.
export async function restoreCall(
  ctx: SetupContext,
  material: Material,
): Promise<void> {
  const { slug, name, description } = JSON.parse(
    textOf(material, "app.json"),
  ) as { slug: string; name: string; description: string };
  const id = material.manifest.ids[name] as Id<"app">;
  const project = await restoreAppProject(ctx, slug);
  await ctx.core.call(appCreate, { id, slug, project, name, description });
  ctx.world.apps[name] = id;
}
