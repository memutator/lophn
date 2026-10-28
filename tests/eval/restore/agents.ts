import { agentCreate } from "../../../packages/protocol/lophn-agent/mod.ts";
import type { Id } from "../../../packages/protocol/base/mod.ts";
import type { RestoreContext } from "../types.ts";
import { type Material, textOf } from "./manifest.ts";

// 정의는 전역이라 place가 없다. model은 정의에 넣지 않는다.
export async function restoreAgents(
  ctx: RestoreContext,
  material: Material,
): Promise<void> {
  const agents = JSON.parse(textOf(material, "agents.json")) as {
    definition: { name: string; body: string };
  }[];
  for (const { definition } of agents) {
    const id = material.manifest.ids[definition.name] as Id<"agt">;
    await ctx.core.call(agentCreate, { id, definition });
    ctx.world.agents[definition.name] = id;
  }
}
