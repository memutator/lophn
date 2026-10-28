import { z } from "zod";
import { idSchema } from "../base/ids.ts";

export const placeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("project"), id: idSchema("prj") }),
  z.strictObject({ kind: z.literal("app"), id: idSchema("app") }),
]);
export const placeOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), id: idSchema("prj") }),
  z.object({ kind: z.literal("app"), id: idSchema("app") }),
]);
export type Place = z.infer<typeof placeSchema>;

// ---------- agent id와 place 종류 ----------

// lophn은 고정 id의 내장 정의다. id는 정의 file 이름(`<data>/agents/lophn.md`)과 같다.
export const LOPHN_AGENT_ID = "lophn";
export const agentIdSchema = z.union([
  z.literal(LOPHN_AGENT_ID),
  idSchema("agt"),
]);
export type AgentId = z.infer<typeof agentIdSchema>;

// session이 있는 자리의 종류다. place가 없으면 home이다.
export const PLACE_KINDS = ["home", "project", "app"] as const;
export const placeKindSchema = z.enum(PLACE_KINDS);
export type PlaceKind = z.infer<typeof placeKindSchema>;

export function placeKindOf(place: Place | null): PlaceKind {
  return place === null ? "home" : place.kind;
}

// session의 정체, job을 만든 쪽, run의 agent 대상, call의 새 session 대상이다.
export const agentAtPlaceSchema = z.strictObject({
  agent: agentIdSchema,
  place: placeSchema.nullable(),
});
export const agentAtPlaceOutputSchema = z.object({
  agent: agentIdSchema,
  place: placeOutputSchema.nullable(),
});
export type AgentAtPlace = z.infer<typeof agentAtPlaceSchema>;

// 이름으로 가리키는 받는 쪽이다. place가 없으면 home이다(workflow 참가자만 instance의 project다).
export const placeNameSchema = z.union([
  z.strictObject({ project: z.string().min(1) }),
  z.strictObject({ app: z.string().min(1) }),
]);
export const agentAddressSchema = z.strictObject({
  agent: z.string().min(1),
  place: placeNameSchema.optional(),
});
export type AgentAddress = z.infer<typeof agentAddressSchema>;
