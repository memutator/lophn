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

// ref가 가리키는 place. Operator는 자기 정의에 place가 있어 여기서 알 수 없다(undefined).
export function placeOfAgentRef(ref: AgentRef): Place | null | undefined {
  switch (ref.role) {
    case "lophn":
      return null;
    case "project_manager":
      return { kind: "project", id: ref.project };
    case "app_engineer":
      return { kind: "app", id: ref.app };
    case "operator":
      return undefined;
  }
}

// session 표의 role과 정체성 열에서 ref를 만든다.
export function agentRefOfColumns(row: {
  role: Role;
  project: string | null;
  app: string | null;
  operator: string | null;
}): AgentRef {
  switch (row.role) {
    case "lophn":
      return { role: "lophn" };
    case "project_manager":
      return { role: "project_manager", project: row.project! as never };
    case "app_engineer":
      return { role: "app_engineer", app: row.app! as never };
    case "operator":
      return { role: "operator", agent: row.operator! as never };
  }
}

// 같은 agent인지 가르는 재료. column이 그 role의 정체성을 담는 session 표의 열이다.
export function agentIdentityOf(ref: AgentRef): {
  role: Role;
  column: "project" | "app" | "operator" | null;
  value: string | null;
} {
  switch (ref.role) {
    case "lophn":
      return { role: ref.role, column: null, value: null };
    case "project_manager":
      return { role: ref.role, column: "project", value: ref.project };
    case "app_engineer":
      return { role: ref.role, column: "app", value: ref.app };
    case "operator":
      return { role: ref.role, column: "operator", value: ref.agent };
  }
}

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
