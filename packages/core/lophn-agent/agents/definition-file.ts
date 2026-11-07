import { parse, stringify } from "yaml";
import type { z } from "zod";
import type { LophnError, Result } from "../../../base/mod.ts";
import { err, ok } from "../../../base/mod.ts";
import {
  AGENT_BODY_MAX_BYTES,
  type AgentDefinition,
  type AgentDefinitionIssue,
  type AgentId,
  agentDefinitionSchema,
  agentHandleKey,
  LOPHN_AGENT_HANDLE,
  LOPHN_AGENT_ID,
  LOPHN_AGENT_NAME,
} from "../../../protocol/lophn-agent/mod.ts";

// 정의 파일의 Markdown 읽기·쓰기다. 순수 함수이고 파일 IO도 hash도 없다.
//
// 파일 모양:
// - 첫 줄이 `---`이면 그 다음 `---` 줄까지가 frontmatter(YAML map)이고 나머지가 본문이다. 닫는 줄이 없거나
//   YAML이 깨졌거나 map이 아니면 `frontmatter`가 `malformed`다. 첫 줄이 `---`가 아니면 파일 전체가 본문이다.
// - 본문은 앞쪽 빈 줄과 뒤쪽 공백을 뺀 글이다. 쓸 때는 끝에 줄바꿈 하나를 붙인다. 본문 안의 `---` 줄은 본문이다.
// - 쓸 때는 있는 칸만 쓴다. 비운 칸과 빈 목록은 쓰지 않고, 칸이 하나도 없으면 frontmatter 줄 없이 본문만 쓴다.
//   lophn의 handle·profile은 file에 쓰지 않는다(고정). lophn의 name은 사람이 바꿨을 때만 쓴다.

type AgentFileTarget = { agent: AgentId };
export type AgentFileDefinition = AgentDefinition;

type AgentFileError = LophnError & {
  code: "invalid_input";
  details: { issues: AgentDefinitionIssue[] };
};

type FileResult<T> = Result<T, AgentFileError>;
type Plain = Record<string, unknown>;

const FENCE = "---";
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

function pathOf(path: PropertyKey[]): string {
  return path.map(String).join(".");
}

function schemaIssues(error: z.ZodError): AgentDefinitionIssue[] {
  const found: AgentDefinitionIssue[] = [];
  for (const issue of error.issues) {
    const parent = pathOf(issue.path);
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        addIssue(
          found,
          parent === "" ? key : `${parent}.${key}`,
          "unknown_field",
        );
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
): FileResult<AgentDefinition> {
  if (typeof body !== "string") {
    return refuse([{ field: "body", code: "invalid_value" }]);
  }
  const issues: AgentDefinitionIssue[] = [];
  const text = normalizeBody(body);
  if (utf8Bytes(text) > AGENT_BODY_MAX_BYTES) {
    addIssue(issues, "body", "too_large");
  }

  const fields: Plain = { ...raw };
  const isLophn = target.agent === LOPHN_AGENT_ID;
  if (isLophn) {
    for (const key of ["handle", "profile", "workspace"]) {
      if (Object.hasOwn(fields, key)) {
        addIssue(issues, key, "not_allowed");
        delete fields[key];
      }
    }
    fields.handle = LOPHN_AGENT_HANDLE;
    fields.name ??= LOPHN_AGENT_NAME;
    // lophn은 자기 runtime만 쓴다(bare도 harness도 아니다).
    if (fields.runtime !== undefined && fields.runtime !== "lophn") {
      addIssue(issues, "runtime", "not_allowed");
    }
  } else {
    for (const key of ["handle", "name"]) {
      const value = fields[key];
      if (
        value === undefined ||
        (typeof value === "string" && value.trim() === "")
      ) {
        addIssue(issues, key, "required");
      }
    }
  }

  // tools와 skills는 bare가 고르는 칸이다. lophn(runtime 없음 포함)이 적으면 뜻이 없어 거절한다.
  for (const key of ["tools", "skills"]) {
    if (fields[key] !== undefined && fields.runtime !== "bare") {
      addIssue(issues, key, "not_allowed");
    }
  }

  const shaped = agentDefinitionSchema.safeParse({ ...fields, body: text });
  if (!shaped.success) {
    for (const issue of schemaIssues(shaped.error)) {
      const top = issue.field.split(".")[0];
      // 비었거나 없는 handle·name은 위에서 required로 이미 적었다.
      if (
        !isLophn &&
        (top === "handle" || top === "name") &&
        (fields[top] === undefined ||
          (typeof fields[top] === "string" &&
            (fields[top] as string).trim() === ""))
      ) {
        continue;
      }
      addIssue(issues, issue.field, issue.code);
    }
  } else if (
    !isLophn &&
    agentHandleKey(shaped.data.handle) === agentHandleKey(LOPHN_AGENT_HANDLE)
  ) {
    addIssue(issues, "handle", "reserved_name");
  }

  if (issues.length > 0 || !shaped.success) return refuse(issues);
  return ok(shaped.data);
}

const EMPTY_DEFAULT_LISTS = [
  "skills_off",
  "mcp_off",
  "mcp_servers",
  "apps",
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
  if (value.handle !== undefined) out.handle = value.handle;
  if (value.name !== undefined) out.name = value.name;
  if (value.workspace !== undefined) {
    out.workspace = pick(value.workspace as Plain, ["kind", "id"]);
  }
  if (value.profile !== undefined) {
    out.profile = pick(value.profile as Plain, [
      "kind",
      "shape",
      "color",
      "image",
    ]);
  }
  if (value.runtime !== undefined) out.runtime = value.runtime;
  if (value.description !== undefined) out.description = value.description;
  for (const key of ["tools", "skills"]) {
    const list = value[key];
    if (Array.isArray(list) && list.length > 0) out[key] = list;
  }
  if (value.modality !== undefined) {
    out.modality = pick(value.modality as Plain, ["input", "output"]);
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
  const deny = (value.permissions as Plain | undefined)?.deny as
    | string[]
    | undefined;
  if (deny !== undefined && deny.length > 0) out.permissions = { deny };
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
): Result<AgentFileDefinition, AgentFileError> {
  const split = splitFile(text);
  if (!split.ok) return split;
  return checkDefinition(split.value.frontmatter, split.value.body, target);
}

export function serializeAgentFile(
  definition: AgentFileDefinition,
  target: AgentFileTarget,
): Result<string, AgentFileError> {
  const { body, ...fields } = definition as Plain;
  const stored: Plain = { ...fields };
  const isLophn = target.agent === LOPHN_AGENT_ID;
  if (isLophn) {
    delete stored.handle;
    delete stored.profile;
    delete stored.workspace;
  }
  const checked = checkDefinition(stored, body, target);
  if (!checked.ok) return checked;
  const { body: text, ...kept } = checked.value as Plain;
  if (isLophn) {
    delete kept.handle;
    if (kept.name === LOPHN_AGENT_NAME) delete kept.name;
  }
  const head = frontmatterText(orderedFrontmatter(kept));
  if (text === "") return ok(head);
  const rendered = `${text}\n`;
  return ok(head === "" ? rendered : `${head}\n${rendered}`);
}
