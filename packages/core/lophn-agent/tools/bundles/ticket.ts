import type { ToolDefinition } from "../registry.ts";

// 껍데기다. agent-tools-work task가 채운다.
export const TICKET_TOOLS: readonly ToolDefinition[] = [];

type Condition = { kind: string; problem?: string };

// 옛 roles/app-engineer/ticket.ts가 아직 읽는다. 그 file이 바뀌면 지운다.
// 실행 준비에 모자란 것이다. 모자라면 ticket을 버리지 않고 확인 필요로 남긴다.
export function missingForReady(input: {
  kind: "implementation" | "repair";
  problems: readonly string[];
  references: readonly unknown[];
  adoption_questions: readonly unknown[];
  conditions: readonly Condition[];
}): string[] {
  const missing: string[] = [];
  if (input.references.length === 0) {
    missing.push("fixed design evidence is missing");
  }
  if (input.adoption_questions.length === 0) {
    missing.push("an adopted decision question is missing");
  }
  const kinds = new Set(input.conditions.map((condition) => condition.kind));
  if (!kinds.has("app_test") || !kinds.has("test_command")) {
    missing.push("an executable acceptance check is missing");
  }
  if (input.kind === "repair") {
    if (!kinds.has("problems_closed")) {
      missing.push("the problems_closed check is missing");
    }
    for (const problem of input.problems) {
      const covered = input.conditions.some((condition) =>
        condition.problem === problem &&
        (condition.kind === "reproduction_test" ||
          condition.kind === "human_confirmation")
      );
      if (!covered) {
        missing.push(`no reproduction or human confirmation for ${problem}`);
      }
    }
  }
  return missing;
}
