/**
 * apps/automations의 team-brief testing fixture다. mod.ts에서 내보내지 않는다.
 *
 * automation 선언이 있는 blueprint 원본과 정본 검증기의 판정만 만든다.
 * 시각·타이머·permit은 각 시험이 가짜로 주입한다.
 */
import { validateBlueprint } from "../../blueprint/mod.ts";
import type { Blueprint } from "../../blueprint/mod.ts";
import type { AutomationSpec } from "../clock.ts";

export function declaredCommand(
  key: string,
  effect: "read" | "write" | "external",
  extra: Record<string, unknown> = {},
) {
  return {
    key,
    label: key,
    description: `${key} purpose`,
    effect,
    confirm: false,
    input: null,
    revert: { supported: false },
    ...extra,
  };
}

// lookup(read)을 가진 blueprint 원본이다. commands로 다른 command 목록을 줄 수 있다.
export function automationBlueprint(
  tasks: readonly AutomationSpec[],
  commands: readonly Record<string, unknown>[] = [
    declaredCommand("lookup", "read"),
  ],
): Record<string, unknown> {
  return {
    name: "Usage",
    description: "Reads usage",
    screens: [{
      key: "usage",
      label: "Usage",
      path: "/usage",
      sizes: ["full"],
    }],
    commands,
    automatic_tasks: tasks.map((task) => ({
      key: task.key,
      label: task.key,
      when: task.when,
      command: task.command,
      ...(task.input === undefined ? {} : { input: task.input }),
    })),
    permissions: [],
    problem_codes: [],
    documents: [],
    agent_context: [],
    app_connections: [],
    sdk_dependencies: [],
  };
}

export function validationVerdict(raw: unknown): boolean {
  return validateBlueprint(raw).ok;
}

export function validBlueprint(raw: unknown): Blueprint {
  const parsed = validateBlueprint(raw);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}
