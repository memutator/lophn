import { parse, stringify } from "yaml";
import type { z } from "zod";
import { err, ok } from "../../../base/mod.ts";
import type { LophnError, Result } from "../../../base/mod.ts";
import {
  AGENT_BODY_MAX_BYTES,
  type AgentDefinitionIssue,
  type BuiltinDefinition,
  builtinDefinitionSchema,
  type OperatorDefinition,
  operatorDefinitionSchema,
  type Place,
  type Role,
} from "../../../protocol/lophn-agent/mod.ts";
import type { AgentRoleTable } from "./role-table.ts";

// 정의 파일의 Markdown 읽기·쓰기다. 순수 함수이고 파일 IO도 hash도 없다.
//
// 파일 모양:
// - 첫 줄이 `---`이면 그 다음 `---` 줄까지가 frontmatter(YAML map)이고 나머지가 본문이다. 닫는 줄이 없거나
//   YAML이 깨졌거나 map이 아니면 `frontmatter`가 `malformed`다. 첫 줄이 `---`가 아니면 파일 전체가 본문이다.
// - 본문은 앞쪽 빈 줄과 뒤쪽 공백을 뺀 글이다. 쓸 때는 끝에 줄바꿈 하나를 붙인다. 본문 안의 `---` 줄은 본문이다.
// - 쓸 때는 있는 칸만 쓴다. 비운 칸과 빈 목록은 쓰지 않고, 칸이 하나도 없으면 frontmatter 줄 없이 본문만 쓴다.
//   칸 순서는 입력 순서와 상관없이 고정이다.
// - 쓴 글을 다시 읽으면 처음 값이 나온다. 숫자·불리언처럼 보이는 문자열도 문자열로 돌아온다.
//
// 검사는 읽을 때와 쓸 때 같다: 모양 전체를 한 번에 보고 틀린 칸을 모두 `issues`에 담는다. 하나라도 틀리면
// 값도 글도 돌려주지 않는다. 칸 경로는 점 표기(`skills_off.1`)이고 모르는 칸은 부모 경로 뒤에 그 이름을 붙인다.
// 같은 place Operator 사이의 이름 중복은 파일만으로 알 수 없으므로
// 여기서 보지 않는다.

type AgentFileTarget = { role: Role; place: Place["kind"] | null };
export type AgentFileDefinition = OperatorDefinition | BuiltinDefinition;

type AgentFileError = LophnError & {
  code: "invalid_input";
  details: { issues: AgentDefinitionIssue[] };
};

type FileResult<T> = Result<T, AgentFileError>;
type Plain = Record<string, unknown>;

const FENCE = "---";

// core schema는 날짜·binary 같은 확장 tag를 해석하지 않아 `2020-01-01`도 문자열로 돌아온다.
// lineWidth 0은 긴 문자열을 접지 않고, aliasDuplicateObjects false는 같은 값을 alias로 줄이지 않는다.
const PARSE_OPTIONS = { schema: "core" } as const;
const STRINGIFY_OPTIONS = {
  schema: "core",
  lineWidth: 0,
  aliasDuplicateObjects: false,
} as const;

function refuse(issues: AgentDefinitionIssue[]): FileResult<never> {
  return err({
    code: "invalid_input",
    message: "agent file is invalid",
    details: { issues },
  });
}

function addIssue(
  issues: AgentDefinitionIssue[],
  field: string,
  code: AgentDefinitionIssue["code"],
) {
  if (!issues.some((i) => i.field === field && i.code === code)) {
    issues.push({ field, code });
  }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function normalizeBody(body: string): string {
  return body.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();
}

// ---- 읽기: 파일을 frontmatter 값과 본문으로 가른다 ----

type Split = { frontmatter: Plain; body: string };

function splitFile(text: string): FileResult<Split> {
  const lines = text.split("\n");
  const isFence = (line: string) => line.replace(/\r$/, "") === FENCE;
  if (!isFence(lines[0])) return ok({ frontmatter: {}, body: text });
  const close = lines.findIndex((line, i) => i > 0 && isFence(line));
  if (close === -1) {
    return refuse([{ field: "frontmatter", code: "malformed" }]);
  }
  const source = lines.slice(1, close).join("\n");
  const body = lines.slice(close + 1).join("\n");
  if (source.trim() === "") return ok({ frontmatter: {}, body });
  let value: unknown;
  try {
    value = parse(source, PARSE_OPTIONS);
  } catch {
    return refuse([{ field: "frontmatter", code: "malformed" }]);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return refuse([{ field: "frontmatter", code: "malformed" }]);
  }
  return ok({ frontmatter: value as Plain, body });
}

// ---- 검사: 읽을 때와 쓸 때 같다 ----

function pathOf(path: PropertyKey[]): string {
  return path.map(String).join(".");
}

// zod가 알리는 이유를 code로 옮긴다. 값은 오류에 싣지 않는다.
function schemaIssues(error: z.ZodError): AgentDefinitionIssue[] {
  const found: AgentDefinitionIssue[] = [];
  for (const issue of error.issues) {
    const parent = pathOf(issue.path);
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        const field = parent === "" ? key : `${parent}.${key}`;
        addIssue(found, field, "unknown_field");
      }
    } else if (issue.code === "invalid_key") {
      addIssue(found, parent, "unknown_field");
    } else if (
      issue.code === "custom" &&
      issue.message.startsWith("duplicate")
    ) {
      addIssue(found, parent, "duplicate");
    } else if (
      issue.code === "custom" &&
      issue.message.includes("body is over")
    ) {
      addIssue(found, "body", "too_large");
    } else {
      addIssue(found, parent, "invalid_value");
    }
  }
  return found;
}

function checkDefinition(
  raw: Plain,
  body: unknown,
  target: AgentFileTarget,
  roles: AgentRoleTable,
): FileResult<AgentFileDefinition> {
  const issues: AgentDefinitionIssue[] = [];
  const operator = roles.isOperator(target.role);
  if (typeof body !== "string") {
    return refuse([{ field: "body", code: "invalid_value" }]);
  }
  const text = normalizeBody(body);
  if (utf8Bytes(text) > AGENT_BODY_MAX_BYTES) {
    addIssue(issues, "body", "too_large");
  }
  if (operator && text.trim() === "") addIssue(issues, "body", "required");

  const name = raw.name;
  const nameMissing =
    operator &&
    (name === undefined || (typeof name === "string" && name.trim() === ""));
  const schema = operator ? operatorDefinitionSchema : builtinDefinitionSchema;
  const shaped = schema.safeParse({ ...raw, body: text });
  if (!shaped.success) {
    for (const issue of schemaIssues(shaped.error)) {
      const top = issue.field.split(".")[0];
      if (top === "body" || (nameMissing && top === "name")) continue;
      addIssue(issues, issue.field, issue.code);
    }
  }
  if (nameMissing) {
    addIssue(issues, "name", "required");
  } else if (
    operator &&
    typeof name === "string" &&
    roles.isReservedName(name)
  ) {
    addIssue(issues, "name", "reserved_name");
  }
  if (issues.length > 0 || !shaped.success) return refuse(issues);
  return ok(shaped.data);
}

// ---- 쓰기: 고정한 칸 순서로 있는 칸만 만든다 ----

const EMPTY_DEFAULT_LISTS = [
  "skills",
  "domains",
  "mcp_off",
  "mcp_servers",
] as const;

function pick(source: Plain, keys: readonly string[]): Plain {
  const out: Plain = {};
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

function orderedModel(model: Plain): Plain {
  const options = model.option_values as Plain;
  const sorted: Plain = {};
  for (const key of Object.keys(options).sort()) sorted[key] = options[key];
  return { ...pick(model, ["provider", "model_name"]), option_values: sorted };
}

function orderedFrontmatter(value: Plain): Plain {
  const out: Plain = {};
  if (value.name !== undefined) out.name = value.name;
  if (value.profile !== undefined) {
    out.profile = pick(value.profile as Plain, ["kind", "icon", "image"]);
  }
  if (value.model !== undefined) {
    out.model = orderedModel(value.model as Plain);
  }
  for (const key of EMPTY_DEFAULT_LISTS) {
    const list = value[key] as Plain[] | undefined;
    if (list === undefined || list.length === 0) continue;
    out[key] =
      key === "mcp_off"
        ? list.map((item) => pick(item, ["server_name", "original_tool"]))
        : list;
  }
  if (value.skip !== undefined) out.skip = value.skip;
  return out;
}

function frontmatterText(fields: Plain): string {
  if (Object.keys(fields).length === 0) return "";
  return `${FENCE}\n${stringify(fields, STRINGIFY_OPTIONS)}${FENCE}\n`;
}

export function parseAgentFile(
  text: string,
  target: AgentFileTarget,
  roles: AgentRoleTable,
): Result<AgentFileDefinition, AgentFileError> {
  const split = splitFile(text);
  if (!split.ok) return split;
  return checkDefinition(
    split.value.frontmatter,
    split.value.body,
    target,
    roles,
  );
}

export function serializeAgentFile(
  definition: AgentFileDefinition,
  target: AgentFileTarget,
  roles: AgentRoleTable,
): Result<string, AgentFileError> {
  const { body, ...fields } = definition as Plain;
  const checked = checkDefinition(fields, body, target, roles);
  if (!checked.ok) return checked;
  const { body: text, ...kept } = checked.value as Plain;
  const head = frontmatterText(orderedFrontmatter(kept));
  if (text === "") return ok(head);
  const rendered = `${text}\n`;
  return ok(head === "" ? rendered : `${head}\n${rendered}`);
}
