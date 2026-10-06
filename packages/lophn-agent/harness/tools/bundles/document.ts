import { z } from "zod";
import {
  fingerprint,
  ok,
  type Result,
  sha256Hex,
} from "../../../../base/mod.ts";
import {
  documentDiff,
  documentHistory,
  documentIdSchema,
  documentList,
  documentRead,
  fixedDocumentInputSchema,
  lineRangeSchema,
  nonblankSchema,
  outlineDocument,
  placeRefSchema,
  readCursorSchema,
  searchFilterFields,
  searchQuery,
  sectionKeySchema,
  selectedDocumentInputSchema,
  slugSchema,
  versionIdSchema,
} from "../../../../contracts/documents/mod.ts";
import {
  saveToolDocument,
  toolFormatSchema,
  type ToolResult,
  toolTextMediaTypeSchema,
  toolTextSchema,
} from "../../../../contracts/lophn-agent/mod.ts";
import { archiveStateSchema } from "../../../../contracts/platform/mod.ts";
import { limitText, PAGE_SIZE } from "../result.ts";
import { createReadLog, type ReadLog } from "./read-log.ts";
import type { ToolDefinition } from "../registry.ts";
import type { RunCredential, ToolHandler } from "../work.ts";
import {
  type ContractCall,
  defineBuiltin,
  type DefineOptions,
  READ,
} from "./common.ts";
import {
  bodyOf,
  invalid,
  pageThrough,
  resume,
  scopeOf,
  windowedResult,
  wrap,
} from "./paging.ts";

// 문서 묶음(concern harness/tools R6). tool 하나는 소유 contract 하나다. 읽기는 documents의
// 목록·목차·검색·본문·이력·차이를, 쓰기는 새 문서와 읽은 version 기준의 새 version을 부른다. 쓰기의
// 범위(원본 연결·보관·지침 문서·파일 source 금지)와 CAS는 documents/versions가 정하고 이
// 묶음은 그 규칙을 다시 만들지 않는다. Home·직접 삭제·이동·시리즈 관리·보관 tool은 없다.

export const DOCUMENT_TOOL_REVISION = "2026-10-06";

// 한 page 본문의 codepoint 수. 4 byte 문자만 있어도 24 KiB 안에 들게 24576 / 4보다 작게 둔다(R14).
export const DOCUMENT_READ_CODEPOINTS = 6000;

function define(
  name: string,
  description: string,
  input: z.ZodType,
  contract: string,
  options: DefineOptions,
): ToolDefinition {
  return defineBuiltin(
    DOCUMENT_TOOL_REVISION,
    name,
    description,
    input,
    contract,
    options,
  );
}

const cursor = { cursor: readCursorSchema.optional() };

const listInput = z.strictObject({
  place: placeRefSchema.nullable().optional(),
  status: archiveStateSchema.optional(),
  ...cursor,
});

const outlineInput = z.strictObject({
  reference: selectedDocumentInputSchema,
  depth: z.number().int().min(0).max(6).optional(),
  ...cursor,
});

const searchInput = z.strictObject({
  query: nonblankSchema,
  ...searchFilterFields,
  ...cursor,
});

const readVersionInput = z.strictObject({
  reference: fixedDocumentInputSchema.refine(
    (reference) => reference.section === null,
    { message: "a whole version has no section; use document.read_section" },
  ),
  ...cursor,
});

const readSectionInput = z.strictObject({
  reference: fixedDocumentInputSchema,
  section: sectionKeySchema,
  include_children: z.boolean().optional(),
  ...cursor,
}).refine(
  (value) =>
    value.reference.section === null ||
    value.reference.section === value.section,
  { message: "section must match the fixed reference" },
);

const MAX_RANGES = 5;
const readRangeInput = z.strictObject({
  reference: fixedDocumentInputSchema,
  ranges: z.array(lineRangeSchema).min(1).max(MAX_RANGES),
  ...cursor,
});

const historyInput = z.strictObject({
  document: documentIdSchema,
  from: versionIdSchema.optional(),
  to: versionIdSchema.optional(),
  ...cursor,
});

const diffInput = z.strictObject({
  document: documentIdSchema,
  before: versionIdSchema,
  after: versionIdSchema,
  section: sectionKeySchema.nullable().optional(),
  ...cursor,
});

// 저장 근거. relied_on은 모델이 의지한 고정 참조이고 missing은 모자란 자료의 이름이다.
// 읽었는지는 모델의 말이 아니라 이 run의 읽기 기록(handler)이 정한다(roles/common R10).
const evidenceInput = z.strictObject({
  relied_on: z.array(z.strictObject({
    document: documentIdSchema,
    version: versionIdSchema,
  })).max(20),
  missing: z.array(z.string().regex(/\S/).max(200)).max(10),
});

const createInput = z.strictObject({
  title: z.string().regex(/\S/).max(200),
  place: placeRefSchema.nullable(),
  name: slugSchema.nullable(),
  text: toolTextSchema,
  media_type: toolTextMediaTypeSchema,
  format: toolFormatSchema.optional(),
  evidence: evidenceInput.optional(),
}).refine((value) => value.place === null || value.name !== null, {
  message: "a placed document needs a name",
});

const saveVersionInput = z.strictObject({
  document: documentIdSchema,
  // 이 run이 실제로 읽은 version이다. 그 뒤 최신 판이 바뀌었으면 documents가 conflict로 막는다.
  base_version: versionIdSchema,
  text: toolTextSchema,
  media_type: toolTextMediaTypeSchema,
  evidence: evidenceInput.optional(),
});

export const documentListTool = define(
  "document.list",
  "List documents of a place you may read, newest first. This changes nothing.",
  listInput,
  documentList.name,
  { ...READ, scopeCheck: "places the assignment may read" },
);
export const documentOutlineTool = define(
  "document.outline",
  "Read the section outline of a document version: titles, sizes, and structure, without the body.",
  outlineInput,
  outlineDocument.name,
  { ...READ, scopeCheck: "documents the assignment may read" },
);
export const documentSearchTool = define(
  "document.search",
  "Search documents you may read. Results are summaries with fixed references.",
  searchInput,
  searchQuery.name,
  { ...READ, scopeCheck: "documents the assignment may read" },
);
export const documentReadVersionTool = define(
  "document.read_version",
  "Read the body of a fixed document version, one page at a time.",
  readVersionInput,
  documentRead.name,
  { ...READ, scopeCheck: "fixed versions the assignment may read" },
);
export const documentReadSectionTool = define(
  "document.read_section",
  "Read one section of a fixed document version.",
  readSectionInput,
  documentRead.name,
  { ...READ, scopeCheck: "fixed versions the assignment may read" },
);
export const documentReadRangeTool = define(
  "document.read_range",
  "Read line ranges of a fixed document version.",
  readRangeInput,
  documentRead.name,
  { ...READ, scopeCheck: "fixed versions the assignment may read" },
);
export const documentHistoryTool = define(
  "document.history",
  "List the versions of a document: who saved each, when, and in which run.",
  historyInput,
  documentHistory.name,
  { ...READ, scopeCheck: "documents the assignment may read" },
);
export const documentDiffTool = define(
  "document.diff",
  "Compare two versions of a document, whole or one section.",
  diffInput,
  documentDiff.name,
  { ...READ, scopeCheck: "documents the assignment may read" },
);
export const documentCreateTool = define(
  "document.create",
  "Create a new document with the given text. The text is stored as version 1 of the document.",
  createInput,
  saveToolDocument.name,
  {
    effect: "write",
    scopeCheck: "the places and documents this run's request covers",
    reversible: true,
    idempotent: true,
  },
);
export const documentSaveVersionTool = define(
  "document.save_version",
  "Save the given text as a new version of a document, based on a version you read first.",
  saveVersionInput,
  saveToolDocument.name,
  {
    effect: "write",
    scopeCheck: "documents this run's request covers",
    reversible: true,
    idempotent: true,
  },
);

export const DOCUMENT_READ_TOOL_NAMES: readonly string[] = [
  documentListTool.name,
  documentOutlineTool.name,
  documentSearchTool.name,
  documentReadVersionTool.name,
  documentReadSectionTool.name,
  documentReadRangeTool.name,
  documentHistoryTool.name,
  documentDiffTool.name,
];

export const DOCUMENT_WRITE_TOOL_NAMES: readonly string[] = [
  documentCreateTool.name,
  documentSaveVersionTool.name,
];

export const DOCUMENT_TOOLS: readonly ToolDefinition[] = [
  documentListTool,
  documentOutlineTool,
  documentSearchTool,
  documentReadVersionTool,
  documentReadSectionTool,
  documentReadRangeTool,
  documentHistoryTool,
  documentDiffTool,
  documentCreateTool,
  documentSaveVersionTool,
];

export type DocumentToolPorts = ContractCall;

function textBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function rangeText(
  ranges: readonly { start_line: number; end_line: number }[],
): string | null {
  return ranges.length === 0
    ? null
    : ranges.map((range) => `${range.start_line}-${range.end_line}`).join(",");
}

type Evidence = {
  relied_on: { document: string; version: string }[];
  missing: string[];
};

function evidenceOf(
  run: string,
  reads: ReadLog,
  evidence: Evidence | undefined,
) {
  const read: Evidence["relied_on"] = [];
  const notRead: Evidence["relied_on"] = [];
  for (const reference of evidence?.relied_on ?? []) {
    (reads.has(run, reference.document, reference.version) ? read : notRead)
      .push(reference);
  }
  const missing = evidence?.missing ?? [];
  return {
    read,
    not_read: notRead,
    missing,
    // 근거를 다 읽었고 모자란 자료가 없을 때만 true다. 모델의 말로 바꾸지 않는다.
    all_read: notRead.length === 0 && missing.length === 0,
  };
}

export function createDocumentToolHandlers(
  ports: DocumentToolPorts,
  reads: ReadLog = createReadLog(),
): ReadonlyMap<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const remember = reads.remember;

  handlers.set(
    documentListTool.name,
    async (input, credential) => {
      const value = input as z.infer<typeof listInput>;
      const scope = scopeOf("document.list", {
        place: value.place ?? null,
        status: value.status ?? null,
      });
      const resumed = resume(value.cursor, scope);
      if (!resumed.ok) return resumed;
      const inner = resumed.value?.inner ?? null;
      const read = await ports.call(documentList.name, {
        ...(value.place === undefined ? {} : { place: value.place }),
        ...(value.status === undefined ? {} : { status: value.status }),
        limit: PAGE_SIZE,
        ...(inner === null ? {} : { cursor: inner }),
      }, credential.run);
      if (!read.ok) return read;
      const body = bodyOf(read.value);
      const items = (body["documents"] ?? []) as unknown[];
      return ok(windowedResult(
        "documents listed",
        scope,
        "documents",
        items,
        resumed.value?.skip ?? 0,
        inner,
        body,
        { as_of_seq: body.as_of_seq ?? null },
      ));
    },
  );

  handlers.set(
    documentSearchTool.name,
    async (input, credential) => {
      const value = input as z.infer<typeof searchInput>;
      const scope = scopeOf("document.search", {
        query: value.query,
        place: value.place ?? null,
        context: value.context ?? null,
        formats: value.formats ?? null,
      });
      const resumed = resume(value.cursor, scope);
      if (!resumed.ok) return resumed;
      const inner = resumed.value?.inner ?? null;
      const read = await ports.call(searchQuery.name, {
        query: value.query,
        ...(value.place === undefined ? {} : { place: value.place }),
        ...(value.context === undefined ? {} : { context: value.context }),
        ...(value.formats === undefined ? {} : { formats: value.formats }),
        limit: PAGE_SIZE,
        ...(inner === null ? {} : { cursor: inner }),
      }, credential.run);
      if (!read.ok) return read;
      const body = bodyOf(read.value);
      const items = (body["results"] ?? []) as unknown[];
      return ok(windowedResult(
        "documents searched",
        scope,
        "results",
        items,
        resumed.value?.skip ?? 0,
        inner,
        body,
        {
          as_of_seq: body.as_of_seq ?? null,
          coverage: body["coverage"] ?? null,
        },
      ));
    },
  );

  handlers.set(
    documentHistoryTool.name,
    async (input, credential) => {
      const value = input as z.infer<typeof historyInput>;
      const scope = scopeOf("document.history", {
        document: value.document,
        from: value.from ?? null,
        to: value.to ?? null,
      });
      const resumed = resume(value.cursor, scope);
      if (!resumed.ok) return resumed;
      const inner = resumed.value?.inner ?? null;
      const read = await ports.call(documentHistory.name, {
        document: value.document,
        ...(value.from === undefined ? {} : { from: value.from }),
        ...(value.to === undefined ? {} : { to: value.to }),
        ...(inner === null ? {} : { cursor: inner }),
      }, credential.run);
      if (!read.ok) return read;
      const body = bodyOf(read.value);
      const items = (body["versions"] ?? []) as unknown[];
      return ok(windowedResult(
        "history listed",
        scope,
        "versions",
        items,
        resumed.value?.skip ?? 0,
        inner,
        body,
        { document: body["document"] ?? value.document },
      ));
    },
  );

  handlers.set(
    documentOutlineTool.name,
    (input, credential) => {
      const value = input as z.infer<typeof outlineInput>;
      return pageThrough(
        ports,
        "outline read",
        outlineDocument.name,
        scopeOf("document.outline", {
          reference: value.reference,
          depth: value.depth ?? null,
        }),
        value.cursor,
        {
          reference: value.reference,
          ...(value.depth === undefined ? {} : { depth: value.depth }),
        },
        ["entries"],
        credential,
      );
    },
  );

  handlers.set(
    documentDiffTool.name,
    (input, credential) => {
      const value = input as z.infer<typeof diffInput>;
      return pageThrough(
        ports,
        "versions compared",
        documentDiff.name,
        scopeOf("document.diff", {
          document: value.document,
          before: value.before,
          after: value.after,
          section: value.section ?? null,
        }),
        value.cursor,
        {
          document: value.document,
          before: value.before,
          after: value.after,
          section: value.section ?? null,
        },
        ["additions", "deletions", "omissions"],
        credential,
      );
    },
  );

  // 본문 읽기 셋은 같은 contract를 다른 좁은 입력으로 부른다. 한 page의 본문은 24 KiB와 300줄
  // 안으로 앞부분만 두고(R14), 덜어 낸 구간은 줄 범위로 이어 읽도록 알린다.
  async function readBody(
    summary: string,
    scope: string,
    given: string | undefined,
    selection: {
      reference: unknown;
      section: string | null;
      include_children: boolean;
      ranges: readonly { start_line: number; end_line: number }[];
    },
    credential: RunCredential,
  ): Promise<Result<ToolResult>> {
    const resumed = resume(given, scope);
    if (!resumed.ok) return resumed;
    const inner = resumed.value?.inner ?? null;
    const read = await ports.call(documentRead.name, {
      reference: selection.reference,
      section: selection.section,
      include_children: selection.include_children,
      ranges: selection.ranges,
      max_codepoints: DOCUMENT_READ_CODEPOINTS,
      ...(inner === null ? {} : { cursor: inner }),
    }, credential.run);
    if (!read.ok) return read;
    const body = bodyOf(read.value);
    const text = typeof body["text"] === "string" ? body["text"] : null;
    const limited = text === null ? null : limitText(text, "head");
    const document = String(body["document"] ?? "");
    const version = String(body["version"] ?? "");
    if (text !== null) remember(credential.run, document, version);
    const ranges = (body["ranges"] ?? []) as {
      start_line: number;
      end_line: number;
    }[];
    const cut = limited !== null && !limited.complete;
    let readNext: string | null = null;
    if (cut && ranges.length > 0 && limited !== null && text !== null) {
      const original = text.split("\n");
      const kept = limited.text.split("\n");
      const partial = original[kept.length - 1] !== kept[kept.length - 1];
      const start = ranges[0].start_line + kept.length - (partial ? 1 : 0);
      const end = ranges[ranges.length - 1].end_line;
      readNext = start <= end ? `lines ${start}-${end}` : null;
    }
    const nextInner = body.next_cursor ?? null;
    const next = cut
      ? readNext
      : nextInner === null
      ? null
      : wrap(scope, nextInner, 0);
    const format = body["format"] as { name?: string } | undefined;
    const content = {
      document,
      version,
      latest_version: body["latest_version"] ?? null,
      format: format?.name ?? null,
      section: body["section"] ?? null,
      section_status: body["section_status"] ?? null,
      include_children: body["include_children"] ?? false,
      ranges,
      text: limited === null ? null : limited.text,
      redacted: body["redacted"] ?? false,
      failure_reason: body["failure_reason"] ?? null,
      omission_reason: body["omission_reason"] ?? null,
    };
    const section = typeof content.section === "string"
      ? `#${content.section}`
      : "";
    return ok({
      status: "success",
      summary,
      content: content as unknown as ToolResult["content"],
      complete: Boolean(body["complete"]) && !cut,
      source: {
        target: `${document}${section}`,
        version,
        range: rangeText(ranges),
        original_bytes: limited?.originalBytes ?? null,
        original_lines: limited?.originalLines ?? null,
        omitted_count: cut && limited !== null ? limited.omittedCount : null,
      },
      continuation: cut || nextInner !== null
        ? { has_more: true, read_next: next }
        : null,
      pending: [],
    });
  }

  handlers.set(
    documentReadVersionTool.name,
    (input, credential) => {
      const value = input as z.infer<typeof readVersionInput>;
      return readBody(
        "version read",
        scopeOf("document.read_version", { reference: value.reference }),
        value.cursor,
        {
          reference: value.reference,
          section: null,
          include_children: false,
          ranges: [],
        },
        credential,
      );
    },
  );
  handlers.set(
    documentReadSectionTool.name,
    (input, credential) => {
      const value = input as z.infer<typeof readSectionInput>;
      return readBody(
        "section read",
        scopeOf("document.read_section", {
          reference: value.reference,
          section: value.section,
          include_children: value.include_children ?? false,
        }),
        value.cursor,
        {
          reference: value.reference,
          section: value.section,
          include_children: value.include_children ?? false,
          ranges: [],
        },
        credential,
      );
    },
  );
  handlers.set(
    documentReadRangeTool.name,
    (input, credential) => {
      const value = input as z.infer<typeof readRangeInput>;
      return readBody(
        "range read",
        scopeOf("document.read_range", {
          reference: value.reference,
          ranges: value.ranges,
        }),
        value.cursor,
        {
          reference: value.reference,
          section: null,
          include_children: false,
          ranges: value.ranges,
        },
        credential,
      );
    },
  );

  // 저장은 본문을 글 값으로 core에 넘긴다. hash·blob은 만들지 않는다. 같은 호출의 재전송이 새
  // 판이나 새 문서를 만들지 않게 idempotency key는 최초 ToolCall ID다. 모르면 호출 내용에서 정한다.
  async function idempotencyKey(
    tool: string,
    input: unknown,
    credential: RunCredential,
  ): Promise<string> {
    return credential.call ??
      `tool-${(await fingerprint([credential.run, tool, input])).slice(0, 40)}`;
  }

  async function documentIdFor(key: string): Promise<string> {
    // documents의 새 문서 ID 규칙과 같다: 같은 key는 같은 문서를 가리킨다.
    const hex = await sha256Hex(`lophn:document:${key}`);
    const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
    let value = 0n;
    for (let index = 0; index < 32; index += 2) {
      value = (value << 8n) | BigInt(parseInt(hex.slice(index, index + 2), 16));
    }
    let id = "";
    for (let position = 25; position >= 0; position -= 1) {
      id += alphabet[Number((value >> BigInt(position * 5)) & 31n)];
    }
    return `doc_${id}`;
  }

  async function save(
    tool: string,
    input: unknown,
    request: {
      document: string | null;
      base_version: string | null;
      metadata: { title: string; place: unknown; name: string | null } | null;
      text: string;
      media_type: z.infer<typeof toolTextMediaTypeSchema>;
      format: { name: string; module_hash: string } | null;
      evidence: Evidence | undefined;
    },
    credential: RunCredential,
  ): Promise<Result<ToolResult>> {
    // 읽지 않은 기준 위에는 쓰지 않는다. 사람이 그 뒤 고친 판과의 충돌은 documents가 CAS로 막는다.
    if (
      request.base_version !== null && request.document !== null &&
      !reads.has(credential.run, request.document, request.base_version)
    ) {
      return invalid("the base version was not read in this run");
    }
    const key = await idempotencyKey(tool, input, credential);
    const document = request.document ?? await documentIdFor(key);
    const sent = await ports.call(saveToolDocument.name, {
      document,
      base_version: request.base_version,
      metadata: request.metadata,
      text: request.text,
      media_type: request.media_type,
      format: request.format,
      idempotency_key: key,
    }, credential.run);
    const evidence = evidenceOf(credential.run, reads, request.evidence);
    if (!sent.ok) {
      // 응답이 없으면 접수·확정 어느 쪽도 알 수 없다. 완료로도 실패로도 보이지 않는다.
      if (sent.error.code === "unavailable") {
        return ok({
          status: "uncertain",
          summary: "the save may or may not have been confirmed",
          content: {
            accepted: null,
            version_confirmed: false,
            file_reflection: "not_applicable",
            document,
            idempotency_key: key,
            evidence,
          },
          complete: true,
          source: null,
          continuation: null,
          pending: ["version_confirmation"],
        });
      }
      return sent;
    }
    const saved = sent.value as {
      status: "saved" | "unchanged";
      document: string;
      version: string;
      reference: unknown;
      warnings: unknown[];
    };
    return ok({
      status: "success",
      summary: saved.status === "saved"
        ? "version saved"
        : "no new version: the content is the same as the latest",
      content: {
        // 접수·version 확정·파일 반영은 서로 다른 사실이다(roles/common R10). agent 출력은
        // 저장된 판일 뿐 원본 파일을 쓰지 않으므로 파일 반영은 해당 없음이다.
        accepted: true,
        version_confirmed: true,
        file_reflection: "not_applicable",
        status: saved.status,
        document: saved.document,
        version: saved.version,
        reference: saved.reference,
        warnings: saved.warnings,
        created: request.base_version === null,
        evidence,
      } as ToolResult["content"],
      complete: true,
      source: {
        target: saved.document,
        version: saved.version,
        range: null,
        original_bytes: textBytes(request.text),
        original_lines: null,
        omitted_count: null,
      },
      continuation: null,
      pending: [],
    });
  }

  handlers.set(
    documentCreateTool.name,
    (input, credential) => {
      const value = input as z.infer<typeof createInput>;
      return save(documentCreateTool.name, input, {
        document: null,
        base_version: null,
        metadata: { title: value.title, place: value.place, name: value.name },
        text: value.text,
        media_type: value.media_type,
        format: value.format ?? null,
        evidence: value.evidence,
      }, credential);
    },
  );
  handlers.set(
    documentSaveVersionTool.name,
    (input, credential) => {
      const value = input as z.infer<typeof saveVersionInput>;
      return save(documentSaveVersionTool.name, input, {
        document: value.document,
        base_version: value.base_version,
        metadata: null,
        text: value.text,
        media_type: value.media_type,
        format: null,
        evidence: value.evidence,
      }, credential);
    },
  );
  return handlers;
}
