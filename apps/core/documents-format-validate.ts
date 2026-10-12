// `/v1/formats/validate` worker route 조립(coding-agent#T14, mcp#R14). 제출한 파일 bytes를
// 저장 없이 format 실행으로 검사한다. 준비 route와 같은 검사 통로(documents-validate.ts)를
// 쓴다: 원문 blob은 I/O worker에서 읽어 documents coordinator의 format runner로 간다.
// 판·문서·준비 참조는 만들지 않는다. blob은 요청 credential이 upload로 준비해 아직 살아
// 있는 것만 읽는다(hash는 읽기 권한이 아니다).
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  type ContentFile,
  formatValidate,
} from "../../packages/protocol/projects/mod.ts";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../../packages/protocol/platform/mod.ts";
import type { WorkerRouteHandle } from "../../packages/platform/responsiveness/mod.ts";
import type { ValidatePort } from "../../packages/documents/versions/work.ts";

// 한 응답에 싣는 진단 수다. 더 있으면 cursor로 이어 읽는다. cursor는 진단 위치다.
export const FORMAT_VALIDATE_PAGE = 100;

export type FormatValidateDeps = {
  validate: ValidatePort;
  // 요청 credential의 현재 principal. 폐기·만료된 자격은 없다.
  principalOf(request: WorkerRequest): string | undefined;
  // 이 주체·purpose·내용의 준비가 아직 살아 있는지.
  live(prepared: { principal: string; purpose: string; hash: string }): boolean;
  // 검사 통로가 준비됐는지. worker가 뜨기 전에는 unavailable이다.
  available(): boolean;
  observedAt(): string;
  pageSize?: number;
};

function failed(
  request: WorkerRequest,
  code: "invalid_input" | "unauthorized" | "not_found" | "unavailable",
  message: string,
): Result<WorkerResponse> {
  return ok({
    type: "worker_response",
    request_id: request.request_id,
    ok: false,
    error: { code, message },
  });
}

function offsetOf(cursor: string | undefined): number | undefined {
  if (cursor === undefined) return 0;
  return /^\d+$/.test(cursor) ? Number(cursor) : undefined;
}

export function formatValidateRoute(
  deps: FormatValidateDeps,
): { key: string; handle: WorkerRouteHandle } {
  const pageSize = deps.pageSize ?? FORMAT_VALIDATE_PAGE;
  async function forward(
    request: WorkerRequest,
  ): Promise<Result<WorkerResponse>> {
    if (request.op !== formatValidate.name) {
      return err({ code: "invalid_input", message: "unknown validate op" });
    }
    const parsed = formatValidate.input.safeParse(request.payload);
    if (!parsed.success) {
      return failed(request, "invalid_input", "invalid validate input");
    }
    const input = parsed.data;
    const principal = deps.principalOf(request);
    if (principal === undefined) {
      return failed(request, "unauthorized", "credential이 없다");
    }
    const offset = offsetOf(input.cursor);
    if (offset === undefined) {
      return failed(request, "invalid_input", "invalid cursor");
    }
    const files: ContentFile[] = [];
    for (const file of input.files) {
      // 요청 주체가 upload로 준비해 아직 살아 있는 blob만 읽는다. 없거나 남의 것이면
      // 없는 것과 같은 답이다.
      const blob = file.content.kind === "prepared"
        ? file.content.blob
        : undefined;
      if (
        blob === undefined || blob.principal !== principal ||
        !deps.live({
          principal,
          purpose: blob.purpose,
          hash: file.blob_hash,
        })
      ) {
        return failed(
          request,
          "invalid_input",
          "validation input not available",
        );
      }
      files.push({
        path: file.path,
        blob_hash: file.blob_hash,
        bytes: file.bytes,
        media_type: file.media_type,
        primary: file.primary,
      });
    }
    const ran = await deps.validate(files, {
      name: input.name,
      module_hash: input.module_hash,
      explicit: input.explicit,
    });
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
    return ok({
      type: "worker_response",
      request_id: request.request_id,
      ok: true,
      payload: {
        input_hash: outcome.input_hash,
        module_hash: outcome.module_hash,
        status: outcome.status,
        error_count: outcome.error_count,
        warning_count: outcome.warning_count,
        diagnostics_offset: offset,
        diagnostics: slice,
        complete,
        next_cursor: complete ? null : String(end),
      },
    });
  }
  return {
    key: `${formatValidate.resource}/${formatValidate.method}`,
    handle: {
      observation: () => ({
        component: "documents/format-validate",
        available: deps.available(),
        observed_at: deps.observedAt(),
      }),
      forward,
    },
  };
}
