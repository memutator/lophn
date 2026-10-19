import { operatorCreate } from "../../../packages/protocol/lophn-agent/mod.ts";
import type { Id } from "../../../packages/protocol/base/mod.ts";
import type { SetupContext } from "../types.ts";
import { type Material, textOf } from "./manifest.ts";

// model은 정의에 넣지 않는다.
export async function restoreOperators(
  ctx: SetupContext,
  material: Material,
): Promise<void> {
  const operators = JSON.parse(textOf(material, "operators.json")) as {
    place: { project: string };
    definition: { name: string; body: string };
  }[];
  for (const { place, definition } of operators) {
    const project = ctx.world.projects[place.project];
    if (project === undefined) {
      throw new Error(`operator project ${place.project} not restored`);
    }
    const id = material.manifest.ids[definition.name] as Id<"agt">;
    await ctx.core.call(operatorCreate, {
      id,
      place: { kind: "project", id: project },
      definition,
    });
    ctx.world.operators[definition.name] = id;
  }
}
