// 테스트 fixture. 올바른 작성형은 Blueprint 타입을 유지한다.

import type {
  AutomationDeclaration,
  Blueprint,
  CommandDeclaration,
  CommandEffect,
  DocumentDeclaration,
  PermissionRequirement,
  ScreenDeclaration,
} from "../../contracts/apps/blueprint.ts";

export const APP = "app_01aryz6s41s4z4k7p41s4z4k7p";
export const OTHER = "app_01bryz6s41s4z4k7p41s4z4k7p";

const FORMAT = {
  name: "note",
  module_hash: "a".repeat(64),
  explicit: true,
};

export function command(
  key: string,
  effect: CommandEffect,
  extra: Partial<CommandDeclaration> = {},
): CommandDeclaration {
  return {
    key,
    label: key,
    description: `${key} purpose`,
    effect,
    confirm: false,
    input: null,
    revert: effect === "write"
      ? { supported: true, command: "undo" }
      : { supported: false },
    ...extra,
  };
}

export function screen(
  extra: Partial<ScreenDeclaration> = {},
): ScreenDeclaration {
  return {
    key: "home",
    label: "Home",
    path: "/home",
    sizes: ["full"],
    ...extra,
  };
}

export function blueprint(extra: Partial<Blueprint> = {}): Blueprint {
  return {
    name: "Calendar",
    description: "Keeps one calendar",
    screens: [],
    commands: [
      command("undo", "write", { revert: { supported: false } }),
      command("save", "write"),
    ],
    automatic_tasks: [],
    permissions: [],
    problem_codes: [],
    documents: [],
    agent_context: [],
    app_connections: [],
    sdk_dependencies: [],
    ...extra,
  };
}

export function secretPermission(): PermissionRequirement {
  return {
    kind: "secret.use",
    scope: { name: "google.calendar" },
    reason: "read the calendar token",
  };
}

export function document(key = "report"): DocumentDeclaration {
  return {
    key,
    name: "Report",
    description: "Saved report",
    format: FORMAT,
  };
}

export function automation(
  extra: Partial<AutomationDeclaration> = {},
): AutomationDeclaration {
  return {
    key: "sync",
    label: "Sync",
    when: { kind: "interval", interval_ms: 60000 },
    command: "lookup",
    ...extra,
  };
}
