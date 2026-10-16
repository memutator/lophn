import { z } from "zod";
import { idSchema } from "../base/ids.ts";

// agent가 어디에 놓이는가. role은 열 때 정해지고 바뀌지 않는다.
export const ROLES = [
  "lophn",
  "project_manager",
  "app_engineer",
  "operator",
] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const placeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("project"), id: idSchema("prj") }),
  z.strictObject({ kind: z.literal("app"), id: idSchema("app") }),
]);
export const placeOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), id: idSchema("prj") }),
  z.object({ kind: z.literal("app"), id: idSchema("app") }),
]);
export type Place = z.infer<typeof placeSchema>;

// role마다 놓일 수 있는 place 종류. lophn은 place가 없다.
const ROLE_PLACES: Record<Role, readonly Place["kind"][]> = {
  lophn: [],
  project_manager: ["project"],
  app_engineer: ["app"],
  operator: ["project", "app"],
};

// session을 열 때와 정의를 만들 때 같은 표를 쓴다.
export function rolePlaceFits(role: Role, place: Place | null): boolean {
  if (place === null) return role === "lophn";
  return ROLE_PLACES[role].includes(place.kind);
}

// 받을 agent를 가리키는 값. Project Manager와 App Engineer는 place가 곧 정체성이고 Operator는 자기 ID다.
export const agentRefSchema = z.discriminatedUnion("role", [
  z.strictObject({ role: z.literal("lophn") }),
  z.strictObject({
    role: z.literal("project_manager"),
    project: idSchema("prj"),
  }),
  z.strictObject({ role: z.literal("app_engineer"), app: idSchema("app") }),
  z.strictObject({ role: z.literal("operator"), agent: idSchema("agt") }),
]);
export const agentRefOutputSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("lophn") }),
  z.object({ role: z.literal("project_manager"), project: idSchema("prj") }),
  z.object({ role: z.literal("app_engineer"), app: idSchema("app") }),
  z.object({ role: z.literal("operator"), agent: idSchema("agt") }),
]);
export type AgentRef = z.infer<typeof agentRefSchema>;
