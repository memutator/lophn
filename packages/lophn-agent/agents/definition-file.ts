import { parse, stringify } from "@std/yaml";
import type { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import type { LophnError, Result } from "../../base/mod.ts";
import {
  AGENT_BODY_MAX_BYTES,
  agentFrontmatterSchema,
  agentSettingsSchema,
  isBuiltinAgentName,
} from "../../protocol/lophn-agent/mod.ts";
import type {
  AgentDefinition,
  AgentFrontmatter,
  AgentIssue,
  AgentPlaceKind,
  AgentRole,
  AgentSettings,
} from "../../protocol/lophn-agent/mod.ts";

// 정의 파일과 자리 설정 파일의 Markdown 읽기·쓰기다(agent-I1). 순수 함수이고 파일 IO도 hash도 없다.
//
// 파일 모양:
// - 첫 줄이 `---`이면 그 다음 `---` 줄까지가 frontmatter(YAML map)이고 나머지가 본문이다. 닫는 줄이 없거나
//   YAML이 깨졌거나 map이 아니면 `frontmatter`가 `malformed`다. 첫 줄이 `---`가 아니면 파일 전체가 본문이다.
// - 본문은 앞쪽 빈 줄과 뒤쪽 공백을 뺀 글이다. 쓸 때는 끝에 줄바꿈 하나를 붙인다. 본문 안의 `---` 줄은 본문이다.
// - 쓸 때는 있는 칸만 쓴다. 비운 칸과 빈 기본 목록(contexts, app_reads, skills_off, mcp_off, safe_tools)은 쓰지 않고,
//   칸이 하나도 없으면 frontmatter 줄 없이 본문만 쓴다. 칸 순서는 입력 순서와 상관없이 고정이다.
// - 쓴 글을 다시 읽으면 처음 값이 나온다. 숫자·불리언처럼 보이는 문자열도 문자열로 돌아온다.
//
// 검사는 읽을 때와 쓸 때 같다(R24): 모양 전체를 한 번에 보고 틀린 칸을 모두 `issues`에 담는다. 하나라도 틀리면
// 값도 글도 돌려주지 않는다. 칸 경로는 점 표기(`contexts.1`, `model.api_key`)이고 모르는 칸은 부모 경로 뒤에
// 그 이름을 붙인다. 존재 여부가 필요한 참조(context, 앱 command, provider, 권한 상한)와 같은 자리 Operator 사이의
// 이름 중복은 파일만으로 알 수 없으므로 여기서 보지 않는다.

export type AgentFileTarget = { role: AgentRole; place: AgentPlaceKind };

export type AgentFileError = LophnError & {
  code: "invalid_input";
  details: { issues: AgentIssue[] };
};

type FileResult<T> = Result<T, AgentFileError>;
type Plain = Record<string, unknown>;

const FENCE = "---";

// core schema는 날짜·binary 같은 확장 tag를 해석하지 않아 `2020-01-01`도 문자열로 돌아온다.
// lineWidth -1은 긴 문자열을 접지 않고, useAnchors false는 같은 값을 alias로 줄이지 않는다.
const YAML_OPTIONS = {
  schema: "core",
  lineWidth: -1,
  useAnchors: false,
} as const;

function refuse(issues: AgentIssue[]): FileResult<never> {
  return err({
    code: "invalid_input",
    message: "agent file is invalid",
    details: { issues },
  });
}

function addIssue(
  issues: AgentIssue[],
  field: string,
  code: AgentIssue["code"],
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
    value = parse(source, YAML_OPTIONS);
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

// zod가 알리는 이유를 R24의 code로 옮긴다. 값은 오류에 싣지 않는다.
function schemaIssues(error: z.ZodError): AgentIssue[] {
  const found: AgentIssue[] = [];
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
      issue.code === "custom" && issue.message.startsWith("duplicate")
    ) {
      addIssue(found, parent, "duplicate");
    } else {
      addIssue(found, parent, "invalid_value");
    }
  }
  return found;
}

// 역할과 자리에 따라 있을 수 없는 칸. 있으면 그 칸은 not_allowed 하나만 알린다.
function disallowedFields(target: AgentFileTarget): string[] {
  if (target.role !== "operator") return ["name", "contexts", "app_reads"];
  return target.place === "project" ? ["app_reads"] : ["contexts"];
}

function checkFrontmatter(
  raw: Plain,
  target: AgentFileTarget,
  issues: AgentIssue[],
): AgentFrontmatter | undefined {
  const parsed = agentFrontmatterSchema.safeParse(raw);
  const blocked = disallowedFields(target).filter((f) => raw[f] !== undefined);
  const isOperator = target.role === "operator";
  const name = raw.name;
  const nameMissing = isOperator &&
    (name === undefined || (typeof name === "string" && name.trim() === ""));

  if (!parsed.success) {
    for (const issue of schemaIssues(parsed.error)) {
      const top = issue.field.split(".")[0];
      if (blocked.includes(top) || (nameMissing && top === "name")) continue;
      addIssue(issues, issue.field, issue.code);
    }
  }
  for (const field of blocked) addIssue(issues, field, "not_allowed");
  if (nameMissing) {
    addIssue(issues, "name", "required");
  } else if (
    isOperator && typeof name === "string" && isBuiltinAgentName(name)
  ) {
    addIssue(issues, "name", "reserved_name");
  }
  return parsed.success ? parsed.data : undefined;
}

function checkBody(
  body: unknown,
  required: boolean,
  issues: AgentIssue[],
): string | undefined {
  if (typeof body !== "string") {
    addIssue(issues, "body", "invalid_value");
    return undefined;
  }
  const text = normalizeBody(body);
  if (required && text.trim() === "") addIssue(issues, "body", "required");
  if (utf8Bytes(text) > AGENT_BODY_MAX_BYTES) {
    addIssue(issues, "body", "too_large");
  }
  return text;
}

function checkDefinition(
  raw: Plain,
  body: unknown,
  target: AgentFileTarget,
): FileResult<AgentDefinition> {
  const issues: AgentIssue[] = [];
  const frontmatter = checkFrontmatter(raw, target, issues);
  const text = checkBody(body, target.role === "operator", issues);
  if (issues.length > 0 || frontmatter === undefined || text === undefined) {
    return refuse(issues);
  }
  return ok({ ...frontmatter, body: text });
}

function checkSettings(raw: Plain, body: string): FileResult<AgentSettings> {
  const parsed = agentSettingsSchema.safeParse(raw);
  const issues = parsed.success ? [] : schemaIssues(parsed.error);
  if (body.trim() !== "") addIssue(issues, "body", "not_allowed");
  if (issues.length > 0 || !parsed.success) return refuse(issues);
  return ok(parsed.data);
}

// ---- 쓰기: 고정한 칸 순서로 있는 칸만 만든다 ----

const EMPTY_DEFAULT_LISTS = [
  "contexts",
  "app_reads",
  "skills_off",
  "mcp_off",
  "safe_tools",
] as const;

// 역할 순서도 고정이다(AGENT_ROLES 순서).
const SETTINGS_ROLES = [
  "lophn",
  "app_engineer",
  "context_engineer",
  "operator",
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

function orderedList(list: Plain[], keys: readonly string[]): Plain[] {
  return list.map((item) => pick(item, keys));
}

function orderedFrontmatter(value: AgentFrontmatter): Plain {
  const source = value as Plain;
  const out: Plain = {};
  if (source.name !== undefined) out.name = source.name;
  if (source.profile !== undefined) {
    out.profile = pick(source.profile as Plain, ["kind", "icon", "image"]);
  }
  if (source.model !== undefined) {
    out.model = orderedModel(source.model as Plain);
  }
  for (const key of EMPTY_DEFAULT_LISTS) {
    const list = source[key] as Plain[] | undefined;
    if (list === undefined || list.length === 0) continue;
    out[key] = key === "app_reads"
      ? orderedList(list, ["app", "command"])
      : key === "mcp_off" || key === "safe_tools"
      ? orderedList(list, ["server_name", "original_tool"])
      : list;
  }
  if (source.permissions !== undefined) out.permissions = source.permissions;
  return out;
}

function frontmatterText(fields: Plain): string {
  if (Object.keys(fields).length === 0) return "";
  return `${FENCE}\n${stringify(fields, YAML_OPTIONS)}${FENCE}\n`;
}

export function parseAgentFile(
  text: string,
  target: AgentFileTarget,
): Result<AgentDefinition, AgentFileError> {
  const split = splitFile(text);
  if (!split.ok) return split;
  return checkDefinition(split.value.frontmatter, split.value.body, target);
}

export function serializeAgentFile(
  definition: AgentDefinition,
  target: AgentFileTarget,
): Result<string, AgentFileError> {
  const { body, ...fields } = definition as Plain;
  const checked = checkDefinition(fields, body, target);
  if (!checked.ok) return checked;
  const head = frontmatterText(orderedFrontmatter(checked.value));
  if (checked.value.body === "") return ok(head);
  const text = `${checked.value.body}\n`;
  return ok(head === "" ? text : `${head}\n${text}`);
}

// `settings.md`. 본문이 없는 frontmatter만의 파일이다.
export function parseSettingsFile(
  text: string,
): Result<AgentSettings, AgentFileError> {
  const split = splitFile(text);
  if (!split.ok) return split;
  return checkSettings(split.value.frontmatter, split.value.body);
}

export function serializeSettingsFile(
  settings: AgentSettings,
): Result<string, AgentFileError> {
  const checked = checkSettings(settings as Plain, "");
  if (!checked.ok) return checked;
  const fields: Plain = {};
  const { models, permissions } = checked.value;
  if (models !== undefined) {
    const ordered: Plain = {};
    for (const role of SETTINGS_ROLES) {
      if (models[role] !== undefined) {
        ordered[role] = orderedModel(models[role] as Plain);
      }
    }
    fields.models = ordered;
  }
  if (permissions !== undefined) fields.permissions = permissions;
  return ok(frontmatterText(fields));
}
