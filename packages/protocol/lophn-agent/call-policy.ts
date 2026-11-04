import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { type AgentAtPlace, agentIdSchema, type Place } from "./places.ts";

// agent가 보내는 call을 어느 place 쌍과 agent 쌍으로 허용하는가. 사람이 보낸 call과 workflow step은 보지 않는다.
// 판정 순서: agent 쌍 예외 → place 쌍 덧쓰기 → 기본 표. 같은 쌍이 여럿이면 먼저 적힌 것이 이긴다.
// 기본 표: 같은 place, project·앱 → home, home → project·앱은 허용하고 다른 project나 다른 앱으로는 거절한다.
export const CALL_POLICY_SETTING_KEY = "lophn-agent.call_policy";

export const callPlaceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("home") }),
  z.strictObject({ kind: z.literal("project"), id: idSchema("prj") }),
  z.strictObject({ kind: z.literal("app"), id: idSchema("app") }),
]);
export type CallPlace = z.infer<typeof callPlaceSchema>;

export const callPolicySchema = z.strictObject({
  places: z.array(
    z.strictObject({
      from: callPlaceSchema,
      to: callPlaceSchema,
      allow: z.boolean(),
    }),
  ),
  agents: z.array(
    z.strictObject({
      from: agentIdSchema,
      to: agentIdSchema,
      allow: z.boolean(),
    }),
  ),
});
export type CallPolicy = z.infer<typeof callPolicySchema>;

export const DEFAULT_CALL_POLICY: CallPolicy = { places: [], agents: [] };

export function callPlaceOf(place: Place | null): CallPlace {
  return place === null ? { kind: "home" } : place;
}

function samePlace(a: CallPlace, b: CallPlace): boolean {
  return (
    a.kind === b.kind && (a.kind === "home" || a.id === (b as typeof a).id)
  );
}

function defaultAllows(from: CallPlace, to: CallPlace): boolean {
  return samePlace(from, to) || from.kind === "home" || to.kind === "home";
}

// 보내는 session(from)이 받는 agent와 place(to)로 call을 보내도 되는가.
export function mayCall(
  policy: CallPolicy,
  from: AgentAtPlace,
  to: AgentAtPlace,
): boolean {
  const byAgent = policy.agents.find(
    (rule) => rule.from === from.agent && rule.to === to.agent,
  );
  if (byAgent !== undefined) return byAgent.allow;
  const fromPlace = callPlaceOf(from.place);
  const toPlace = callPlaceOf(to.place);
  const byPlace = policy.places.find(
    (rule) => samePlace(rule.from, fromPlace) && samePlace(rule.to, toPlace),
  );
  return byPlace?.allow ?? defaultAllows(fromPlace, toPlace);
}
