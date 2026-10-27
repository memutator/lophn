import { operatorCreate } from "../../../packages/protocol/lophn-agent/mod.ts";
import type { Id } from "../../../packages/protocol/base/mod.ts";
import type { SetupContext } from "../types.ts";
import { type Material, textOf } from "./manifest.ts";

type Place = { project: string } | { app: string };

// model은 정의에 넣지 않는다.
export async function restoreOperators(
  ctx: SetupContext,
  material: Material,
): Promise<void> {
  const operators = JSON.parse(textOf(material, "operators.json")) as {
    place: Place;
    definition: { name: string; body: string };
  }[];
  for (const { place, definition } of operators) {
    const id = material.manifest.ids[definition.name] as Id<"agt">;
    await ctx.core.call(operatorCreate, {
      id,
      place:
        "app" in place
          ? { kind: "app", id: restored(ctx.world.apps, place.app) }
          : {
              kind: "project",
              id: restored(ctx.world.projects, place.project),
            },
      definition,
    });
    ctx.world.operators[definition.name] = id;
  }
}

function restored<T>(table: Record<string, T>, name: string): T {
  const id = table[name];
  if (id === undefined) throw new Error(`operator place ${name} not restored`);
  return id;
}
