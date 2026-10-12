import { z } from "zod";
import type { SkillEntry } from "../extensions/mod.ts";
import {
  readSkill,
  readSkillSupplemental,
  type SkillReadResult,
} from "../extensions/mod.ts";
import type { SkillFilesPort } from "../extensions/mod.ts";
import type { ToolResult } from "../../../protocol/lophn-agent/mod.ts";
import type { RunCredential } from "./work.ts";
import type { ToolDefinition } from "./registry.ts";

// 선택 skill 읽기 tool 정의다(concern lophn-agent/extensions, architecture
// §5.3 선택 skill). 입력은 선택 이름·보조 title뿐이고 경로 입력은 없다.
// 효과는 read다: tool·권한·연결을 더하지 않는다.

export const SKILL_READ_TOOL = "skill.read";
export const SKILL_READ_SUPPLEMENTAL_TOOL = "skill.read_supplemental";

export const SKILL_TOOL_REVISION = "2026-10-01";

// skill 이름은 discovery의 `[a-z0-9]+(-[a-z0-9]+)*` 1~64자다.
const skillNameSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(64);

const nameInput = z.strictObject({ name: skillNameSchema });

const supplementalInput = z.strictObject({
  name: skillNameSchema,
  title: z.string().min(1).max(128),
});

export type SkillToolDeps = {
  port: SkillFilesPort;
  // 이번 run의 발견 목록이다. run 경계에 고정한다.
  entries: readonly SkillEntry[];
  // RunBasis에 고정한 이름→hash map이다. 없는 이름은 고정이 아니다.
  pinned: ReadonlyMap<string, string>;
  max_file_bytes: number;
};

// skill.read 정의다(architecture §5.3 선택 skill). 목록과 실행이 같은
// schema·효과·실패 종류를 쓴다.
export const skillReadTool: ToolDefinition = {
  name: SKILL_READ_TOOL,
  description: "Read the full body of a selected skill for this run.",
  revision: SKILL_TOOL_REVISION,
  input: nameInput,
  effect: "read",
  confirm: false,
  contract: "ReadSkill",
  scopeCheck: "selected skills of the run",
  reversible: true,
  idempotent: true,
  errors: [
    "invalid_input",
    "not_found",
    "forbidden",
    "conflict",
    "unavailable",
  ],
  origin: "builtin",
};

// skill.read_supplemental 정의다(architecture §5.3 선택 skill). title만
// 고르고 경로 입력은 없다.
export const skillReadSupplementalTool: ToolDefinition = {
  name: SKILL_READ_SUPPLEMENTAL_TOOL,
  description:
    "Read one supplemental UTF-8 document of a selected skill by its title.",
  revision: SKILL_TOOL_REVISION,
  input: supplementalInput,
  effect: "read",
  confirm: false,
  contract: "ReadSkillSupplemental",
  scopeCheck: "selected skills of the run",
  reversible: true,
  idempotent: true,
  errors: [
    "invalid_input",
    "not_found",
    "forbidden",
    "conflict",
    "unavailable",
  ],
  origin: "builtin",
};

export const SKILL_TOOLS: readonly ToolDefinition[] = [
  skillReadTool,
  skillReadSupplementalTool,
];

// 실행 handler다. 실패는 안전한 결과로 포장한다(architecture §5.5): body null,
// code는 사람용 한 줄 요약에 절대 경로가 없다. 실행 파일을 부르지
// 않는다.
export async function runSkillRead(
  deps: SkillToolDeps,
  input: { name: string },
  _credential: RunCredential,
): Promise<ToolResult> {
  const produced = await readSkill({
    port: deps.port,
    entries: deps.entries,
    name: input.name,
    pinned_hash: deps.pinned.get(input.name) ?? null,
    max_file_bytes: deps.max_file_bytes,
  });
  if (!produced.ok) return failureResult("skill read failed");
  return wrapSkillResult(produced.value);
}

export async function runSkillReadSupplemental(
  deps: SkillToolDeps,
  input: { name: string; title: string },
  _credential: RunCredential,
): Promise<ToolResult> {
  const entry = deps.entries.find((cand) => cand.name === input.name);
  if (entry === undefined) {
    return failureResult(
      "skill is not in the run list",
    );
  }
  const produced = await readSkillSupplemental({
    port: deps.port,
    entry,
    title: input.title,
    max_file_bytes: deps.max_file_bytes,
  });
  if (!produced.ok) return failureResult("skill read failed");
  return wrapSkillResult(produced.value);
}

// 읽기 실패를 tool result로 포장한다(architecture §5.5): 실패면 body null이고
// 요약은 code뿐이다. 절대 경로는 결과에 나가지 않는다.
function wrapSkillResult(result: SkillReadResult): ToolResult {
  if (result.error !== null) {
    return failureResult(skillSummary(result.error.code));
  }
  return {
    status: "success",
    summary: `${result.name} read`,
    content: {
      name: result.name,
      body: result.body,
      supplemental_titles: [...result.supplemental_titles],
    },
    complete: true,
    source: null,
    continuation: null,
    pending: [],
  };
}

function skillSummary(code: string): string {
  switch (code) {
    case "not_selected":
      return "skill is not selected for this run";
    case "missing":
      return "skill is not available";
    case "changed":
      return "skill changed after the run fixed its content";
    case "invalid_path":
      return "skill path is outside the skill folder";
    case "invalid_format":
      return "skill document is not in the expected format";
    default:
      return "skill read failed";
  }
}

function failureResult(summary: string): ToolResult {
  return {
    status: "failure",
    summary,
    content: null,
    complete: true,
    source: null,
    continuation: null,
    pending: [],
  };
}
