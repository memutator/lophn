import { z } from "zod";
import { idSchema } from "../base/ids.ts";

// 역할 식별자의 정본. preset·assignment contract는 이 enum만 소비한다.
export const AGENT_ROLES = [
  "lophn",
  "app_engineer",
  "context_engineer",
  "operator",
] as const;

export const agentRoleSchema = z.enum(AGENT_ROLES);

export type AgentRole = z.infer<typeof agentRoleSchema>;

const workPlaceBranches = [
  z.strictObject({ kind: z.literal("project"), id: idSchema("prj") }),
  z.strictObject({ kind: z.literal("app"), id: idSchema("app") }),
] as const;

const workPlaceOutputBranches = [
  z.object({ kind: z.literal("project"), id: idSchema("prj") }),
  z.object({ kind: z.literal("app"), id: idSchema("app") }),
] as const;

// 개설 자리. file cwd가 아니고, kind와 id 접두사 짝만 local syntax로 고정한다. Lophn Workspace에는
// session이 없으므로 전역 자리(global)가 없다.
export const workPlaceSchema = z.discriminatedUnion("kind", workPlaceBranches);

export const workPlaceOutputSchema = z.discriminatedUnion(
  "kind",
  workPlaceOutputBranches,
);

export type WorkPlace = z.infer<typeof workPlaceSchema>;

// apps/blueprint command key와 같은 local 모양. 존재·grant 판정은 runtime이다.
export const appCommandKeySchema = z.string().min(1).refine(
  (value) =>
    value.trim().length > 0 && !/\p{Cc}/u.test(value) && !value.includes("*"),
  { message: "command key cannot be blank, a wildcard, or contain controls" },
);

export const APP_COMMAND_EFFECTS = ["read", "write", "external"] as const;

export const appCommandEffectSchema = z.enum(APP_COMMAND_EFFECTS);

const agentAppScopeEntryFields = {
  app: idSchema("app"),
  commands: z.array(appCommandKeySchema).min(1),
  effects: z.array(appCommandEffectSchema).min(1),
  revert_required: z.boolean(),
  confirm_allowed: z.boolean(),
};

function uniqueList<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

// 현재 grant·역할 판정이 아니라 StartRun에 싣는 condition의 local shape.
export const agentAppScopeEntrySchema = z.strictObject(agentAppScopeEntryFields)
  .refine(
    (value) => uniqueList(value.commands) && uniqueList(value.effects),
    { message: "duplicate command or effect" },
  ).refine(
    (value) => !value.revert_required || value.effects.includes("write"),
    { message: "revert_required applies only when a write command is present" },
  );

export const agentAppScopeEntryOutputSchema = z.object(agentAppScopeEntryFields)
  .refine(
    (value) => uniqueList(value.commands) && uniqueList(value.effects),
    { message: "duplicate command or effect" },
  ).refine(
    (value) => !value.revert_required || value.effects.includes("write"),
    { message: "revert_required applies only when a write command is present" },
  );

const agentAppScopeFields = {
  role: agentRoleSchema,
  assignment: idSchema("asg"),
  apps: z.array(agentAppScopeEntrySchema),
};

const agentAppScopeOutputFields = {
  role: agentRoleSchema,
  assignment: idSchema("asg"),
  apps: z.array(agentAppScopeEntryOutputSchema),
};

function scopeShape(value: {
  role: AgentRole;
  apps: readonly {
    effects: readonly string[];
    revert_required: boolean;
    confirm_allowed: boolean;
  }[];
}): boolean {
  const apps = value.apps;
  if (value.role === "context_engineer" && apps.length !== 0) return false;
  if (value.role === "operator") {
    return apps.every((entry) =>
      entry.effects.length === 1 && entry.effects[0] === "read" &&
      entry.confirm_allowed === false && entry.revert_required === false
    );
  }
  if (value.role === "app_engineer") {
    return apps.every((entry) =>
      entry.effects.every((effect) => effect !== "external") &&
      (!entry.effects.includes("write") || entry.revert_required === true)
    );
  }
  return true;
}

// CE는 앱 command 실행이 없고, Operator는 confirm=false read만, AE write는 undo가 필요하다.
export const agentAppScopeSchema = z.strictObject(agentAppScopeFields).refine(
  (value) => uniqueList(value.apps.map((entry) => entry.app)),
  { message: "duplicate app" },
).refine(scopeShape, {
  message: "role scope shape is outside the local bound",
});

export const agentAppScopeOutputSchema = z.object(agentAppScopeOutputFields)
  .refine(
    (value) => uniqueList(value.apps.map((entry) => entry.app)),
    { message: "duplicate app" },
  ).refine(scopeShape, {
    message: "role scope shape is outside the local bound",
  });

export type AgentAppScope = z.infer<typeof agentAppScopeSchema>;
