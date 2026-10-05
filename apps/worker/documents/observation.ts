// 파일 관측 하나를 Version까지 올리는 제출. 안정 읽기 결과(hash·바이트)를 blob으로
// 준비하고, 공통 준비 경로(`document.prepare`)로 PreparedVersion을 받고, machine
// `document.save`로 확정한다. 제출 근거(FileObservationBasis)는 확정 때 core가 다시
// 비교하고, 달라졌으면 conflict라 다시 관측한다(file-tracking#R7, versions#R13).
// 마지막 관측은 FileStatus 메모리에 남긴다(`/v1/files/status`가 이것을 묻는다).
import { err, ok, type Result } from "../../../packages/base/mod.ts";
import type { LophnError } from "../../../packages/base/mod.ts";
import type {
  FileObservationBasis,
  FileSource,
  FileTarget,
} from "../../../packages/contracts/documents/mod.ts";
import type {
  ObservationSubmit,
  ObserveDeps,
  ObserveRoot,
  StatusObservation,
  StatusRecorder,
} from "../../../packages/documents/file-tracking/mod.ts";
import type { CoreClient } from "./submit.ts";

// 관측 파일이 이어지는 project·문서 근거. 근원은 core read다. 이 port가 어디서
// 읽는지는 조립이 정한다(documents#T11 진행 줄: machine이 읽을 연결 read가 아직 없다).
export type ObservationLink = {
  project: string;
  project_revision: string;
  // 이 경로에 연결된 문서. 연결이 없으면 새 문서를 만든다(base_version null).
  document: string;
  base_version: string | null;
  document_revision: string | null;
  file_source: FileSource | null;
  title: string;
  latest_hash: string | null;
};

export type PreparedBlobRef = {
  preparation: string;
  principal: string;
  purpose: string;
  hash: string;
  size_bytes: number;
};

export type ObservationPorts = {
  client: CoreClient;
  // 원문 바이트를 blob으로 준비한다. child→core blob.prepare 통로는 platform 몫이다.
  prepareBlob(bytes: Uint8Array): Promise<Result<PreparedBlobRef, LophnError>>;
  link(
    submit: ObservationSubmit,
  ): Promise<Result<ObservationLink, LophnError>>;
  status: StatusRecorder;
  nowIso(): string;
  newKey(): string;
};

const EXTENSIONS: Readonly<Record<string, string>> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  html: "text/html",
  htm: "text/html",
  xhtml: "application/xhtml+xml",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

// 확장자로 MIME을 정한다. 모르는 확장자는 data format의 일반 바이트다.
export function mediaTypeOfPath(path: string): string {
  const dot = path.lastIndexOf(".");
  const extension = dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
  return EXTENSIONS[extension] ?? "application/octet-stream";
}

function target(link: ObservationLink, path: string): FileTarget {
  return { kind: "project_file", project: link.project, path };
}

function observation(
  base: Partial<StatusObservation>,
  at: string,
  link: ObservationLink,
): StatusObservation {
  return {
    tracked: true,
    missing: false,
    unverified: false,
    validationFailed: false,
    observedHash: null,
    latestHash: link.latest_hash,
    observedAt: at,
    comparedVersion: link.base_version,
    projectRevision: link.project_revision,
    details: null,
    ...base,
  };
}

// ObserveDeps.submit의 제품 구현. 실패는 그 후보를 다시 관측하게 한다.
export function createObservationSubmit(
  ports: ObservationPorts,
): (submission: ObservationSubmit) => Promise<Result<void>> {
  return async (submission) => {
    const at = ports.nowIso();
    const linked = await ports.link(submission);
    // 연결 근거를 모르면 상태도 모른다. 추적 중으로 꾸미지 않는다.
    if (!linked.ok) return linked;
    const link = linked.value;
    const path = submission.candidate.canonical;
    const key = target(link, path);
    if (submission.outcome.kind === "unverified") {
      ports.status.report(
        key,
        observation(
          { unverified: true, details: submission.outcome.reason },
          at,
          link,
        ),
      );
      return ok(undefined);
    }
    const read = submission.outcome.read;
    const blob = await ports.prepareBlob(read.bytes);
    if (!blob.ok) {
      ports.status.report(
        key,
        observation(
          { observedHash: read.hash, details: "blob preparation" },
          at,
          link,
        ),
      );
      return blob;
    }
    const basis: FileObservationBasis = {
      kind: "project_file",
      project: link.project,
      path,
      project_revision: link.project_revision,
      file_source: link.file_source,
      ...(link.document_revision === null ? {} : {
        document_revision: link.document_revision,
        document_status: "active" as const,
      }),
      original_hash: read.hash,
      observed_at: at,
    };
    const idempotency_key = ports.newKey();
    const prepared = await ports.client.call("documents/prepare", {
      document: link.document,
      base_version: link.base_version,
      ...(link.base_version === null
        ? { metadata: { title: link.title, place: null, name: null } }
        : {}),
      files: [{
        path: submission.candidate.relative,
        blob_hash: read.hash,
        bytes: read.bytes.length,
        media_type: mediaTypeOfPath(submission.candidate.relative),
        primary: true,
        content: { kind: "prepared", blob: blob.value },
      }],
      file_basis: basis,
      source: {
        kind: "file",
        project: link.project,
        path,
        original_hash: read.hash,
        observed_at: at,
      },
      idempotency_key,
    });
    if (!prepared.ok) {
      ports.status.report(
        key,
        observation(
          {
            observedHash: read.hash,
            // 지정 format 검사 실패는 파일을 되돌리지 않고 상태로만 남긴다.
            validationFailed: prepared.error.code === "invalid_input",
            details: prepared.error.code,
          },
          at,
          link,
        ),
      );
      return err(prepared.error);
    }
    const preparedVersion = prepared.value as { preparation_ref: string };
    const saved = await ports.client.call("documents/save", {
      input: preparedVersion,
      idempotency_key,
      compare: { base_version: link.base_version },
      prepared: [preparedVersion.preparation_ref],
    });
    if (!saved.ok) {
      ports.status.report(
        key,
        observation(
          { observedHash: read.hash, details: saved.error.code },
          at,
          link,
        ),
      );
      return err(saved.error);
    }
    ports.status.report(
      key,
      observation({ observedHash: read.hash, latestHash: read.hash }, at, link),
    );
    return ok(undefined);
  };
}

// 원문 blob 준비의 제품 길: 자식 session이 감독 pipe로 core에 보낸다(platform Q6).
// purpose는 document.prepare 입력의 content(document_file)다. principal은 core가 자식
// kind에서 정한다.
export function childBlobPort(session: {
  prepareBlob(input: {
    purpose: string;
    sizeBytes: number;
    bytes: Uint8Array;
  }): Promise<Result<PreparedBlobRef, LophnError>>;
}): ObservationPorts["prepareBlob"] {
  return (bytes) =>
    session.prepareBlob({
      purpose: "document_file",
      sizeBytes: bytes.length,
      bytes,
    });
}

// 관측할 root·규칙과 제출 근거의 재료는 core read에서 온다. coordinator가 machine으로
// 읽을 read가 아직 없다(documents plan Q15). 읽을 수 없는 동안은 성공으로 꾸미지
// 않고 err이며, 관측은 시작하지 않는다.
export type ObservationSource = {
  roots: readonly ObserveRoot[];
  basisFor: ObserveDeps["basisFor"];
};

export function readObservationSource(): Result<ObservationSource, LophnError> {
  return err({
    code: "unavailable",
    message: "tracking 규칙과 문서 연결을 읽는 machine read가 없다",
  });
}

// 경로에 연결된 문서 근거도 같은 read에서 온다(Q15). 없는 동안 제출은 err다.
export function unavailableLink(): Result<ObservationLink, LophnError> {
  return err({
    code: "unavailable",
    message: "문서 연결을 읽는 machine read가 없다",
  });
}
