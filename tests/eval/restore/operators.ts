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
    place: { kind: "app" | "project"; name: string };
    definition: { name: string; body: string; contexts?: string[] };
  }[];
  for (const { place, definition } of operators) {
    const placeId = place.kind === "app"
      ? ctx.world.apps[place.name]
      : ctx.world.projects[place.name];
    if (placeId === undefined) {
      throw new Error(
        `operator place ${place.kind} ${place.name} not restored`,
      );
    }
    const id = material.manifest.ids[definition.name] as Id<"agt">;
    const { contexts, ...rest } = definition;
    await ctx.core.call(operatorCreate, {
      id,
      place: place.kind === "app"
        ? { kind: "app", id: placeId }
        : { kind: "project", id: placeId },
      definition: {
        ...rest,
        ...(contexts === undefined
          ? {}
          : { contexts: contexts.map((name) => resolveContext(ctx, name)) }),
      },
    });
    ctx.world.operators[definition.name] = id;
  }
}

function resolveContext(ctx: SetupContext, name: string): string {
  const id = ctx.world.contexts[name];
  if (id === undefined) {
    throw new Error(`operator context ${name} not restored`);
  }
  return id;
}
