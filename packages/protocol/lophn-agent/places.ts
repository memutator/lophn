import { z } from "zod";
import { idSchema } from "../base/ids.ts";

// agent가 어디에 놓이는가. role은 열 때 정해지고 바뀌지 않는다.
export const ROLES = [
  "lophn",
  "project_manager",
  "operator",
] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const placeSchema = z.strictObject({
  kind: z.literal("project"),
  id: idSchema("prj"),
});
export const placeOutputSchema = z.object({
  kind: z.literal("project"),
  id: idSchema("prj"),
});
export type Place = z.infer<typeof placeSchema>;

// role마다 놓일 수 있는 place 종류. lophn은 place가 없다.
const ROLE_PLACES: Record<Role, readonly Place["kind"][]> = {
  lophn: [],
  project_manager: ["project"],
  operator: ["project"],
};

// session을 열 때와 정의를 만들 때 같은 표를 쓴다.
export function rolePlaceFits(role: Role, place: Place | null): boolean {
  if (place === null) return role === "lophn";
  return ROLE_PLACES[role].includes(place.kind);
}

// 받을 agent를 가리키는 값. Project Manager는 place가 곧 정체성이고 Operator는 자기 ID다.
export const agentRefSchema = z.discriminatedUnion("role", [
  z.strictObject({ role: z.literal("lophn") }),
  z.strictObject({
    role: z.literal("project_manager"),
    project: idSchema("prj"),
  }),
  z.strictObject({ role: z.literal("operator"), agent: idSchema("agt") }),
]);
export const agentRefOutputSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("lophn") }),
  z.object({ role: z.literal("project_manager"), project: idSchema("prj") }),
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
    case "operator":
      return undefined;
  }
}

// session 표의 role과 정체성 열에서 ref를 만든다.
export function agentRefOfColumns(row: {
  role: Role;
  project: string | null;
  operator: string | null;
}): AgentRef {
  switch (row.role) {
    case "lophn":
      return { role: "lophn" };
    case "project_manager":
      return { role: "project_manager", project: row.project! as never };
    case "operator":
      return { role: "operator", agent: row.operator! as never };
  }
}

// 같은 agent인지 가르는 재료. column이 그 role의 정체성을 담는 session 표의 열이다.
export function agentIdentityOf(ref: AgentRef): {
  role: Role;
  column: "project" | "operator" | null;
  value: string | null;
} {
  switch (ref.role) {
    case "lophn":
      return { role: ref.role, column: null, value: null };
    case "project_manager":
      return { role: ref.role, column: "project", value: ref.project };
    case "operator":
      return { role: ref.role, column: "operator", value: ref.agent };
  }
}
