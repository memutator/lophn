import { z } from "zod";
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  agentTermEvidenceListSchema,
  contextArchive,
  contextCreate,
  contextGet,
  contextIdSchema,
  contextItemSchema,
  contextList,
  contextRelated,
  contextRemoveItem,
  contextSetItem,
  contextTargetSchema,
  contextUpdate,
  documentIdSchema,
  outlineContext,
  readCursorSchema,
  revisionSchema,
  sectionKeySchema,
  termArchive,
  termGet,
  termIdSchema,
  termList,
  termPropose,
  termUpdate,
} from "../../../../contracts/documents/mod.ts";
import type { ToolResult } from "../../../../contracts/lophn-agent/mod.ts";
import { fitJson, PAGE_SIZE } from "../result.ts";
import type { ToolDefinition } from "../registry.ts";
import type { RunCredential, ToolHandler } from "../work.ts";
import {
  type ContractCall,
  defineBuiltin,
  type DefineOptions,
  idFromKey,
  READ,
  toolIdempotencyKey,
} from "./common.ts";
import {
  bodyOf,
  invalid,
  pageThrough,
  resume,
  scopeOf,
  windowedResult,
} from "./paging.ts";
import type { ReadLog } from "./read-log.ts";
import { createReadLog } from "./read-log.ts";

// context·term 묶음(concern harness/tools, roles/context-engineer R4·R5). tool 하나는 소유 contract
// 하나다. 읽기는 context 목록·읽기·항목·용어·문서 소속과 용어 읽기이고, 쓰기는 되돌릴 수 있는 context
// 생성·이름·목적·보관·항목 변경과 용어 후보 관리다. 쓰기는 이 run이 실제로 읽은 revision을 기준으로
// 하고(읽기 기록), 그 뒤 revision이 바뀌었으면 documents가 conflict로 막는다. 정의는 이 묶음에
// 쓰는 길이 없다: 후보 tool은 이름·근거만 받고 정의 확정(`term.define`)은 사람 답을 적용하는
// 경로(lophn-agent/questions의 option action)만 한다. 이 묶음은 그 규칙을 다시 만들지 않는다.
// 새 context·term ID와 idempotency key는 호출 내용에서 정하고 본문 hash·blob은 만들지 않는다.

export const CONTEXT_TOOL_REVISION = "2026-10-06";

function define(
  name: string,
  description: string,
  input: z.ZodType,
  contract: string,
  options: DefineOptions,
): ToolDefinition {
  return defineBuiltin(
    CONTEXT_TOOL_REVISION,
    name,
    description,
    input,
    contract,
    options,
  );
}

const READ_SCOPE = "contexts and terms the assignment may read";
const WRITE_SCOPE = "contexts and terms the assignment may change";
const WRITE = {
  effect: "write",
  scopeCheck: WRITE_SCOPE,
  reversible: true,
  idempotent: true,
} as const;

const cursor = { cursor: readCursorSchema.optional() };
const text = (max: number) => z.string().regex(/\S/).max(max);

const listInput = z.strictObject({
  status: z.enum(["active", "archived", "all"]).optional(),
  ...cursor,
});
const readInput = z.strictObject({ context: contextIdSchema });
const itemsInput = z.strictObject({ context: contextIdSchema, ...cursor });
const termsInput = itemsInput;
const membershipInput = z.strictObject({
  document: documentIdSchema,
  section: sectionKeySchema.nullable().optional(),
  status: z.enum(["active", "archived", "all"]).optional(),
  ...cursor,
});
const termReadInput = z.strictObject({ term: termIdSchema });

// 읽은 revision이 변경의 기준이다. 모델이 지어낸 값이 아니라 이 run의 읽기 기록이 정한다.
const base = { base_revision: revisionSchema };
const MAX_ITEMS = 50;
const createInput = z.strictObject({
  title: text(200),
  purpose: text(2000),
  items: z.array(contextItemSchema).max(MAX_ITEMS).optional(),
});
const renameInput = z.strictObject({
  context: contextIdSchema,
  title: text(200),
  ...base,
});
const purposeInput = z.strictObject({
  context: contextIdSchema,
  purpose: text(2000),
  ...base,
});
const archiveInput = z.strictObject({ context: contextIdSchema, ...base });
const itemInput = z.strictObject({
  context: contextIdSchema,
  item: contextItemSchema,
  ...base,
});
const addItemInput = z.strictObject({
  context: contextIdSchema,
  item: contextItemSchema,
  position: z.number().int().min(0).max(MAX_ITEMS).optional(),
  ...base,
});
const removeItemInput = z.strictObject({
  context: contextIdSchema,
  target: contextTargetSchema,
  ...base,
});

// 후보 근거는 후보당 최대 5개다(roles/context-engineer R8).
export const TERM_EVIDENCE_MAX = 5;
const evidenceInput = agentTermEvidenceListSchema.refine(
  (items) => items.length <= TERM_EVIDENCE_MAX,
  { message: `a candidate has at most ${TERM_EVIDENCE_MAX} evidence places` },
);
const proposeInput = z.strictObject({
  context: contextIdSchema,
  name: text(200),
  evidence: evidenceInput,
});
const updateCandidateInput = z.strictObject({
  term: termIdSchema,
  name: text(200).optional(),
  evidence: evidenceInput.optional(),
  ...base,
}).refine(
  (value) => value.name !== undefined || value.evidence !== undefined,
  { message: "update must change the name or the evidence" },
);
const removeCandidateInput = z.strictObject({ term: termIdSchema, ...base });

export const contextListTool = define(
  "context.list",
  "List contexts: id, title, purpose, status, and revision. This changes nothing.",
  listInput,
  contextList.name,
  { ...READ, scopeCheck: READ_SCOPE },
);
export const contextReadTool = define(
  "context.read",
  "Read one context: purpose, status, revision, and its items with perspective and reason. The revision is the base of a later change.",
  readInput,
  contextGet.name,
  { ...READ, scopeCheck: READ_SCOPE },
);
export const contextItemsTool = define(
  "context.items",
  "Read the items of a context as an outline: fixed versions and section status per item, basis items first. This changes nothing.",
  itemsInput,
  outlineContext.name,
  { ...READ, scopeCheck: READ_SCOPE },
);
export const contextTermsTool = define(
  "context.terms",
  "Read the terms of a context: people-defined terms and agent candidates, kept apart. This changes nothing.",
  termsInput,
  termList.name,
  { ...READ, scopeCheck: READ_SCOPE },
);
export const contextDocumentMembershipTool = define(
  "context.document_membership",
  "List the contexts that hold a document or one of its sections as an item. This changes nothing.",
  membershipInput,
  contextRelated.name,
  { ...READ, scopeCheck: READ_SCOPE },
);
export const termReadTool = define(
  "term.read",
  "Read one term: name, definition or none, evidence, and revision.",
  termReadInput,
  termGet.name,
  { ...READ, scopeCheck: READ_SCOPE },
);

export const contextCreateTool = define(
  "context.create",
  "Create a context with a purpose and optional items. A created context can be archived, not deleted.",
  createInput,
  contextCreate.name,
  WRITE,
);
export const contextRenameTool = define(
  "context.rename",
  "Change the title of a context you read.",
  renameInput,
  contextUpdate.name,
  WRITE,
);
export const contextSetPurposeTool = define(
  "context.set_purpose",
  "Change the purpose of a context you read.",
  purposeInput,
  contextUpdate.name,
  WRITE,
);
export const contextArchiveTool = define(
  "context.archive",
  "Archive a context you read. Items, documents, and terms are not changed.",
  archiveInput,
  contextArchive.name,
  WRITE,
);
export const contextAddItemTool = define(
  "context.add_item",
  "Add a document, section, or read app command to a context you read, with a perspective (basis, reference, or watch) and a reason.",
  addItemInput,
  contextSetItem.name,
  WRITE,
);
export const contextUpdateItemTool = define(
  "context.update_item",
  "Change the perspective or reason of an item of a context you read.",
  itemInput,
  contextSetItem.name,
  WRITE,
);
export const contextRemoveItemTool = define(
  "context.remove_item",
  "Remove an item from a context you read. The document or app command is not changed.",
  removeItemInput,
  contextRemoveItem.name,
  WRITE,
);
export const termProposeCandidateTool = define(
  "term.propose_candidate",
  "Propose a term candidate: a name with up to 5 evidence places in fixed versions you read. It has no definition.",
  proposeInput,
  termPropose.name,
  WRITE,
);
export const termUpdateCandidateTool = define(
  "term.update_candidate",
  "Change the name or the evidence of a term candidate you read. A defined term is never changed here.",
  updateCandidateInput,
  termUpdate.name,
  WRITE,
);
export const termRemoveCandidateTool = define(
  "term.remove_candidate",
  "Archive a term candidate you read. A defined term is never archived here.",
  removeCandidateInput,
  termArchive.name,
  WRITE,
);

export const CONTEXT_READ_TOOL_NAMES: readonly string[] = [
  contextListTool.name,
  contextReadTool.name,
  contextItemsTool.name,
  contextTermsTool.name,
  contextDocumentMembershipTool.name,
  termReadTool.name,
];

export const CONTEXT_WRITE_TOOL_NAMES: readonly string[] = [
  contextCreateTool.name,
  contextRenameTool.name,
  contextSetPurposeTool.name,
  contextArchiveTool.name,
  contextAddItemTool.name,
  contextUpdateItemTool.name,
  contextRemoveItemTool.name,
  termProposeCandidateTool.name,
  termUpdateCandidateTool.name,
  termRemoveCandidateTool.name,
];

export const CONTEXT_TOOLS: readonly ToolDefinition[] = [
  contextListTool,
  contextReadTool,
  contextItemsTool,
  contextTermsTool,
  contextDocumentMembershipTool,
  termReadTool,
  contextCreateTool,
  contextRenameTool,
  contextSetPurposeTool,
  contextArchiveTool,
  contextAddItemTool,
  contextUpdateItemTool,
  contextRemoveItemTool,
  termProposeCandidateTool,
  termUpdateCandidateTool,
  termRemoveCandidateTool,
];

export type ContextToolPorts = ContractCall;

type Target = z.infer<typeof contextTargetSchema>;
type ContextRecord = {
  id: string;
  title: string;
  purpose: string;
  status: string;
  revision: string;
  items: { target: Target; perspective: string; reason: string }[];
};
type TermRecord = {
  id: string;
  context: string;
  name: string;
  definition: string | null;
  revision: string;
  status: string;
  evidence: unknown[];
};

function sameTarget(left: Target, right: Target): boolean {
  return left.kind === "document" && right.kind === "document"
    ? left.document === right.document &&
      (left.section ?? null) === (right.section ?? null)
    : left.kind === "app_command" && right.kind === "app_command" &&
      left.app === right.app && left.command === right.command;
}

function summaryOf(context: ContextRecord) {
  return {
    id: context.id,
    title: context.title,
    purpose: context.purpose,
    status: context.status,
    revision: context.revision,
    item_count: context.items.length,
  };
}

function fitted(
  summary: string,
  value: Record<string, unknown>,
  arrayKeys: readonly string[],
): ToolResult {
  const limited = fitJson(value, arrayKeys);
  return {
    status: "success",
    summary,
    content: limited.content as ToolResult["content"],
    complete: limited.complete,
    source: null,
    continuation: null,
    pending: [],
  };
}

export function createContextToolHandlers(
  ports: ContextToolPorts,
  reads: ReadLog = createReadLog(),
): ReadonlyMap<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  handlers.set(
    contextListTool.name,
    async (input, credential) => {
      const value = input as z.infer<typeof listInput>;
      const scope = scopeOf("context.list", { status: value.status ?? null });
      const resumed = resume(value.cursor, scope);
      if (!resumed.ok) return resumed;
      const inner = resumed.value?.inner ?? null;
      const read = await ports.call(contextList.name, {
        ...(value.status === undefined ? {} : { status: value.status }),
        limit: PAGE_SIZE,
        ...(inner === null ? {} : { cursor: inner }),
      }, credential.run);
      if (!read.ok) return read;
      const body = bodyOf(read.value);
      const contexts = ((body["contexts"] ?? []) as ContextRecord[]).map(
        summaryOf,
      );
      return ok(windowedResult(
        "contexts listed",
        scope,
        "contexts",
        contexts,
        resumed.value?.skip ?? 0,
        inner,
        body,
        { as_of_seq: body.as_of_seq ?? null },
      ));
    },
  );

  handlers.set(
    contextReadTool.name,
    async (input, credential) => {
      const value = input as z.infer<typeof readInput>;
      const read = await ports.call(contextGet.name, value, credential.run);
      if (!read.ok) return read;
      const body = bodyOf(read.value);
      const context = body["context"] as ContextRecord;
      reads.remember(credential.run, context.id, context.revision);
      return ok(fitted("context read", {
        context: {
          id: context.id,
          title: context.title,
          purpose: context.purpose,
          status: context.status,
          revision: context.revision,
        },
        items: context.items,
        as_of_seq: body.as_of_seq ?? null,
      }, ["items"]));
    },
  );

  handlers.set(
    contextItemsTool.name,
    async (input, credential) => {
      const value = input as z.infer<typeof itemsInput>;
      const scope = scopeOf("context.items", { context: value.context });
      const resumed = resume(value.cursor, scope);
      if (!resumed.ok) return resumed;
      const inner = resumed.value?.inner ?? null;
      const read = await ports.call(outlineContext.name, {
        context: value.context,
        ...(inner === null ? {} : { cursor: inner }),
      }, credential.run);
      if (!read.ok) return read;
      const body = bodyOf(read.value);
      return ok(windowedResult(
        "context items read",
        scope,
        "entries",
        (body["entries"] ?? []) as unknown[],
        resumed.value?.skip ?? 0,
        inner,
        body,
        {
          context: body["context"] ?? value.context,
          title: body["title"] ?? null,
          purpose: body["purpose"] ?? null,
          basis_seq: body["basis_seq"] ?? null,
          coverage: body["coverage"] ?? null,
        },
      ));
    },
  );

  handlers.set(
    contextTermsTool.name,
    (input, credential) => {
      const value = input as z.infer<typeof termsInput>;
      return pageThrough(
        ports,
        "terms read",
        termList.name,
        scopeOf("context.terms", { context: value.context }),
        value.cursor,
        { context: value.context },
        ["definitions", "candidates"],
        credential,
      ).then((result) => {
        if (!result.ok) return result;
        // 읽은 용어의 revision은 후보 변경의 기준이다.
        const content = result.value.content as {
          definitions?: TermRecord[];
          candidates?: TermRecord[];
        } | null;
        for (
          const term of [
            ...(content?.definitions ?? []),
            ...(content?.candidates ?? []),
          ]
        ) {
          reads.remember(credential.run, term.id, term.revision);
        }
        return result;
      });
    },
  );

  handlers.set(
    contextDocumentMembershipTool.name,
    async (input, credential) => {
      const value = input as z.infer<typeof membershipInput>;
      const target = {
        kind: "document" as const,
        document: value.document,
        section: value.section ?? null,
      };
      const scope = scopeOf("context.document_membership", {
        target,
        status: value.status ?? null,
      });
      const resumed = resume(value.cursor, scope);
      if (!resumed.ok) return resumed;
      const inner = resumed.value?.inner ?? null;
      const read = await ports.call(contextRelated.name, {
        target,
        ...(value.status === undefined ? {} : { status: value.status }),
        limit: PAGE_SIZE,
        ...(inner === null ? {} : { cursor: inner }),
      }, credential.run);
      if (!read.ok) return read;
      const body = bodyOf(read.value);
      const contexts = ((body["contexts"] ?? []) as ContextRecord[]).map(
        summaryOf,
      );
      return ok(windowedResult(
        "contexts holding the target listed",
        scope,
        "contexts",
        contexts,
        resumed.value?.skip ?? 0,
        inner,
        body,
        { target, as_of_seq: body.as_of_seq ?? null },
      ));
    },
  );

  handlers.set(
    termReadTool.name,
    async (input, credential) => {
      const value = input as z.infer<typeof termReadInput>;
      const read = await ports.call(termGet.name, value, credential.run);
      if (!read.ok) return read;
      const body = bodyOf(read.value);
      const term = body["term"] as TermRecord;
      reads.remember(credential.run, term.id, term.revision);
      return ok(fitted("term read", {
        term,
        as_of_seq: body.as_of_seq ?? null,
      }, ["evidence"]));
    },
  );

  // 변경 하나의 공통 길이다. 읽은 기준이 아니면 소유 contract를 부르지 않는다. 응답이 없으면 반영
  // 여부를 알 수 없으므로 완료도 실패도 아닌 효과 불명확으로 돌려준다(R11).
  async function change(
    tool: ToolDefinition,
    input: unknown,
    request: {
      id: string;
      subject: "context" | "term";
      baseRevision: string | null;
      body: Record<string, unknown>;
      creates: boolean;
    },
    credential: RunCredential,
  ): Promise<Result<ToolResult>> {
    if (
      request.baseRevision !== null &&
      !reads.has(credential.run, request.id, request.baseRevision)
    ) {
      return invalid("the base revision was not read in this run");
    }
    const key = await toolIdempotencyKey(tool.name, input, credential);
    const sent = await ports.call(tool.contract, request.body, credential.run, {
      compare: request.baseRevision === null
        ? {}
        : { base_revision: request.baseRevision },
      idempotency_key: key,
    });
    if (!sent.ok) {
      if (sent.error.code === "unavailable") {
        return ok({
          status: "uncertain",
          summary: "the change may or may not have been confirmed",
          content: {
            accepted: null,
            confirmed: false,
            [request.subject]: request.id,
            idempotency_key: key,
          },
          complete: true,
          source: null,
          continuation: null,
          pending: ["change_confirmation"],
        });
      }
      return sent;
    }
    const stored = sent.value as ContextRecord | TermRecord;
    // 이 run이 만든 새 revision은 다음 변경의 기준으로 이미 알고 있다.
    reads.remember(credential.run, stored.id, stored.revision);
    return ok({
      status: "success",
      summary: request.creates ? `${request.subject} created` : "change saved",
      content: {
        accepted: true,
        confirmed: true,
        created: request.creates,
        [request.subject]: request.subject === "context"
          ? summaryOf(stored as ContextRecord)
          : stored,
      } as unknown as ToolResult["content"],
      complete: true,
      source: null,
      continuation: null,
      pending: [],
    });
  }

  // 항목 추가와 항목 변경은 같은 contract(`context.set_item`)를 부르지만 뜻이 다르다. 이미 있는
  // 항목을 추가하거나 없는 항목을 변경하지 않게 같은 revision의 현재 항목을 읽어 확인한다.
  async function currentContext(
    context: string,
    revision: string,
    credential: RunCredential,
  ): Promise<Result<ContextRecord>> {
    const read = await ports.call(contextGet.name, { context }, credential.run);
    if (!read.ok) return read;
    const current = bodyOf(read.value)["context"] as ContextRecord;
    return current.revision === revision ? ok(current) : err({
      code: "conflict",
      message: "the context changed since it was read",
    });
  }

  handlers.set(
    contextCreateTool.name,
    async (input, credential) => {
      const value = input as z.infer<typeof createInput>;
      const key = await toolIdempotencyKey(
        contextCreateTool.name,
        input,
        credential,
      );
      const id = await idFromKey("ctx", key);
      return change(contextCreateTool, input, {
        id,
        subject: "context",
        baseRevision: null,
        body: {
          id,
          title: value.title,
          purpose: value.purpose,
          items: value.items ?? [],
        },
        creates: true,
      }, credential);
    },
  );
  handlers.set(
    contextRenameTool.name,
    (input, credential) => {
      const value = input as z.infer<typeof renameInput>;
      return change(contextRenameTool, input, {
        id: value.context,
        subject: "context",
        baseRevision: value.base_revision,
        body: { context: value.context, title: value.title },
        creates: false,
      }, credential);
    },
  );
  handlers.set(
    contextSetPurposeTool.name,
    (input, credential) => {
      const value = input as z.infer<typeof purposeInput>;
      return change(contextSetPurposeTool, input, {
        id: value.context,
        subject: "context",
        baseRevision: value.base_revision,
        body: { context: value.context, purpose: value.purpose },
        creates: false,
      }, credential);
    },
  );
  handlers.set(
    contextArchiveTool.name,
    (input, credential) => {
      const value = input as z.infer<typeof archiveInput>;
      return change(contextArchiveTool, input, {
        id: value.context,
        subject: "context",
        baseRevision: value.base_revision,
        body: { context: value.context },
        creates: false,
      }, credential);
    },
  );
  handlers.set(
    contextAddItemTool.name,
    async (input, credential) => {
      const value = input as z.infer<typeof addItemInput>;
      if (!reads.has(credential.run, value.context, value.base_revision)) {
        return invalid("the base revision was not read in this run");
      }
      const current = await currentContext(
        value.context,
        value.base_revision,
        credential,
      );
      if (!current.ok) return current;
      if (
        current.value.items.some((item) =>
          sameTarget(item.target, value.item.target)
        )
      ) {
        return invalid("the context already has this item; update it instead");
      }
      return change(contextAddItemTool, input, {
        id: value.context,
        subject: "context",
        baseRevision: value.base_revision,
        body: {
          context: value.context,
          item: value.item,
          ...(value.position === undefined ? {} : { position: value.position }),
        },
        creates: false,
      }, credential);
    },
  );
  handlers.set(
    contextUpdateItemTool.name,
    async (input, credential) => {
      const value = input as z.infer<typeof itemInput>;
      if (!reads.has(credential.run, value.context, value.base_revision)) {
        return invalid("the base revision was not read in this run");
      }
      const current = await currentContext(
        value.context,
        value.base_revision,
        credential,
      );
      if (!current.ok) return current;
      if (
        !current.value.items.some((item) =>
          sameTarget(item.target, value.item.target)
        )
      ) {
        return err({ code: "not_found", message: "context item not found" });
      }
      return change(contextUpdateItemTool, input, {
        id: value.context,
        subject: "context",
        baseRevision: value.base_revision,
        body: { context: value.context, item: value.item },
        creates: false,
      }, credential);
    },
  );
  handlers.set(
    contextRemoveItemTool.name,
    (input, credential) => {
      const value = input as z.infer<typeof removeItemInput>;
      return change(contextRemoveItemTool, input, {
        id: value.context,
        subject: "context",
        baseRevision: value.base_revision,
        body: { context: value.context, target: value.target },
        creates: false,
      }, credential);
    },
  );

  // 후보의 근거는 이 run이 본문을 실제로 읽은 고정 판이어야 한다. 읽었는지는 모델의 말이 아니라 읽기
  // 기록이 정한다. 읽지 않은 판은 소유 contract에 보내지 않는다.
  function evidenceRead(
    run: string,
    evidence: readonly { document: string; version: string }[],
  ): Result<void> {
    return evidence.every((item) => reads.has(run, item.document, item.version))
      ? ok(undefined)
      : invalid("the evidence version was not read in this run");
  }

  // 후보만 이 묶음이 다룬다. 사람이 정의한 용어는 이름·근거도 보관도 여기서 바꾸지 않는다.
  async function candidateOf(
    term: string,
    credential: RunCredential,
  ): Promise<Result<TermRecord>> {
    const read = await ports.call(termGet.name, { term }, credential.run);
    if (!read.ok) return read;
    const found = bodyOf(read.value)["term"] as TermRecord;
    return found.definition === null ? ok(found) : invalid(
      "only a term candidate can be changed here",
    );
  }

  handlers.set(
    termProposeCandidateTool.name,
    async (input, credential) => {
      const value = input as z.infer<typeof proposeInput>;
      const evidence = evidenceRead(credential.run, value.evidence);
      if (!evidence.ok) return evidence;
      const key = await toolIdempotencyKey(
        termProposeCandidateTool.name,
        input,
        credential,
      );
      const id = await idFromKey("trm", key);
      return change(termProposeCandidateTool, input, {
        id,
        subject: "term",
        baseRevision: null,
        body: {
          id,
          context: value.context,
          name: value.name,
          evidence: value.evidence,
        },
        creates: true,
      }, credential);
    },
  );
  handlers.set(
    termUpdateCandidateTool.name,
    async (input, credential) => {
      const value = input as z.infer<typeof updateCandidateInput>;
      if (!reads.has(credential.run, value.term, value.base_revision)) {
        return invalid("the base revision was not read in this run");
      }
      const evidence = evidenceRead(credential.run, value.evidence ?? []);
      if (!evidence.ok) return evidence;
      const candidate = await candidateOf(value.term, credential);
      if (!candidate.ok) return candidate;
      return change(termUpdateCandidateTool, input, {
        id: value.term,
        subject: "term",
        baseRevision: value.base_revision,
        body: {
          term: value.term,
          ...(value.name === undefined ? {} : { name: value.name }),
          ...(value.evidence === undefined ? {} : { evidence: value.evidence }),
        },
        creates: false,
      }, credential);
    },
  );
  handlers.set(
    termRemoveCandidateTool.name,
    async (input, credential) => {
      const value = input as z.infer<typeof removeCandidateInput>;
      if (!reads.has(credential.run, value.term, value.base_revision)) {
        return invalid("the base revision was not read in this run");
      }
      const candidate = await candidateOf(value.term, credential);
      if (!candidate.ok) return candidate;
      return change(termRemoveCandidateTool, input, {
        id: value.term,
        subject: "term",
        baseRevision: value.base_revision,
        body: { term: value.term },
        creates: false,
      }, credential);
    },
  );
  return handlers;
}
