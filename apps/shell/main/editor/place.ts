// 문서를 파일로 두기의 main 통로(documents/file-tracking#R13, flow organize-documents). renderer는
// 문서·판·프로젝트·새 경로만 보낸다. 파일 쓰기(`files/write`)는 renderer allowlist 밖이라 여기서만
// 부른다. 쓸 바이트는 그 판의 유일한 파일 원본 참조(`existing`)이고 새 바이트를 올리지 않는다.
// core가 파일을 쓴 뒤 원본 연결·추적 규칙·자리를 각각 확정하고 단계별 결과를 돌려준다. 결과는
// 꾸미지 않고 그대로 옮긴다.
import type { EditorReply, PlaceReport, PlaceStep } from "../../ipc/editor.ts";
import type { PortError, PortResult } from "./file-adapter.ts";
import type { FixedRead, StoredFile } from "./restore.ts";

type Step =
  | { state: "done" }
  | { state: "skipped"; reason: string }
  | { state: "failed"; error: { code: string; message: string } }
  | { state: "not_attempted" };

/** files.write 결과에서 두기가 읽는 것. */
export interface PlacedResult {
  outcome: "written" | "renamed" | "deleted" | "unverified";
  after_path: string | null;
  placement?: { source: Step; tracking: Step; move: Step };
}

export interface PlacePort {
  fixed(document: string, version?: string): Promise<PortResult<FixedRead>>;
  write(request: unknown): Promise<PortResult<PlacedResult>>;
}

export interface Placer {
  place(input: {
    document: string;
    version: string;
    project: string;
    path: string;
    request_key: string;
  }): Promise<EditorReply<PlaceReport>>;
}

function failed(error: PortError): PlaceReport {
  if (error.code === "conflict") {
    return { file: "conflict", path: null, steps: null, failure: "conflict" };
  }
  // 응답을 받지 못한 쓰기는 결과를 모른다. 쓰였다고도 안 쓰였다고도 하지 않는다.
  const lost = error.code === "unavailable" &&
    error.details?.["reason"] === "transport_failed";
  return {
    file: lost ? "unknown" : "failed",
    path: null,
    steps: null,
    failure: lost
      ? "unknown"
      : error.code === "unauthorized"
      ? "forbidden"
      : error.code,
  };
}

function stepOf(step: Step): PlaceStep {
  if (step.state === "failed") {
    return { state: "failed", code: step.error.code };
  }
  return step;
}

export function createPlacer(port: () => PlacePort | null): Placer {
  return {
    async place(input) {
      const core = port();
      if (core === null) return { ok: false, code: "offline" };
      const fixed = await core.fixed(input.document, input.version);
      if (!fixed.ok) return { ok: true, value: failed(fixed.error) };
      const files = fixed.value.version.files;
      // 두기는 그 판의 유일한 파일 하나를 쓴다. 여러 파일·목록 blob인 판은 이 통로 밖이다.
      if (!Array.isArray(files) || files.length !== 1) {
        return { ok: false, code: "unsupported" };
      }
      const file: StoredFile = files[0]!;
      const written = await core.write({
        request_key: input.request_key,
        target: {
          kind: "project_file",
          project: input.project,
          path: input.path,
        },
        base_hash: null,
        content: {
          kind: "existing",
          reference: {
            owner_kind: "document_version",
            owner_key: `${input.version}/${file.path}`,
            field: "file",
            hash: file.blob_hash,
            registered_seq: "1",
          },
        },
        place: { document: input.document, version: input.version },
      });
      if (!written.ok) return { ok: true, value: failed(written.error) };
      const value = written.value;
      const steps = value.placement;
      return {
        ok: true,
        value: {
          file: value.outcome === "written" ? "written" : "unknown",
          path: value.after_path,
          steps: steps
            ? {
              source: stepOf(steps.source),
              tracking: stepOf(steps.tracking),
              move: stepOf(steps.move),
            }
            : null,
          failure: null,
        },
      };
    },
  };
}
