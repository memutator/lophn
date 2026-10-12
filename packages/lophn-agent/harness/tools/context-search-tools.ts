// 선언 검색마다 읽기 tool 하나와 개체 하나 읽기 tool(lophn-agent/harness/tools#R21, R22)이다.
// `buildAppTools`/`createAppToolHandlers`와 같은 모양으로 적용된 판의 선언에서 정의를 만들고 정의마다
// handler를 묶는다. 정의는 run을 시작할 때 읽은 판 값(`ContextToolContext`)으로 만들고 그 뒤 판이 바뀌어도
// 이미 만든 정의는 그대로다(진행 중인 run은 옛 정의로 계속하고 새 정의는 다음 run에서 만든다).
import { z } from "zod";
import { err, fingerprint, ok, type Result } from "../../../base/mod.ts";
import type {
  BundleContent,
  ContractField,
  DeclaredSearch,
  SearchInput,
} from "../../../protocol/projects/mod.ts";
import type { ToolResult } from "../../../protocol/lophn-agent/mod.ts";
import {
  COMMON_ERRORS,
  type ContractCall,
  defineBuiltin,
  READ,
  success,
} from "./bundles/common.ts";
import {
  CONTEXT_ENTITY_CONTRACT,
  type ContextEntityRead,
} from "./context-route-shapes.ts";
import { limitJson, PAGE_SIZE } from "./result.ts";
import { createSeriesNextToolHandlers } from "./series-next-tool.ts";
import type { ToolDefinition } from "./registry.ts";
import type { RunCredential, ToolHandler } from "./work.ts";

// 선언 검색 tool이 부르는 core contract다(`context.search` 읽기 route).
export const CONTEXT_SEARCH_CONTRACT = "context.search";

// 개체 하나 읽기 tool의 이름이다. route(`context.entity`)와 결과 모양은 `context-route-shapes.ts`에 있다.
export const CONTEXT_ENTITY_TOOL = "context.read_entity";
export { CONTEXT_ENTITY_CONTRACT, type ContextEntityRead };

// 개체 읽기 정의의 판이다. 선언 검색 정의의 revision은 판 hash에서 온다.
export const CONTEXT_ENTITY_TOOL_REVISION = "context-entity-1";

// 검색 tool 이름 접두사다: `ctx_<ctx ULID>_<검색 slug>_<hash8>`.
export const CONTEXT_TOOL_PREFIX = "ctx_";

// tool 이름은 64자 이하다. `ctx_`(4) + ULID(26) + `_` + slug + `_` + hash8(8)이라 slug는 24자까지다.
const NAME_MAX = 64;
const ULID_LENGTH = 26;
const HASH_LENGTH = 8;
const SLUG_MAX = NAME_MAX - CONTEXT_TOOL_PREFIX.length - ULID_LENGTH - 2 -
  HASH_LENGTH;

// 한 호출이 돌려주는 행 수다(harness/tools R13).
const SEARCH_PAGE_SIZE = PAGE_SIZE;
// 한 page가 결과 상한을 넘으면 같은 위치에서 더 작은 page로 다시 읽는다(core cursor는 위치만 담는다).
const SHRINK_SIZES = [SEARCH_PAGE_SIZE, 10, 5, 2, 1] as const;

// run을 시작할 때 읽은 적용된 판이다. 판이 바뀌어도 진행 중인 run은 이 값으로 계속하고 새 정의는
// 다음 run부터 쓴다(R21).
export type ContextToolContext = {
  id: string;
  title: string;
  bundle_hash: string;
  content: BundleContent;
};

export type ContextSearchToolSource = {
  // preset이 고른 context들(prompt 자료와 같은 선택).
  selected: readonly ContextToolContext[];
  // 역할 상한·assignment 범위가 읽게 하는 context id. null이면 역할 상한이 더 줄이지 않는다.
  allowed: ReadonlySet<string> | null;
};

export type ContextSearchTool = {
  definition: ToolDefinition;
  context: string;
  contextTitle: string;
  search: string;
  searchTitle: string;
  bundleHash: string;
  // 이 정의가 만들어진 선언의 지문. 판 hash·검색 선언·입력 schema 중 하나라도 바뀌면 달라진다.
  definitionHash: string;
};

export type ContextReadTools = {
  // selected ∩ allowed인 context의 선언 검색마다 하나.
  search: readonly ContextSearchTool[];
  // 도달 가능한 context가 하나라도 있을 때만 있다.
  entity: ToolDefinition | null;
  // 이 tool들이 닿는 context id(개체 읽기가 이 밖의 context를 not_found로 거절한다).
  contexts: readonly string[];
};

// ---- 정의 ----

type Shape = { json: Record<string, unknown>; zod: z.ZodType };

function scalarShape(
  valueType: string,
  values: readonly string[] | undefined,
): Shape {
  switch (valueType) {
    case "number":
      return { json: { type: "number" }, zod: z.number() };
    case "boolean":
      return { json: { type: "boolean" }, zod: z.boolean() };
    case "enum":
      if (values !== undefined && values.length > 0) {
        return {
          json: { type: "string", enum: [...values] },
          zod: z.enum(values as [string, ...string[]]),
        };
      }
      return { json: { type: "string" }, zod: z.string() };
    // string·date와 모르는 종류. date는 글이다.
    default:
      return { json: { type: "string" }, zod: z.string() };
  }
}

function fieldShape(content: BundleContent, of: string | undefined): Shape {
  const [typeName, fieldName] = (of ?? "").split(".");
  const type = content.contract.types.find((entry) => entry.name === typeName);
  // `key`와 `path`는 모든 개체가 가진 글 field다.
  const field: ContractField | undefined = type?.fields.find((entry) =>
    entry.name === fieldName
  );
  if (field === undefined) return scalarShape("string", undefined);
  return field.value_type === "list"
    ? scalarShape(field.item_type ?? "string", field.values)
    : scalarShape(field.value_type, field.values);
}

function inputShape(content: BundleContent, input: SearchInput): Shape {
  let base: Shape;
  if (input.type === "range") {
    const bound = fieldShape(content, input.of);
    base = {
      json: {
        type: "object",
        properties: { from: bound.json, to: bound.json },
        additionalProperties: false,
      },
      zod: z.strictObject({
        from: bound.zod.optional(),
        to: bound.zod.optional(),
      }),
    };
  } else if (input.type === "value") {
    base = fieldShape(content, input.of);
  } else {
    // text는 글이고 entity는 개체 key 글이다.
    base = scalarShape("string", undefined);
  }
  const description = input.label;
  return input.many
    ? {
      json: { type: "array", items: base.json, description },
      zod: z.array(base.zod),
    }
    : { json: { ...base.json, description }, zod: base.zod };
}

type ToolInput = { json: Record<string, unknown>; zod: z.ZodType };

// 검색의 입력은 `{inputs: {...}, cursor?}`이고 모델이 context id·검색 이름·page 크기를 주지 않는다.
export function searchToolInput(
  content: BundleContent,
  search: DeclaredSearch,
): ToolInput {
  const properties: Record<string, unknown> = {};
  const zodShape: Record<string, z.ZodType> = {};
  const required: string[] = [];
  for (const input of search.inputs) {
    const shape = inputShape(content, input);
    properties[input.name] = shape.json;
    zodShape[input.name] = input.required ? shape.zod : shape.zod.optional();
    if (input.required) required.push(input.name);
  }
  const inputsJson: Record<string, unknown> = {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
  const inputsZod = z.strictObject(zodShape);
  const json: Record<string, unknown> = {
    type: "object",
    properties: {
      inputs: inputsJson,
      cursor: {
        type: "string",
        description:
          "the next_cursor of the previous page; keep the same inputs to read on",
      },
    },
    ...(required.length > 0 ? { required: ["inputs"] } : {}),
    additionalProperties: false,
  };
  return {
    json,
    zod: z.strictObject({
      inputs: required.length > 0 ? inputsZod : inputsZod.optional(),
      cursor: z.string().optional(),
    }),
  };
}

async function searchToolName(
  context: string,
  search: string,
): Promise<string> {
  const ulid = context.slice(context.indexOf("_") + 1);
  const hash = (await fingerprint({ context, search })).slice(0, HASH_LENGTH);
  return `${CONTEXT_TOOL_PREFIX}${ulid}_${search.slice(0, SLUG_MAX)}_${hash}`;
}

function describe(
  context: ContextToolContext,
  search: DeclaredSearch,
): string {
  const result = search.result.kind === "board"
    ? `grouped as a board by ${search.result.board_by}`
    : `columns: ${search.result.columns.map((c) => c.label).join(", ")}`;
  return `Context ${context.title} (${context.id}), declared search ${search.name}: ${search.title}. ` +
    `Returns entity rows (ref and cells; ${result}), the total, and a cursor, up to ${SEARCH_PAGE_SIZE} rows per call; ` +
    `pass the returned next_cursor with the same inputs to read on (reads only)`;
}

async function searchTool(
  context: ContextToolContext,
  search: DeclaredSearch,
): Promise<ContextSearchTool> {
  const input = searchToolInput(context.content, search);
  const definitionHash = await fingerprint({
    context: context.id,
    bundle_hash: context.bundle_hash,
    search,
    input: input.json,
  });
  const definition: ToolDefinition = {
    name: await searchToolName(context.id, search.name),
    description: describe(context, search),
    revision: `${context.bundle_hash.slice(0, 12)}:${
      definitionHash.slice(0, 16)
    }`,
    input: input.zod,
    inputSchema: input.json,
    effect: "read",
    confirm: false,
    contract: CONTEXT_SEARCH_CONTRACT,
    scopeCheck: "contexts the preset selection, role, and assignment allow",
    reversible: true,
    idempotent: true,
    errors: COMMON_ERRORS,
    origin: "context",
    context: context.id,
  };
  return {
    definition,
    context: context.id,
    contextTitle: context.title,
    search: search.name,
    searchTitle: search.title,
    bundleHash: context.bundle_hash,
    definitionHash,
  };
}

const entityInput = {
  json: {
    type: "object",
    properties: {
      context: {
        type: "string",
        description: "the id of a context you may read",
      },
      type: { type: "string", description: "the entity type name" },
      key: { type: "string", description: "the entity key" },
    },
    required: ["context", "type", "key"],
    additionalProperties: false,
  } as Record<string, unknown>,
  zod: z.strictObject({
    context: z.string(),
    type: z.string(),
    key: z.string(),
  }),
};

function entityTool(): ToolDefinition {
  return {
    ...defineBuiltin(
      CONTEXT_ENTITY_TOOL_REVISION,
      CONTEXT_ENTITY_TOOL,
      "Read one entity of an applied context by context id, type, and key. Returns its fields, " +
        "its relations (targets as refs), and the file path (and section) to read on with the document tools",
      entityInput.zod,
      CONTEXT_ENTITY_CONTRACT,
      { ...READ, scopeCheck: "contexts the preset selection allows" },
    ),
    inputSchema: entityInput.json,
  };
}

// selected ∩ allowed인 context마다 선언 검색 tool 하나를 만들고 도달 가능한 context가 있으면 개체 읽기
// tool을 더한다. 같은 판은 같은 이름·정의를 만든다.
export async function buildContextReadTools(
  source: ContextSearchToolSource,
): Promise<ContextReadTools> {
  const contexts: string[] = [];
  const search: ContextSearchTool[] = [];
  const names = new Set<string>();
  for (const context of source.selected) {
    if (contexts.includes(context.id)) continue;
    if (source.allowed !== null && !source.allowed.has(context.id)) continue;
    contexts.push(context.id);
    for (const declared of context.content.searches) {
      const tool = await searchTool(context, declared);
      if (names.has(tool.definition.name)) continue;
      names.add(tool.definition.name);
      search.push(tool);
    }
  }
  return {
    search,
    entity: contexts.length === 0 ? null : entityTool(),
    contexts,
  };
}

// 목록에 넣을 정의: 선언 검색 tool들 다음에 개체 읽기 tool.
export function contextReadDefinitions(
  tools: ContextReadTools,
): readonly ToolDefinition[] {
  return [
    ...tools.search.map((tool) => tool.definition),
    ...(tools.entity === null ? [] : [tools.entity]),
  ];
}

// ---- 호출 ----

type SearchPage = {
  context: string;
  search: string;
  bundle_hash: string;
  total: number;
  rows: unknown[];
  next_cursor?: string | null;
};

function searchResult(
  tool: ContextSearchTool,
  page: SearchPage,
  content: Record<string, unknown>,
  fits: boolean,
): ToolResult {
  const next = page.next_cursor ?? null;
  const stale = page.bundle_hash !== tool.bundleHash;
  return {
    status: "success",
    summary:
      `${tool.searchTitle}: ${page.total} in total, ${page.rows.length} rows${
        next === null ? "" : " in this page"
      }`.slice(0, 400),
    content: (fits ? content : null) as ToolResult["content"],
    complete: fits && next === null,
    source: null,
    continuation: next === null ? null : { has_more: true, read_next: next },
    pending: stale
      ? [
        "the context bundle changed after this run started; read the newer one",
      ]
      : [],
  };
}

function searchHandler(
  tool: ContextSearchTool,
  ports: ContractCall,
): ToolHandler {
  return async (input: unknown, credential: RunCredential) => {
    const body = input as {
      inputs?: Record<string, unknown>;
      cursor?: string;
    };
    let last: Result<ToolResult> | undefined;
    for (const size of SHRINK_SIZES) {
      const read = await ports.call(
        CONTEXT_SEARCH_CONTRACT,
        {
          context: tool.context,
          search: tool.search,
          inputs: body.inputs ?? {},
          ...(body.cursor === undefined ? {} : { cursor: body.cursor }),
          page_size: size,
        },
        credential.run,
      );
      if (!read.ok) return read;
      const page = read.value as SearchPage;
      const content = {
        context: page.context,
        search: page.search,
        bundle_hash: page.bundle_hash,
        total: page.total,
        rows: page.rows,
        next_cursor: page.next_cursor ?? null,
      };
      const fits = limitJson(content).complete;
      last = ok(searchResult(tool, page, content, fits));
      if (fits || page.rows.length <= 1) return last;
    }
    return last!;
  };
}

function entityHandler(
  tools: ContextReadTools,
  ports: ContractCall,
): ToolHandler {
  const reach = new Set(tools.contexts);
  return async (input: unknown, credential: RunCredential) => {
    const body = input as { context: string; type: string; key: string };
    // 선택 밖·다른 project의 context는 core를 부르기 전에 없는 대상과 같은 답이다.
    if (!reach.has(body.context)) {
      return err({ code: "not_found", message: "no such entity" });
    }
    const read = await ports.call(
      CONTEXT_ENTITY_CONTRACT,
      { context: body.context, type: body.type, key: body.key },
      credential.run,
    );
    if (!read.ok) return read;
    const entity = read.value as ContextEntityRead;
    const { ref } = entity;
    const result = success(
      `entity ${ref.type} ${ref.key}`.slice(0, 400),
      {
        context: entity.context,
        bundle_hash: entity.bundle_hash,
        ref,
        fields: entity.fields,
        relations: entity.relations,
      },
    );
    return ok({
      ...result,
      source: {
        target: ref.section === null ? ref.path : `${ref.path}#${ref.section}`,
        version: null,
        range: null,
        original_bytes: null,
        original_lines: null,
        omitted_count: null,
      },
    });
  };
}

export function createContextReadToolHandlers(
  tools: ContextReadTools,
  ports: ContractCall,
): ReadonlyMap<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  for (const tool of tools.search) {
    handlers.set(tool.definition.name, searchHandler(tool, ports));
  }
  if (tools.entity !== null) {
    handlers.set(tools.entity.name, entityHandler(tools, ports));
  }
  // 다음 이름 읽기는 정의가 모든 역할에 같지만 개체 읽기처럼 선택한 context 안에서만 읽힌다(R24). 선택이 비어도
  // handler는 있어 어느 context도 not_found로 답한다.
  for (
    const [name, handler] of createSeriesNextToolHandlers(ports, tools.contexts)
  ) {
    handlers.set(name, handler);
  }
  return handlers;
}
