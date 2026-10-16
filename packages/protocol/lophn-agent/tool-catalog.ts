import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { atSchema } from "../base/values.ts";
import { agentNameSchema } from "./agent-values.ts";
import { operatorDefinitionSchema } from "./operators.ts";
import { askInputSchema } from "./ask-tool.ts";
import { callCancel, callReply, callSendInputSchema } from "./calls.ts";
import type { Role } from "./places.ts";
import { packagePublishInputSchema } from "../apps/package-routes.ts";
import { problemStateSchema } from "../problems/problem-record.ts";
import {
  sourceRelativePathSchema,
  ticketCancelInputSchema,
  ticketCreateInputSchema,
  ticketShowInputSchema,
  ticketStateSchema,
  ticketUpdateInputSchema,
  ticketVerifyInputSchema,
} from "../coding-agent/ticket/mod.ts";

// agent 내장 tool의 목록, 이름 규칙, model이 보는 입력 schema다.
// 정본 이름은 `<자원>.<동사>`이고 call, reply, cancel, ask만 한 단어다.
// 효과(read, write, external)는 여기 없다. core registry와 Gate에만 있다.
// 앱 app-api tool과 외부 MCP tool은 이름이 동적이라 접두사와 길이 상수만 둔다.

export const TOOL_NAME_MAX = 64;
export const WIRE_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const APP_API_TOOL_PREFIX = "app__"; // app__<앱>__<api>
export const MCP_TOOL_PREFIX = "mcp__"; // mcp__<server>__<tool>

// 정본 `context.get`은 model에 `context_get`으로 보낸다. provider API가 `.`을 받지 않기 때문이다.
// 거꾸로 찾기는 core registry 표가 한다. 이름을 parse하지 않는다.
export function toWireToolName(canonical: string): string {
  return canonical.replaceAll(".", "_");
}

export const COMMON_TOOLS = [
  "file.read",
  "file.glob",
  "file.grep",
  "pdf.read",
  "image.read",
  "web.search",
  "web.fetch",
  "call",
  "reply",
  "cancel",
  "session.list",
  "ask",
  "skill.read",
  "tool.search",
] as const;

// lophn을 뺀 세 role이 갖는다.
export const WORK_TOOLS = ["file.write", "file.edit", "shell.run"] as const;

// 읽기 tool은 모든 role이 갖는다.
export const READ_TOOLS = [
  "ticket.list",
  "ticket.get",
  "problem.list",
  "problem.get",
  "app.list",
  "app.get",
  "blueprint.check",
  "package.list",
  "package.get",
  "release.list",
  "release.get",
  "context.list",
  "context.get",
  "context.search",
  "context.test",
  "context.violations",
  "outline.get",
  "guide.read",
  "settings.get",
  "visual.show",
] as const;

// lophn만. 나머지 role은 project 지침을 prompt로 받는다.
export const LOPHN_ONLY_READ_TOOLS = ["instructions.read"] as const;

export const ROLE_WRITE_TOOLS = {
  lophn: ["app.create"],
  app_engineer: [
    "ticket.create",
    "ticket.update",
    "ticket.verify",
    "ticket.cancel",
    "problem.set_state",
    "app.link_source",
    "package.publish",
    "operator.create",
    "operator.update",
  ],
  operator: [],
  project_manager: [
    "context.draft",
    "context.submit",
    "glossary.set",
    "outline.set",
    "outline.delete",
    "operator.create",
    "operator.update",
  ],
} as const satisfies Record<Role, readonly string[]>;

type RoleWriteTool = (typeof ROLE_WRITE_TOOLS)[Role][number];

export type BuiltinToolName =
  | (typeof COMMON_TOOLS)[number]
  | (typeof WORK_TOOLS)[number]
  | (typeof READ_TOOLS)[number]
  | (typeof LOPHN_ONLY_READ_TOOLS)[number]
  | RoleWriteTool;

// role 고정 목록 = 공통 + 읽기 + (lophn이면 지침 읽기, 아니면 작업 tool) + role 쓰기.
// image.read를 vision 없는 model에서 빼는 일은 이 목록이 아니라 core registry가 한다.
export function builtinToolNames(role: Role): readonly BuiltinToolName[] {
  return [
    ...COMMON_TOOLS,
    ...READ_TOOLS,
    ...(role === "lophn" ? LOPHN_ONLY_READ_TOOLS : WORK_TOOLS),
    ...ROLE_WRITE_TOOLS[role],
  ];
}

// ---------- 입력 schema ----------

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});
const path = z.string().min(1);
const none = z.strictObject({});

const lineCount = z.number().int().positive();

const outlineEntry = z.strictObject({
  level: z.number().int().min(1).max(6),
  title: nonblank,
  locator: nonblank,
});

// operator 정의 입력. 이름은 따로 받고 grant와 agent 층 MCP 서버(실행 파일을 정하는 것)는 입력에 없다.
const operatorDefinition = operatorDefinitionSchema.omit({
  name: true,
  mcp_servers: true,
});

const callToolInput = callSendInputSchema.omit({
  dedup: true,
  gate_allowed: true,
});

export const TOOL_INPUTS = {
  "file.read": z.strictObject({
    path,
    offset: lineCount.optional(),
    limit: lineCount.optional(),
  }),
  "file.write": z.strictObject({ path, content: z.string() }),
  "file.edit": z.strictObject({
    path,
    old_string: z.string(),
    new_string: z.string(),
    replace_all: z.boolean().optional(),
  }),
  "file.glob": z.strictObject({ pattern: nonblank, path: path.optional() }),
  "file.grep": z.strictObject({
    pattern: nonblank,
    path: path.optional(),
    glob: nonblank.optional(),
  }),
  // 예: "1-5".
  "pdf.read": z.strictObject({ path, pages: z.string().regex(/^\d+(-\d+)?$/) }),
  "image.read": z.strictObject({ path }),
  "shell.run": z.strictObject({
    command: nonblank,
    timeout_ms: z.number().int().positive().optional(),
  }),
  "web.search": z.strictObject({ query: nonblank }),
  "web.fetch": z.strictObject({ url: z.url() }),
  // dedup은 입력이 아니라 tool call ID로, gate_allowed는 ToolGate의 결과로 채운다.
  call: callToolInput,
  reply: callReply.input,
  cancel: callCancel.input.required({ reason: true }),
  "session.list": none,
  ask: askInputSchema,
  // 딸린 파일은 path로 읽는다.
  "skill.read": z.strictObject({ name: nonblank, path: path.optional() }),
  // 정본 이름 1~20개.
  "tool.search": z.strictObject({ names: z.array(nonblank).min(1).max(20) }),
  "ticket.list": z.strictObject({
    app: idSchema("app").optional(),
    state: ticketStateSchema.optional(),
  }),
  "ticket.get": ticketShowInputSchema,
  // ticket 입력은 coding-agent의 ticket route 입력이 정본이다.
  "ticket.create": ticketCreateInputSchema,
  "ticket.update": ticketUpdateInputSchema,
  // base_revision과 completion_seq는 core가 ticket에서 채운다.
  "ticket.verify": ticketVerifyInputSchema.pick({
    ticket: true,
    result: true,
    note: true,
  }),
  "ticket.cancel": ticketCancelInputSchema,
  "problem.list": z.strictObject({
    app: idSchema("app").optional(),
    state: problemStateSchema.optional(),
    since: atSchema.optional(),
    until: atSchema.optional(),
  }),
  "problem.get": z.strictObject({ problem: idSchema("prb") }),
  "problem.set_state": z.strictObject({
    problem: idSchema("prb"),
    state: z.enum(["resolved", "ignored"]),
  }),
  "app.list": none,
  "app.get": z.strictObject({ app: idSchema("app") }),
  "app.create": z.strictObject({ name: nonblank, purpose: nonblank }),
  // git 폴더 경로.
  "app.link_source": z.strictObject({ app: idSchema("app"), path }),
  "blueprint.check": z.strictObject({ app: idSchema("app") }),
  "package.list": none,
  "package.get": z.strictObject({
    name: nonblank,
    version: nonblank.optional(),
  }),
  // path는 앱 source 안 폴더다. commit은 앱 source의 HEAD로, key는 tool call ID로 채운다.
  "package.publish": packagePublishInputSchema.omit({
    commit: true,
    key: true,
    path: true,
  }).extend({ path: sourceRelativePathSchema }),
  "release.list": z.strictObject({ app: idSchema("app") }),
  "release.get": z.strictObject({ release: idSchema("rel") }),
  "context.list": none,
  "context.get": z.strictObject({ context: idSchema("ctx") }),
  "context.search": z.strictObject({
    context: idSchema("ctx"),
    search: nonblank,
    input: z.record(z.string(), z.unknown()),
  }),
  // context가 있으면 그 context의 새 판, 없으면 새 context(name, purpose).
  "context.draft": z.strictObject({
    context: idSchema("ctx").optional(),
    name: nonblank.optional(),
    purpose: nonblank.optional(),
  }),
  // draft는 초안 판(context bundle)이다.
  "context.test": z.strictObject({
    context: idSchema("ctx"),
    draft: idSchema("cbn"),
  }),
  "context.submit": z.strictObject({
    context: idSchema("ctx"),
    draft: idSchema("cbn"),
  }),
  "context.violations": z.strictObject({ context: idSchema("ctx") }),
  "glossary.set": z.strictObject({
    context: idSchema("ctx"),
    term: nonblank,
    meaning: z.string(),
    remove: z.boolean().optional(),
  }),
  "outline.get": z.strictObject({ context: idSchema("ctx"), path }),
  // pdf, docs 파일의 목차 전체를 통째로 바꾼다.
  "outline.set": z.strictObject({
    context: idSchema("ctx"),
    path,
    outline: z.array(outlineEntry),
  }),
  "outline.delete": z.strictObject({ context: idSchema("ctx"), path }),
  "guide.read": z.strictObject({ topic: nonblank.optional() }),
  "settings.get": z.strictObject({ key: nonblank.optional() }),
  // 앱 blueprint 화면 key. card 크기를 선언한 화면만 된다.
  "visual.show": z.strictObject({ app: idSchema("app"), view: nonblank }),
  "instructions.read": z.strictObject({ project: idSchema("prj") }),
  "operator.create": operatorDefinition.extend({
    place: z.union([
      z.strictObject({ project: nonblank }),
      z.strictObject({ app: nonblank }),
    ]),
    name: agentNameSchema,
  }).strict(),
  // operator는 정의 이름이다.
  "operator.update": operatorDefinition.partial().extend({
    operator: agentNameSchema,
  }).strict(),
} satisfies Record<BuiltinToolName, z.ZodType>;
