import { z } from "zod";
import {
  documentHistory,
  documentList,
  documentMetadataSchema,
  formatGet,
  formatList,
  formatRefSchema,
  formatValidate,
  historyInputSchema,
  outlineDocument,
  outlinePlace,
  outlineRoot,
  projectGet,
  projectList,
  projectResolveCwd,
  relativePathSchema,
  searchQuery,
  searchStatus,
  sectionKeySchema,
  seriesGet,
  seriesKeySchema,
  seriesList,
  seriesNext,
} from "../projects/mod.ts";
import { documentDiff } from "../projects/history.ts";
import { documentRead, documentReadInputSchema } from "../projects/read.ts";
import { versionIdSchema } from "../projects/values.ts";
import { idempotencyKeySchema } from "../server/envelope.ts";
import { readOnlyHint, type ScopeMark, type Toolset } from "./output.ts";

// tool 입력은 documents route 입력을 다시 적지 않고 고른다. current의 cwd는 여기
// 없다. host가 고정한 근거를 project.resolve_cwd(input {})로 읽는다(계획 Q24·Q28).
const listInput = documentList.input.omit({ limit: true }).extend({
  limit: z.number().int().min(1).max(500).optional(),
});

const indexInput = z.discriminatedUnion("op", [
  outlineRoot.input.extend({ op: z.literal("root") }),
  outlinePlace.input.extend({ op: z.literal("place") }),
  outlineDocument.input.extend({ op: z.literal("document") }),
  outlineDocument.input.extend({ op: z.literal("section") }),
  searchQuery.input.omit({ limit: true }).extend({
    op: z.literal("search"),
  }),
  // status는 한 쪽에 담기는 읽기라 이어 읽기가 없다. cursor는 입력에 없다.
  searchStatus.input.extend({
    op: z.literal("status"),
  }),
]);

const projectInput = z.discriminatedUnion("op", [
  projectList.input.extend({ op: z.literal("list") }),
  projectGet.input.extend({ op: z.literal("show") }),
  // cwd는 caller 입력이 아니다. 빈 객체가 project.resolve_cwd의 입력이다.
  projectResolveCwd.input.extend({ op: z.literal("current") }),
]);

const documentInput = z.discriminatedUnion("op", [
  listInput.extend({
    op: z.literal("list"),
    unplaced: z.literal(true).optional(),
  }).refine((value) => !(value.place !== undefined && value.unplaced), {
    message: "place and unplaced are exclusive",
  }),
  // section을 주면 그 key의 판별 변화(section_history), 없으면 고정 판 목록(history)이다.
  historyInputSchema.extend({
    op: z.literal("history"),
    section: sectionKeySchema.optional(),
  }),
  documentDiff.input.extend({ op: z.literal("diff") }),
]);

const metadata = documentMetadataSchema.shape;
const saveFields = {
  place: metadata.place.optional(),
  slug: metadata.name.optional(),
  title: metadata.title.optional(),
  format: formatRefSchema.optional(),
  series: seriesGet.input.shape.selector.optional(),
  key: seriesKeySchema.optional(),
  base_revision: versionIdSchema.nullable().optional(),
  idempotency_key: idempotencyKeySchema.optional(),
};
// 저장할 파일은 제출 root(MCP 작업 위치) 기준 상대 경로다. 첫 경로가 primary다.
// bytes는 tool이 realpath로 다시 검사한 뒤 core로 보내므로 호출자가 blob 참조를
// 주장하지 않는다(connection#R10).
const submittedPaths = z.array(relativePathSchema).min(1).refine(
  (paths) => new Set(paths).size === paths.length,
  { message: "paths must be unique" },
);
const saveInput = z.strictObject({
  paths: submittedPaths,
  ...saveFields,
}).refine((value) => value.series === undefined || value.key !== undefined, {
  message: "series requires key",
});
// CLI는 위치 인자 경로를 받고 bytes는 준비 뒤 document.prepare 파일로 넘긴다.
export const cliSaveFields = saveFields;

const formatInput = z.discriminatedUnion("op", [
  formatList.input.extend({
    op: z.literal("list"),
    media_type: z.string().min(1).optional(),
  }),
  formatGet.input.extend({ op: z.literal("show") }),
  formatValidate.input.omit({
    input_hash: true,
    explicit: true,
    cursor: true,
    files: true,
  }).extend({ op: z.literal("validate"), paths: submittedPaths }),
]);

const seriesInput = z.discriminatedUnion("op", [
  seriesList.input.extend({ op: z.literal("list") }),
  seriesGet.input.extend({ op: z.literal("show") }),
  seriesNext.input.extend({ op: z.literal("next") }),
]);

export const MCP_CORE_TOOLS = [
  {
    name: "lophn_index",
    toolset: "core",
    scope: "S",
    input: indexInput,
    ops: [
      "root",
      "place",
      "document",
      "section",
      "search",
      "status",
    ],
  },
  {
    name: "lophn_project",
    toolset: "core",
    scope: "S",
    input: projectInput,
    ops: ["list", "show", "current"],
  },
  {
    name: "lophn_document",
    toolset: "core",
    scope: "S",
    input: documentInput,
    ops: ["list", "history", "diff"],
  },
  {
    name: "lophn_read",
    toolset: "core",
    scope: "S",
    input: documentReadInputSchema,
    ops: [],
  },
  {
    name: "lophn_save",
    toolset: "core",
    scope: "S",
    input: saveInput,
    ops: [],
  },
  {
    name: "lophn_format",
    toolset: "core",
    scope: "G",
    input: formatInput,
    ops: ["list", "show", "validate"],
  },
  {
    name: "lophn_series",
    toolset: "core",
    scope: "S",
    input: seriesInput,
    ops: ["list", "show", "next"],
  },
] as const satisfies readonly {
  name: string;
  toolset: Toolset;
  scope: ScopeMark;
  input: z.ZodType;
  ops: readonly string[];
}[];

export type McpCoreToolName = (typeof MCP_CORE_TOOLS)[number]["name"];

export const MCP_CORE_ROUTES = {
  lophn_index: {
    root: outlineRoot,
    place: outlinePlace,
    document: outlineDocument,
    section: outlineDocument,
    search: searchQuery,
    status: searchStatus,
  },
  lophn_project: {
    list: projectList,
    show: projectGet,
    current: projectResolveCwd,
  },
  lophn_document: {
    list: documentList,
    history: documentHistory,
    diff: documentDiff,
  },
  lophn_read: documentRead,
  lophn_save: saveInput,
  lophn_format: {
    list: formatList,
    show: formatGet,
    validate: formatValidate,
  },
  lophn_series: {
    list: seriesList,
    show: seriesGet,
    next: seriesNext,
  },
} as const;

export function mcpCoreTool(name: string) {
  const tool = MCP_CORE_TOOLS.find((item) => item.name === name);
  if (!tool) return undefined;
  return { ...tool, readOnlyHint: readOnlyHint(tool.name) };
}

// current는 caller cwd를 받지 않는다. 빈 입력이 resolve_cwd의 입력과 같다.
export const projectCurrentInputSchema = projectResolveCwd.input;
