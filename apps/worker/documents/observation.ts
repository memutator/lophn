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
  ObservationBasisCheck,
  ObservationCandidate,
  ObservationSubmit,
  StatusObservation,
  StatusRecorder,
} from "../../../packages/documents/file-tracking/mod.ts";
import type { BasisStore } from "./basis.ts";
import type { CoreClient } from "./submit.ts";

// 관측 파일이 이어지는 project·문서 근거. 근원은 core가 감독 pipe로 보낸 관측 근거다
// (Q15, `linkFromStore`). coordinator는 machine으로 이것을 읽지 않는다.
export type ObservationLink = {
  project: string;
  project_revision: string;
  // 연결된 문서의 상태. 보관된 문서에는 새 판을 확정하지 않는다(file-tracking#R8).
  status: "active" | "archived";
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
    // 보관된 문서에는 새 판을 확정하지 않는다. 보관이 풀리면 core가 새 근거를 보내고
    // 관측 loop가 그 root를 다시 대조한다(file-tracking#R8).
    if (link.status === "archived") {
      ports.status.report(
        key,
        observation(
          {
            unverified: true,
            observedHash: submission.outcome.read.hash,
            details: "document archived",
          },
          at,
          link,
        ),
      );
      return ok(undefined);
    }
    const read = submission.outcome.read;
    // 최신 판의 원본 hash와 같은 내용이면 새 판이 없다. 주기 대조가 모든 파일을 다시
    // 읽어도 준비·저장 요청을 보내지 않는다(blob·저장 비용이 파일 수에 비례하지 않게).
    if (link.base_version !== null && link.latest_hash === read.hash) {
      ports.status.report(
        key,
        observation(
          { observedHash: read.hash, latestHash: read.hash },
          at,
          link,
        ),
      );
      return ok(undefined);
    }
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

// 관측 근거 store에서 경로의 연결을 읽는 link port. 연결이 없는 파일은 새 문서가 된다
// (첫 판은 base_version null이고 core가 그 파일에 연결해 만든다). root가 근거에서 사라졌으면
// 그 제출은 늦은 것이라 err다.
export function linkFromStore(
  store: BasisStore,
  newDocumentId: () => string,
): ObservationPorts["link"] {
  return (submission) => {
    const root = store.rootOf(submission.candidate.root);
    if (root === undefined) {
      return Promise.resolve(err({
        code: "not_found",
        message: "root is no longer tracked",
      }));
    }
    const path = submission.candidate.canonical;
    const linked = store.link(path);
    if (linked === undefined) {
      return Promise.resolve(ok({
        project: root.project,
        project_revision: root.project_revision,
        status: "active" as const,
        document: newDocumentId(),
        base_version: null,
        document_revision: null,
        file_source: null,
        title: titleOfPath(submission.candidate.relative),
        latest_hash: null,
      }));
    }
    return Promise.resolve(ok({
      project: root.project,
      project_revision: root.project_revision,
      status: linked.status,
      document: linked.document,
      base_version: linked.latest_version,
      document_revision: linked.document_revision,
      file_source: {
        kind: "project_file" as const,
        project: linked.project,
        path,
      },
      title: linked.title,
      latest_hash: linked.latest_hash,
    }));
  };
}

// 관측 후보가 제출될 때의 비교 근거. 관측 loop가 후보마다 부른다.
export function basisFromStore(
  store: BasisStore,
): (candidate: ObservationCandidate) => ObservationBasisCheck {
  return (candidate) => {
    const root = store.rootOf(candidate.root);
    const linked = store.link(candidate.canonical);
    return {
      project: root?.project ?? "",
      projectRevision: root?.project_revision ?? "",
      path: candidate.canonical,
      documentRevision: linked?.document_revision ?? null,
      active: linked === undefined || linked.status === "active",
      archived: linked?.status === "archived",
      rootPresent: root !== undefined,
    };
  };
}

// 새 문서의 제목은 파일 이름에서 마지막 확장자를 뺀 것이다(비면 파일 이름 그대로).
export function titleOfPath(relative: string): string {
  const name = relative.slice(relative.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return stem.length > 0 ? stem : name;
}

// 제출이 conflict로 늦었다면 연결 근거가 낡았을 수 있다(자기 저장 직후 core가 새 근거를
// 보내기 전, 규칙·연결이 바뀐 직후). 새 근거가 반영되면 한 번 더 제출한다. 기한 안에
// 새 근거가 없으면 그 conflict를 그대로 돌려주고 다음 전체 대조가 다시 관측한다.
export function retryOnNewBasis(
  inner: (submission: ObservationSubmit) => Promise<Result<void>>,
  store: Pick<BasisStore, "version" | "changedSince">,
  waitMs: number,
): (submission: ObservationSubmit) => Promise<Result<void>> {
  return async (submission) => {
    const before = store.version;
    const first = await inner(submission);
    if (first.ok || first.error.code !== "conflict") return first;
    if (!await store.changedSince(before, waitMs)) return first;
    return await inner(submission);
  };
}
