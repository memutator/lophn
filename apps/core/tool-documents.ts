// 문서·format tool의 글 값 통로(lophn-agent/harness/tools#R6, R7, plan lophn-agent Q43). agent
// runtime은 본문을 글(UTF-8)로 싣고 hash·blob을 만들지 않는다. core가 요청 credential(agent
// 자격)로 글을 redaction해 UTF-8 bytes로 blob을 준비하고, documents의 준비·저장·검사 경로를 부른다.
// 저장은 요청한 agent의 자격으로 한다: 저장 범위(원본 연결·보관·지침 문서·파일 source 금지)와
// 기준 판 비교는 documents/versions가 정하고 여기서 다시 만들지 않는다. 준비한 blob의 hash와 크기는
// 준비 중계가 돌려준 값이고, 준비하지 못했는데 hash를 만들어 쓰는 길은 없다.
import { err, ok, type Result, sha256Hex } from "../../packages/base/mod.ts";
import {
  documentSave,
  saveResultSchema,
} from "../../packages/protocol/projects/mod.ts";
import {
  saveToolDocument,
  TOOL_TEXT_MAX_BYTES,
  TOOL_TEXT_PATHS,
  validateToolText,
} from "../../packages/protocol/lophn-agent/mod.ts";
import type {
  JsonObject,
  WorkerRequest,
  WorkerResponse,
} from "../../packages/protocol/platform/mod.ts";
import type { WorkerRouteTarget } from "../../packages/platform/responsiveness/mod.ts";
import type { KnownSecretMatch } from "../../packages/platform/ledger/mod.ts";
import type { ValidatePort } from "../../packages/documents/versions/work.ts";
import type { BlobPrepareCall } from "./core.ts";
import type { PreparedRelayResult } from "./blob-prepare.ts";
import { createProductRedactor } from "./documents-redactor.ts";
import { FORMAT_VALIDATE_PAGE } from "./documents-format-validate.ts";

// 문서 원본 파일의 blob 준비 purpose다. document.prepare의 파일 입력이 이 값을 요구한다.
const FILE_PURPOSE = "document_file";
const SOURCE = {
  concern: "lophn-agent/harness/tools",
  revision: "1",
  scope: "document-text",
};

type ErrorCode =
  | "invalid_input"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "unavailable";

const CODES: readonly string[] = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
];

function codeOf(code: string): ErrorCode {
  return CODES.includes(code) ? code as ErrorCode : "unavailable";
}

export type ToolDocumentDeps = {
  // blob 준비 중계. I/O worker가 뜨기 전에는 없다(unavailable).
  relay():
    | ((call: BlobPrepareCall) => Promise<Result<PreparedRelayResult>>)
    | undefined;
  // 알려진 secret 값의 matcher. 값을 아직 다 모르는 동안은 안전화를 끝낼 수 없어 막는다.
  known?(): KnownSecretMatch | undefined;
  // 요청 credential의 현재 principal. 폐기·만료된 자격은 없다.
  principalOf(request: WorkerRequest): string | undefined;
  // 요청한 agent의 자격으로 판을 준비·확정한다(documents-files의 version과 같은 길).
  version: {
    prepare(
      request: WorkerRequest,
      payload: unknown,
    ): Promise<Result<WorkerResponse>>;
    save(
      request: WorkerRequest,
      envelope: {
        command: string;
        input: unknown;
        idempotency_key: string;
        compare: unknown;
        prepared: string[];
      },
    ): Promise<Result<unknown>>;
  };
  // format 검사 통로. 준비 route와 같다.
  validate: ValidatePort;
  // 검사 통로와 준비 중계가 준비됐는지. worker가 뜨기 전에는 unavailable이다.
  available(): boolean;
  observedAt(): string;
  pageSize?: number;
};

function failed(
  request: WorkerRequest,
  code: ErrorCode,
  message: string,
): Result<WorkerResponse> {
  return ok({
    type: "worker_response",
    request_id: request.request_id,
    ok: false,
    error: { code, message },
  });
}

function succeeded(
  request: WorkerRequest,
  payload: JsonObject,
): Result<WorkerResponse> {
  return ok({
    type: "worker_response",
    request_id: request.request_id,
    ok: true,
    payload,
  });
}

// 글을 redaction하고 UTF-8 bytes로 준비한다. 준비 결과의 hash·크기만 쓴다.
async function prepareText(
  deps: ToolDocumentDeps,
  principal: string,
  text: string,
): Promise<
  Result<{ prepared: PreparedRelayResult; redacted: boolean }, {
    code: ErrorCode;
    message: string;
  }>
> {
  const redact = createProductRedactor(deps.known?.());
  const safe = redact(SOURCE, "text/plain", text);
  if (safe === null) {
    return err({
      code: "unavailable",
      message: "text redaction did not finish",
    });
  }
  const bytes = new TextEncoder().encode(safe);
  if (bytes.byteLength > TOOL_TEXT_MAX_BYTES || !/\S/.test(safe)) {
    return err({ code: "invalid_input", message: "text is not valid" });
  }
  const relay = deps.relay();
  if (relay === undefined) {
    return err({
      code: "unavailable",
      message: "blob preparation is not available",
    });
  }
  const prepared = await relay({
    principal,
    purpose: FILE_PURPOSE,
    expectedHash: await sha256Hex(bytes),
    bytes: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  });
  if (!prepared.ok) {
    return err({
      code: prepared.error.code === "invalid_input"
        ? "invalid_input"
        : "unavailable",
      message: "text could not be prepared",
    });
  }
  return ok({ prepared: prepared.value, redacted: safe !== text });
}

export function toolDocumentWorkers(
  deps: ToolDocumentDeps,
): ReadonlyMap<string, WorkerRouteTarget> {
  const pageSize = deps.pageSize ?? FORMAT_VALIDATE_PAGE;
  const observation = () => ({
    component: "lophn-agent/tool-documents",
    available: deps.available(),
    observed_at: deps.observedAt(),
  });

  async function save(request: WorkerRequest): Promise<Result<WorkerResponse>> {
    const parsed = saveToolDocument.input.safeParse(request.payload);
    if (!parsed.success) {
      return failed(request, "invalid_input", "invalid save input");
    }
    const input = parsed.data;
    const principal = deps.principalOf(request);
    if (principal === undefined || !principal.startsWith("agent:")) {
      return failed(request, "unauthorized", "credential이 없다");
    }
    const text = await prepareText(deps, principal, input.text);
    if (!text.ok) return failed(request, text.error.code, text.error.message);
    const blob = text.value.prepared;
    const prepared = await deps.version.prepare(request, {
      document: input.document,
      base_version: input.base_version,
      ...(input.base_version === null ? { metadata: input.metadata } : {}),
      files: [{
        path: TOOL_TEXT_PATHS[input.media_type],
        blob_hash: blob.hash,
        bytes: blob.size_bytes,
        media_type: input.media_type,
        primary: true,
        content: { kind: "prepared", blob },
      }],
      ...(input.format === null
        ? {}
        : { format: { ...input.format, explicit: true } }),
      source: null,
      idempotency_key: input.idempotency_key,
    });
    if (!prepared.ok) {
      return failed(request, codeOf(prepared.error.code), "prepare failed");
    }
    if (!prepared.value.ok) {
      return failed(
        request,
        codeOf(prepared.value.error.code),
        prepared.value.error.message,
      );
    }
    const version = prepared.value.payload as {
      preparation_ref: string;
      files: readonly { preparation_ref?: string }[];
    };
    const saved = await deps.version.save(request, {
      command: documentSave.name,
      input: version,
      idempotency_key: input.idempotency_key,
      compare: { base_version: input.base_version },
      prepared: [
        version.preparation_ref,
        ...version.files.flatMap((file) =>
          file.preparation_ref === undefined ? [] : [file.preparation_ref]
        ),
      ],
    });
    if (!saved.ok) {
      return failed(request, codeOf(saved.error.code), "save failed");
    }
    const result = saveResultSchema.safeParse(
      (saved.value as { result?: unknown }).result,
    );
    if (!result.success) {
      return failed(request, "unavailable", "save result is not readable");
    }
    return succeeded(request, result.data as JsonObject);
  }

  async function validate(
    request: WorkerRequest,
  ): Promise<Result<WorkerResponse>> {
    const parsed = validateToolText.input.safeParse(request.payload);
    if (!parsed.success) {
      return failed(request, "invalid_input", "invalid validate input");
    }
    const input = parsed.data;
    const principal = deps.principalOf(request);
    if (principal === undefined || !principal.startsWith("agent:")) {
      return failed(request, "unauthorized", "credential이 없다");
    }
    const offset = input.cursor === undefined
      ? 0
      : /^\d+$/.test(input.cursor)
      ? Number(input.cursor)
      : undefined;
    if (offset === undefined) {
      return failed(request, "invalid_input", "invalid cursor");
    }
    const text = await prepareText(deps, principal, input.text);
    if (!text.ok) return failed(request, text.error.code, text.error.message);
    const blob = text.value.prepared;
    // 검사만 한다. Document·Version·준비 참조를 만들지 않는다. 준비한 blob은 참조가 없어 만료로 정리된다.
    const ran = await deps.validate([{
      path: TOOL_TEXT_PATHS[input.media_type],
      blob_hash: blob.hash,
      bytes: blob.size_bytes,
      media_type: input.media_type,
      primary: true,
    }], { ...input.format, explicit: true });
    if (!ran.ok) {
      return failed(
        request,
        ran.error.code === "not_found" || ran.error.code === "invalid_input"
          ? ran.error.code
          : "unavailable",
        ran.error.message,
      );
    }
    const outcome = ran.value;
    const total = outcome.diagnostics.length;
    if (offset > total) {
      return failed(request, "invalid_input", "cursor is past the end");
    }
    const slice = outcome.diagnostics.slice(offset, offset + pageSize);
    const end = offset + slice.length;
    const complete = end >= total;
    return succeeded(request, {
      input_hash: outcome.input_hash,
      module_hash: outcome.module_hash,
      status: outcome.status,
      error_count: outcome.error_count,
      warning_count: outcome.warning_count,
      diagnostics_offset: offset,
      diagnostics: slice,
      complete,
      next_cursor: complete ? null : String(end),
    });
  }

  const handle = (
    forward: (request: WorkerRequest) => Promise<Result<WorkerResponse>>,
    op: string,
  ) => ({
    observation,
    forward(request: WorkerRequest): Promise<Result<WorkerResponse>> {
      if (request.op !== op) {
        return Promise.resolve(
          err({ code: "invalid_input", message: "unknown tool document op" }),
        );
      }
      return forward(request);
    },
  });

  return new Map<string, WorkerRouteTarget>([
    [`${saveToolDocument.resource}/${saveToolDocument.method}`, {
      handle: handle(save, saveToolDocument.name),
    }],
    [`${validateToolText.resource}/${validateToolText.method}`, {
      handle: handle(validate, validateToolText.name),
    }],
  ]);
}
