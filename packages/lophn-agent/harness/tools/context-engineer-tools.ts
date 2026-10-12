// Context Engineer만의 tool(lophn-agent/harness/tools#R23, roles/context-engineer#R5, R8, R11, R14, R15)이다.
// 정의는 harness/tools에 있고(harness는 roles를 import하지 않는다) `BUILTIN_TOOLS`가 더한다. 역할 쪽은
// 이름만 고른다: 역할 상한 이름 표(`presets/role-caps.ts`)가 이 이름을 Context Engineer에게만 연다.
// 계약은 JSON 선언으로만 쓰고(초안 content는 객체), 코드·shell·파일 쓰기 통로는 없다. 모든 tool은 소유 contract
// 하나를 부르는 얇은 handler다: 초안 쓰기·판 제출·용어집 쓰기는 core가 검사하고, 판 적용은 check를
// 통과한 뒤 core가 한다.
import { z } from "zod";
import { ok, type Result } from "../../../base/mod.ts";
import {
  bundleContentSchema,
  bundleIdSchema,
  contextCreateRequestSchema,
  ctxIdSchema,
  draftContentSchema,
  glossaryEntryIdSchema,
  glossaryMeaningSchema,
  glossaryTermSchema,
  readCursorSchema,
  revisionSchema,
} from "../../../contracts/documents/mod.ts";
import type { ToolResult } from "../../../contracts/lophn-agent/mod.ts";
import {
  type ContractCall,
  defineBuiltin,
  idFromKey,
  READ,
  success,
  toolIdempotencyKey,
} from "./bundles/common.ts";
import { type Body, bodyOf, continuation, wrap } from "./bundles/paging.ts";
import {
  CONTEXT_PREVIEW_CONTRACT,
  type ContextPreviewRead,
} from "./context-route-shapes.ts";
import { decodeWindowCursor, fitJson, PAGE_SIZE } from "./result.ts";
import type { ToolDefinition } from "./registry.ts";
import type { RunCredential, ToolHandler } from "./work.ts";

// 읽기 tool 넷(계약·초안, 미리보기, 위반, 용어집 읽기), 쓰기 tool 넷(context 생성, 초안, 제출, 용어집 쓰기).
// 이름은 docs의 "context·series tool 계약" 표와 같다.
export const CONTEXT_ENGINEER_TOOL_NAMES = {
  // context 만들기 (`context.create`, write). 계약은 비어 있고 초안·제출이 채운다
  create: "context.create",
  // 적용된 판의 계약과 만드는 중인 판(draft, 검사 중, 마지막 failed)·그 검사 보고를 한 번에 읽는다
  // (`context.contract`와 보조 `context.draft`)
  readContract: "context.read_contract",
  // 초안 쓰기 (`bundle.save_draft`, write)
  draft: "context.draft",
  // 초안을 지금 project 파일로 추출해 보기만 한다 (`context.preview`, 적용 없음)
  preview: "context.preview",
  // 판 제출 (`bundle.submit`, write)
  submit: "context.submit",
  // 현재 위반 (`context.violations`)
  readViolations: "context.violations",
  // 용어집 읽기 (`glossary.list`)
  glossaryRead: "context.glossary_read",
  // 용어집 항목 쓰기·지우기 (`glossary.set`와 보조 `glossary.remove`, write)
  glossaryWrite: "context.glossary_write",
} as const;

// 미리보기 route(`context.preview`)와 결과 모양은 `context-route-shapes.ts`에 있다.
export { CONTEXT_PREVIEW_CONTRACT, type ContextPreviewRead };

export const CONTEXT_ENGINEER_TOOL_REVISION = "context-engineer-1";

// 소유 contract 이름이다. 미리보기는 `CONTEXT_PREVIEW_CONTRACT`다.
const CONTRACT = {
  create: "context.create",
  contract: "context.contract",
  // 계약·초안 읽기가 같은 자격으로 함께 읽는 route다(`SUPPORTING_OPERATIONS`).
  draft: "context.draft",
  violations: "context.violations",
  glossaryList: "glossary.list",
  saveDraft: "bundle.save_draft",
  submit: "bundle.submit",
  glossarySet: "glossary.set",
  // 용어집 쓰기가 항목을 지울 때 부르는 route다(`SUPPORTING_OPERATIONS`).
  glossaryRemove: "glossary.remove",
} as const;

const N = CONTEXT_ENGINEER_TOOL_NAMES;

// ---- 입력 ----

const contextOnly = z.strictObject({ context: ctxIdSchema });
// 계약·초안은 24 KiB를 넘으면 한 번에 못 읽으므로 한쪽 판이나 content의 한 가지(계약·검색·saved view·예시)만
// 골라 나눠 읽는다. 둘 다 없으면 적용된 판과 초안 전체다.
const CONTRACT_PARTS = ["applied", "draft"] as const;
const CONTRACT_SECTIONS = [
  "contract",
  "searches",
  "saved_views",
  "examples",
] as const;
const readContractInput = z.strictObject({
  context: ctxIdSchema,
  part: z.enum(CONTRACT_PARTS).optional(),
  section: z.enum(CONTRACT_SECTIONS).optional(),
});
// 새 context의 id는 최초 ToolCall ID에서 정해지므로 입력에 없다.
const createInput = contextCreateRequestSchema.omit({ id: true });
const previewInput = z.strictObject({
  context: ctxIdSchema,
  bundle: bundleIdSchema,
  cursor: readCursorSchema.optional(),
});
const violationsInput = z.strictObject({
  context: ctxIdSchema,
  cursor: readCursorSchema.optional(),
});
// 새 초안은 context와 내용뿐이고, 있는 초안을 덮으려면 bundle과 읽은 revision이 한 짝이다.
const saveDraftInput = z.strictObject({
  context: ctxIdSchema,
  bundle: bundleIdSchema.optional(),
  base_revision: revisionSchema.optional(),
  content: draftContentSchema,
}).refine((value) =>
  (value.bundle === undefined) ===
    (value.base_revision === undefined), {
  message: "bundle and base_revision go together",
});
const submitInput = z.strictObject({ bundle: bundleIdSchema });
// 용어집 쓰기는 하나의 tool이다. 새 항목은 context·term·meaning, 있는 항목의 수정은 entry·base_revision과
// 바뀌는 값 하나 이상, 지우기는 entry·base_revision과 `remove: true`다.
const glossaryNewInput = z.strictObject({
  context: ctxIdSchema,
  term: glossaryTermSchema,
  meaning: glossaryMeaningSchema,
});
const glossaryChangeInput = z.strictObject({
  entry: glossaryEntryIdSchema,
  base_revision: revisionSchema,
  term: glossaryTermSchema.optional(),
  meaning: glossaryMeaningSchema.optional(),
}).refine((value) => value.term !== undefined || value.meaning !== undefined, {
  message: "set must change the term or the meaning",
});
const glossaryRemoveInput = z.strictObject({
  entry: glossaryEntryIdSchema,
  base_revision: revisionSchema,
  remove: z.literal(true),
});
const glossaryWriteInput = z.union([
  glossaryNewInput,
  glossaryChangeInput,
  glossaryRemoveInput,
]);

type Json = Record<string, unknown>;

function objectSchema(
  properties: Json,
  required: readonly string[],
): Json {
  return {
    type: "object",
    properties,
    ...(required.length === 0 ? {} : { required: [...required] }),
    additionalProperties: false,
  };
}

const CONTEXT_PROP = {
  type: "string",
  description: "the id of the context",
};
const BUNDLE_PROP = {
  type: "string",
  description: "the id of the bundle (a draft being made)",
};
const CURSOR_PROP = {
  type: "string",
  description: "the next_cursor of the previous page, to read on",
};
const REVISION_PROP = {
  type: "string",
  description: "the revision you read last; a stale one is a conflict",
};

// ---- 초안 content의 schema ----

// 초안 content는 계약 값(`bundleContentSchema`)의 JSON Schema를 그대로 model에 보인다. 실행 입력 검사는
// 초안 그릇(`draftContentSchema`)이 하고 계약의 뜻 검사는 core(`bundle.save_draft`)가 하므로, 이 schema는 model이
// 모양을 추측하지 않게 하는 안내다. 재귀 조건(`$defs`)은 입력 schema의 뿌리로 올려 `#/$defs/…` 참조가 그대로 닿게 한다.
function draftContentJsonSchema(): { content: Json; defs: Json } {
  const { $schema: _draft, $defs, ...content } = z.toJSONSchema(
    bundleContentSchema,
    { io: "input" },
  ) as Json;
  return { content, defs: ($defs ?? {}) as Json };
}

const DRAFT_CONTENT = draftContentJsonSchema();

// ---- 정의 ----

const SCOPE = "contexts the Context Engineer may work on";

function define(
  name: string,
  description: string,
  input: z.ZodType,
  inputSchema: Json,
  contract: string,
  effect: "read" | "write",
): ToolDefinition {
  return {
    ...defineBuiltin(
      CONTEXT_ENGINEER_TOOL_REVISION,
      name,
      description,
      input,
      contract,
      effect === "read"
        ? { ...READ, scopeCheck: SCOPE }
        // 초안은 덮어쓸 수 있고 용어집은 다시 적을 수 있으며 적용된 판은 사람이 되돌린다.
        : {
          effect: "write",
          scopeCheck: SCOPE,
          reversible: true,
          idempotent: false,
        },
    ),
    inputSchema,
  };
}

export const CONTEXT_ENGINEER_TOOLS: readonly ToolDefinition[] = [
  define(
    N.create,
    "Create a new, empty context in a project: its title and purpose. It has no contract yet; write one with " +
      "context.draft and submit it. Use this first when the person's context does not exist. The new context's id " +
      "is in the result",
    createInput,
    objectSchema({
      project: { type: "string", description: "the id of the project" },
      title: { type: "string", description: "the name of the context" },
      purpose: {
        type: "string",
        description: "what the context is for, in one or two sentences",
      },
    }, ["project", "title", "purpose"]),
    CONTRACT.create,
    "write",
  ),
  define(
    N.readContract,
    "Read a context: the applied contract (types, searches, saved views, examples, bundle id and hash) and the " +
      "bundle being made (draft, being checked, or the last failed one) with its check report and the revision " +
      "to give back when you overwrite it. This changes nothing. When it is too large to return in full the content " +
      "is null and complete is false: read it piece by piece with part (applied or draft) and section " +
      "(contract, searches, saved_views, or examples)",
    readContractInput,
    objectSchema({
      context: CONTEXT_PROP,
      part: {
        type: "string",
        enum: [...CONTRACT_PARTS],
        description: "read only the applied contract or only the draft",
      },
      section: {
        type: "string",
        enum: [...CONTRACT_SECTIONS],
        description: "read only this part of the content",
      },
    }, ["context"]),
    CONTRACT.contract,
    "read",
  ),
  define(
    N.draft,
    "Write the draft bundle of a context as a JSON declaration (contract, searches, saved views, examples). " +
      "Without bundle it starts a new draft; to overwrite the draft you read, give its bundle id and the base_revision you read " +
      "(a stale one is a conflict). content is a JSON object in the shape of the schema below, with schema: 1. " +
      "Nothing is applied until you submit the bundle",
    saveDraftInput,
    // 쓰는 법은 tool 설명에 있고, content의 모양은 계약 값의 schema다.
    {
      ...objectSchema({
        context: { type: "string" },
        bundle: { type: "string" },
        base_revision: { type: "string" },
        content: DRAFT_CONTENT.content,
      }, ["context", "content"]),
      $defs: DRAFT_CONTENT.defs,
    },
    CONTRACT.saveDraft,
    "write",
  ),
  define(
    N.preview,
    "Extract a draft bundle from the current project files and read the entity count per type and the violations, " +
      "up to 20 per call. Nothing is applied and no bundle, file, or ledger changes",
    previewInput,
    objectSchema({
      context: CONTEXT_PROP,
      bundle: BUNDLE_PROP,
      cursor: CURSOR_PROP,
    }, ["context", "bundle"]),
    CONTEXT_PREVIEW_CONTRACT,
    "read",
  ),
  define(
    N.submit,
    "Submit a draft bundle to be checked. A bundle that passes is applied by the system; a failed one is not applied " +
      "and its findings are read with the bundle being made",
    submitInput,
    objectSchema({ bundle: BUNDLE_PROP }, ["bundle"]),
    CONTRACT.submit,
    "write",
  ),
  define(
    N.readViolations,
    "Read the current violations of a context (document path and rule), up to 20 per call. This changes nothing",
    violationsInput,
    objectSchema({ context: CONTEXT_PROP, cursor: CURSOR_PROP }, ["context"]),
    CONTRACT.violations,
    "read",
  ),
  define(
    N.glossaryRead,
    "Read the glossary of a context: terms, meanings, and who set them, with the revision of each entry. " +
      "This changes nothing",
    contextOnly,
    objectSchema({ context: CONTEXT_PROP }, ["context"]),
    CONTRACT.glossaryList,
    "read",
  ),
  define(
    N.glossaryWrite,
    "Write the glossary of a context, which is separate from the contract. Add an entry with context, term, and " +
      "meaning. Change an entry you read with entry, base_revision, and a new term or meaning. Remove an entry " +
      "you read with entry, base_revision, and remove=true",
    glossaryWriteInput,
    objectSchema({
      context: { ...CONTEXT_PROP, description: "a new entry: the context" },
      term: { type: "string", description: "the term" },
      meaning: { type: "string", description: "the meaning" },
      entry: {
        type: "string",
        description: "a change or removal: the id of the entry",
      },
      base_revision: REVISION_PROP,
      remove: {
        type: "boolean",
        description: "true to remove the entry",
      },
    }, []),
    CONTRACT.glossarySet,
    "write",
  ),
];

// ---- 호출 ----

// core 읽기가 모두 싣는 `as_of_seq`·`complete`·`next_cursor`를 뺀 몸통이다.
function bodyWithout(value: unknown): Json {
  const { as_of_seq: _seq, complete: _complete, next_cursor: _next, ...rest } =
    bodyOf(value);
  return rest;
}

function pageResult(
  summary: string,
  content: Json,
  arrayKeys: readonly string[],
  body: Body,
  next: string | null,
): ToolResult {
  const fitted = fitJson(content, arrayKeys);
  return {
    status: "success",
    summary,
    content: fitted.content as ToolResult["content"],
    complete: fitted.complete && body.complete !== false && next === null,
    source: null,
    continuation: continuation(next),
    pending: [],
  };
}

function read(
  ports: ContractCall,
  contract: string,
  summary: string,
  shape: (body: Body, input: Json) => Json,
  arrayKeys: readonly string[],
  build: (input: Json) => Json,
): ToolHandler {
  return async (input, credential: RunCredential) => {
    const request = input as Json;
    const got = await ports.call(contract, build(request), credential.run);
    if (!got.ok) return got;
    const body = bodyOf(got.value);
    const next = body.next_cursor ?? null;
    return ok(
      pageResult(summary, shape(body, request), arrayKeys, body, next),
    );
  };
}

// 한 번에 20개다(R13). 위반 읽기는 core에 limit 20을 보낸다.
const VIOLATION_LIMIT = PAGE_SIZE;

// 미리보기 page는 core가 30개씩 주므로 앞 20개만 보이고 나머지는 같은 page의 뒤 위치에서 잇는다. 다음 page로
// 넘어갈 때는 core의 cursor를 그대로 준다.
const PREVIEW_SCOPE = "context.preview";

function previewHandler(ports: ContractCall): ToolHandler {
  return async (input, credential) => {
    const request = input as {
      context: string;
      bundle: string;
      cursor?: string;
    };
    // 우리가 감싼 cursor면 그 위치에서, 아니면 core의 cursor 그대로 page의 처음부터 읽는다.
    const decoded = request.cursor === undefined
      ? null
      : decodeWindowCursor(request.cursor);
    const given = decoded !== null && decoded.scope === PREVIEW_SCOPE
      ? decoded
      : null;
    const inner = given === null ? request.cursor ?? null : given.inner;
    const skip = given === null ? 0 : given.skip;
    const got = await ports.call(
      CONTEXT_PREVIEW_CONTRACT,
      {
        context: request.context,
        bundle: request.bundle,
        ...(inner === null ? {} : { cursor: inner }),
      },
      credential.run,
    );
    if (!got.ok) return got;
    const body = bodyOf(got.value);
    const rest = bodyWithout(body) as Json & { violations?: unknown[] };
    const items = rest.violations ?? [];
    const shown = items.slice(skip, skip + PAGE_SIZE);
    const fitted = fitJson({ ...rest, violations: shown }, [
      "violations",
      "types",
    ]);
    const kept = fitted.content === null
      ? 0
      : ((fitted.content as Json)["violations"] as unknown[]).length;
    const consumed = skip + kept;
    const next = consumed < items.length
      ? wrap(PREVIEW_SCOPE, inner, consumed)
      : body.next_cursor ?? null;
    return ok({
      status: "success",
      summary: `preview of ${request.bundle}: ${
        String(rest["violation_count"] ?? 0)
      } violations`.slice(0, 400),
      content: fitted.content as ToolResult["content"],
      complete: fitted.complete && body.complete !== false && next === null,
      source: null,
      continuation: continuation(next),
      pending: [],
    });
  };
}

function resultOf(
  summary: string,
  value: unknown,
  pending: readonly string[] = [],
): ToolResult {
  return { ...success(summary, value), pending: [...pending] };
}

async function write(
  tool: string,
  input: unknown,
  credential: RunCredential,
  call: (key: string) => Promise<Result<unknown>>,
  done: (value: unknown) => ToolResult,
): Promise<Result<ToolResult>> {
  const key = await toolIdempotencyKey(tool, input, credential);
  const sent = await call(key);
  if (!sent.ok) return sent;
  return ok(done(sent.value));
}

// 계약·초안 읽기다. 적용된 판과 만드는 중인 판을 같은 자격으로 한 결과에 싣는다. `part`는 한쪽만 읽고(읽지
// 않는 쪽은 core도 부르지 않는다), `section`은 각 판의 content에서 그 가지만 싣는다.
function onlySection(
  version: Json | null,
  section: string | undefined,
): Json | null {
  const content = version?.["content"];
  if (
    section === undefined || version === null || content === null ||
    typeof content !== "object"
  ) return version;
  return {
    ...version,
    content: { [section]: (content as Json)[section] ?? null },
  };
}

function readContractHandler(ports: ContractCall): ToolHandler {
  return async (input, credential) => {
    const { context, part, section } = input as {
      context: string;
      part?: (typeof CONTRACT_PARTS)[number];
      section?: (typeof CONTRACT_SECTIONS)[number];
    };
    const result: Json = { context };
    if (part !== "draft") {
      const applied = await ports.call(
        CONTRACT.contract,
        { context },
        credential.run,
      );
      if (!applied.ok) return applied;
      const { context: _contract, ...appliedRest } = bodyWithout(
        applied.value,
      ) as Json;
      result["applied"] = onlySection(appliedRest, section);
    }
    if (part !== "applied") {
      const draft = await ports.call(
        CONTRACT.draft,
        { context },
        credential.run,
      );
      if (!draft.ok) return draft;
      const making = bodyWithout(draft.value) as Json;
      result["draft"] = onlySection(
        (making["draft"] ?? null) as Json | null,
        section,
      );
    }
    if (section !== undefined) result["section"] = section;
    return ok(
      pageResult("applied contract and draft read", result, [], {}, null),
    );
  };
}

export function createContextEngineerToolHandlers(
  ports: ContractCall,
): ReadonlyMap<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  handlers.set(N.readContract, readContractHandler(ports));

  handlers.set(N.create, async (input, credential) => {
    const request = input as {
      project: string;
      title: string;
      purpose: string;
    };
    // 새 context의 id는 최초 ToolCall ID에서 정해져 재전송이 두 번째 context를 만들지 않는다.
    const key = await toolIdempotencyKey(N.create, input, credential);
    const id = await idFromKey("ctx", key);
    const sent = await ports.call(
      CONTRACT.create,
      {
        id,
        project: request.project,
        title: request.title,
        purpose: request.purpose,
      },
      credential.run,
      { idempotency_key: key },
    );
    if (!sent.ok) return sent;
    return ok(resultOf("context created", sent.value));
  });
  handlers.set(
    N.readViolations,
    read(
      ports,
      CONTRACT.violations,
      "violations read",
      (body) => bodyWithout(body),
      ["violations"],
      (input) => ({
        context: input["context"],
        ...(input["cursor"] === undefined ? {} : { cursor: input["cursor"] }),
        limit: VIOLATION_LIMIT,
      }),
    ),
  );
  handlers.set(
    N.glossaryRead,
    read(
      ports,
      CONTRACT.glossaryList,
      "glossary read",
      (body) => bodyWithout(body),
      ["entries"],
      (input) => ({ context: input["context"] }),
    ),
  );
  handlers.set(N.preview, previewHandler(ports));

  handlers.set(N.draft, (input, credential) => {
    const request = input as {
      context: string;
      bundle?: string;
      base_revision?: string;
      content: Json;
    };
    return write(
      N.draft,
      input,
      credential,
      (key) =>
        ports.call(
          CONTRACT.saveDraft,
          {
            context: request.context,
            ...(request.bundle === undefined ? {} : { bundle: request.bundle }),
            content: request.content,
          },
          credential.run,
          {
            ...(request.base_revision === undefined
              ? {}
              : { compare: { base_revision: request.base_revision } }),
            idempotency_key: key,
          },
        ),
      (value) => resultOf("draft written", value),
    );
  });

  handlers.set(N.submit, (input, credential) => {
    const request = input as { bundle: string };
    return write(
      N.submit,
      input,
      credential,
      (key) =>
        ports.call(
          CONTRACT.submit,
          { bundle: request.bundle },
          credential.run,
          { idempotency_key: key },
        ),
      (value) => {
        const status = (value as { status?: string }).status;
        // 검사 중인 판은 통과해야 적용된다. 적용은 이 tool의 일이 아니다.
        return resultOf(
          `bundle submitted: ${status ?? "unknown"}`,
          value,
          status === "checking" ? ["check"] : [],
        );
      },
    );
  });

  handlers.set(N.glossaryWrite, async (input, credential) => {
    const request = input as {
      context?: string;
      entry?: string;
      base_revision?: string;
      term?: string;
      meaning?: string;
      remove?: true;
    };
    if (request.entry === undefined) {
      // 새 항목의 id는 최초 ToolCall ID에서 정해져 재전송이 두 번째 항목을 만들지 않는다.
      const key = await toolIdempotencyKey(N.glossaryWrite, input, credential);
      const id = await idFromKey("trm", key);
      const sent = await ports.call(
        CONTRACT.glossarySet,
        {
          id,
          context: request.context,
          term: request.term,
          meaning: request.meaning,
        },
        credential.run,
        { idempotency_key: key },
      );
      if (!sent.ok) return sent;
      return ok(resultOf("glossary entry added", sent.value));
    }
    const compare = { base_revision: request.base_revision };
    if (request.remove === true) {
      return await write(
        N.glossaryWrite,
        input,
        credential,
        (key) =>
          ports.call(
            CONTRACT.glossaryRemove,
            { entry: request.entry },
            credential.run,
            { compare, idempotency_key: key },
          ),
        (value) => resultOf("glossary entry removed", value),
      );
    }
    return await write(
      N.glossaryWrite,
      input,
      credential,
      (key) =>
        ports.call(
          CONTRACT.glossarySet,
          {
            entry: request.entry,
            ...(request.term === undefined ? {} : { term: request.term }),
            ...(request.meaning === undefined
              ? {}
              : { meaning: request.meaning }),
          },
          credential.run,
          { compare, idempotency_key: key },
        ),
      (value) => resultOf("glossary entry changed", value),
    );
  });

  return handlers;
}
