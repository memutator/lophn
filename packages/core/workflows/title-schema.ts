import { err, ok, type Result } from "../../base/mod.ts";
import type { SchemaStep } from "../../protocol/server/mod.ts";
import {
  WORKFLOW_TITLE_AUTO_MAX,
  workflowTitleSchema,
} from "../../protocol/workflows/mod.ts";

// workflow_instances에 instance 자체 제목(title) 열을 더한다. 기존 행은 NULL로 남는다.
// 낸 step 목록의 맨 끝에 붙어야 해서(schema-steps.lock.json) WIRINGS 맨 뒤 wiring(project-commands)의 schemaStepsAfterTeams 끝에서 잇는다.
export const WORKFLOW_TITLE_SCHEMA_STEP: SchemaStep = {
  id: "workflows.instances-title",
  sql: "ALTER TABLE workflow_instances ADD COLUMN title TEXT;",
};

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const LINE_BREAK_RUN = /\s*(?:[\n\r]|\p{Zl}|\p{Zp})\s*/gu;

function firstGraphemes(text: string, max: number): string {
  let head = "";
  let count = 0;
  for (const { segment } of graphemes.segment(text)) {
    if (count === max) break;
    head += segment;
    count += 1;
  }
  return head;
}

function clipAutoTitle(raw: string): string | null {
  const flat = raw.replace(LINE_BREAK_RUN, " ").trim();
  const title = firstGraphemes(flat, WORKFLOW_TITLE_AUTO_MAX).trimEnd();
  return title === "" ? null : title;
}

/** 시작 입력(text)에서 첫 60자 자동 제목을 만든다. 비었으면 구조화 inputs의 첫 문자열 값으로 fallback한다. */
export function autoWorkflowTitle(
  text: string,
  inputs?: Readonly<Record<string, unknown>>,
): string | null {
  const fromText = clipAutoTitle(text);
  if (fromText !== null) return fromText;
  if (inputs !== undefined) {
    for (const value of Object.values(inputs)) {
      if (typeof value === "string") {
        const fromInput = clipAutoTitle(value);
        if (fromInput !== null) return fromInput;
      }
    }
  }
  return null;
}

/** 사람 rename 입력 검증: 앞뒤 공백을 뺀 1~120자. */
export function renameWorkflowTitle(raw: string): Result<string> {
  const title = raw.trim();
  if (!workflowTitleSchema.safeParse(title).success) {
    return err({
      code: "invalid_input",
      message:
        "a workflow instance title must be 1 to 120 characters and not blank",
    });
  }
  return ok(title);
}
