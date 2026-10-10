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
import {
  isUtf8,
  type ObservationBasisCheck,
  type ObservationCandidate,
  type ObservationInstructionBasis,
  type ObservationSubmit,
  type StableOutcome,
  type StatusObservation,
  type StatusRecorder,
} from "../../../packages/documents/file-tracking/mod.ts";
import { PREPARATION_OPS } from "../../../packages/documents/file-tracking/ipc.ts";
import type { BasisStore } from "./basis.ts";
import type { PreparationPool } from "./pool.ts";
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
  // hash는 읽은 바이트의 sha256이다(`reusePreparedBlob`이 같은 바이트의 살아 있는 준비를 찾는다).
  prepareBlob(
    bytes: Uint8Array,
    hash: string,
  ): Promise<Result<PreparedBlobRef, LophnError>>;
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

// 저장 warning(`code: message`)만 다음 대조에 남긴다. 실패 코드는 내용이 같아지면 지운다.
function keptWarning(details: string | null): string | null {
  if (details === null || !details.includes(": ")) return null;
  return details;
}

// 저장 응답의 warning만 상태 설명으로 남긴다. 없으면 null이다.
function savedWarning(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const warnings = (value as { warnings?: unknown }).warnings;
  if (!Array.isArray(warnings) || warnings.length === 0) return null;
  const first = warnings[0];
  if (typeof first !== "object" || first === null) return null;
  const code = (first as { code?: unknown }).code;
  if (typeof code !== "string" || code.length === 0) return null;
  const message = (first as { message?: unknown }).message;
  const text = typeof message === "string" && message.length > 0
    ? `${code}: ${message}`
    : code;
  return text.length > 240 ? text.slice(0, 240) : text;
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
      // 같은 내용의 다시 대조는 저장 warning을 지우지 않는다.
      ports.status.report(
        key,
        observation(
          {
            observedHash: read.hash,
            latestHash: read.hash,
            details: keptWarning(ports.status.get(key)?.details ?? null),
          },
          at,
          link,
        ),
      );
      return ok(undefined);
    }
    const blob = await ports.prepareBlob(read.bytes, read.hash);
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
    // 준비 결과의 files가 판의 파일 목록이다. save가 같은 tx에서 version_files 행과
    // 파일별 원문 blob 참조를 등록하므로 그 준비 참조도 함께 묶는다(Q16).
    const preparedVersion = prepared.value as {
      preparation_ref: string;
      files: readonly { preparation_ref: string }[];
    };
    const saved = await ports.client.call("documents/save", {
      input: preparedVersion,
      idempotency_key,
      compare: { base_version: link.base_version },
      prepared: [
        preparedVersion.preparation_ref,
        ...preparedVersion.files.map((file) => file.preparation_ref),
      ],
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
      observation(
        {
          observedHash: read.hash,
          latestHash: read.hash,
          // warning은 판을 막지 않고 상태에 남긴다. 추출 가능 여부와 따로다.
          details: savedWarning(saved.value),
        },
        at,
        link,
      ),
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
}): (bytes: Uint8Array) => ReturnType<ObservationPorts["prepareBlob"]> {
  return (bytes) =>
    session.prepareBlob({
      purpose: "document_file",
      sizeBytes: bytes.length,
      bytes,
    });
}

// 같은 바이트를 동시에 준비하는 요청은 한 번만 보낸다(같은 내용의 파일을 한꺼번에 관측할 때
// 바이트를 두 번 옮기지 않는다). 끝난 준비를 다시 쓰는 일은 core relay가 한다: 같은
// 주체·purpose·내용의 준비가 살아 있으면 그 참조를 돌려준다(coding-agent Q24).
export function sharePreparedBlob(
  prepare: ObservationPorts["prepareBlob"],
): ObservationPorts["prepareBlob"] {
  const inflight = new Map<string, ReturnType<typeof prepare>>();
  return (bytes, hash) => {
    const found = inflight.get(hash);
    if (found !== undefined) return found;
    const pending = prepare(bytes, hash).finally(() => inflight.delete(hash));
    inflight.set(hash, pending);
    return pending;
  };
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

// 일반 root 관측이 등록된 지침 파일을 project 문서로 만들지 않는다. 그 파일은 지침 관측만 본다
// (file-tracking#R19: 일반 폴더 tracking 범위와 지침 등록은 서로 넓히지 않는다).
export function skipInstructionFiles(
  inner: (submission: ObservationSubmit) => Promise<Result<void>>,
  store: Pick<BasisStore, "instruction">,
): (submission: ObservationSubmit) => Promise<Result<void>> {
  return (submission) =>
    store.instruction(submission.candidate.canonical) === undefined
      ? inner(submission)
      : Promise.resolve(ok(undefined));
}

export type InstructionObservationPorts =
  & Omit<
    ObservationPorts,
    "link"
  >
  & {
    store: Pick<BasisStore, "instruction">;
    newDocumentId(): string;
  };

function instructionTarget(entry: ObservationInstructionBasis): FileTarget {
  return {
    kind: "instruction_file",
    instruction_target: entry.instruction_target,
    project: entry.project,
    path: entry.path,
  };
}

function instructionTitle(entry: ObservationInstructionBasis): string {
  return entry.project === null
    ? "Global instructions"
    : "Project instructions";
}

// 등록된 지침 파일의 관측 하나를 Version까지 올린다. 처음 관측하는 파일은 사람의 첫 저장이거나
// 사람이 미리 둔 파일이고(base_version null) 문서는 place·name 없이 instruction_file 원본에
// 연결된다. 파일이 없으면 판도 없다. 읽기·UTF-8·hash 검사에 걸리면 판을 만들지 않고 상태만 남긴다.
export function createInstructionSubmit(
  ports: InstructionObservationPorts,
): (submission: ObservationSubmit) => Promise<Result<void>> {
  return async (submission) => {
    const at = ports.nowIso();
    const path = submission.candidate.canonical;
    const entry = ports.store.instruction(path);
    // 등록에서 사라진 파일의 늦은 제출이다. 추적 중으로 꾸미지 않는다.
    if (entry === undefined) {
      return err({
        code: "not_found",
        message: "instruction file is no longer registered",
      });
    }
    const key = instructionTarget(entry);
    const link = entry.link;
    const status = (base: Partial<StatusObservation>): StatusObservation => ({
      tracked: true,
      missing: false,
      unverified: false,
      validationFailed: false,
      observedHash: null,
      latestHash: link?.latest_hash ?? null,
      observedAt: at,
      comparedVersion: link?.latest_version ?? null,
      projectRevision: entry.project_revision,
      details: null,
      ...base,
    });
    if (submission.outcome.kind === "unverified") {
      ports.status.report(
        key,
        status({ unverified: true, details: submission.outcome.reason }),
      );
      return ok(undefined);
    }
    const read = submission.outcome.read;
    if (link?.status === "archived") {
      ports.status.report(
        key,
        status({
          unverified: true,
          observedHash: read.hash,
          details: "document archived",
        }),
      );
      return ok(undefined);
    }
    if (!isUtf8(read.bytes)) {
      ports.status.report(
        key,
        status({
          validationFailed: true,
          observedHash: read.hash,
          details: "instruction file is not UTF-8",
        }),
      );
      return ok(undefined);
    }
    if (link !== null && link.latest_hash === read.hash) {
      ports.status.report(
        key,
        status({ observedHash: read.hash, latestHash: read.hash }),
      );
      return ok(undefined);
    }
    const blob = await ports.prepareBlob(read.bytes, read.hash);
    if (!blob.ok) {
      ports.status.report(
        key,
        status({ observedHash: read.hash, details: "blob preparation" }),
      );
      return blob;
    }
    const document = link?.document ?? ports.newDocumentId();
    const baseVersion = link?.latest_version ?? null;
    const basis: FileObservationBasis = {
      kind: "instruction_file",
      instruction_target: entry.instruction_target,
      project: entry.project,
      path,
      instruction_revision: entry.instruction_revision,
      project_revision: entry.project_revision,
      file_source: link === null ? null : {
        kind: "instruction_file",
        instruction_target: entry.instruction_target,
        project: entry.project,
        path,
      },
      ...(link === null ? {} : {
        document_revision: link.document_revision,
        document_status: "active" as const,
      }),
      original_hash: read.hash,
      observed_at: at,
    };
    const idempotency_key = ports.newKey();
    const prepared = await ports.client.call("documents/prepare", {
      document,
      base_version: baseVersion,
      ...(baseVersion === null
        ? {
          metadata: { title: instructionTitle(entry), place: null, name: null },
        }
        : {}),
      files: [{
        path: submission.candidate.relative,
        blob_hash: read.hash,
        bytes: read.bytes.length,
        media_type: "text/markdown",
        primary: true,
        content: { kind: "prepared", blob: blob.value },
      }],
      file_basis: basis,
      source: {
        kind: "instruction_file",
        instruction_target: entry.instruction_target,
        project: entry.project,
        path,
        original_hash: read.hash,
        observed_at: at,
      },
      idempotency_key,
    });
    if (!prepared.ok) {
      ports.status.report(
        key,
        status({
          observedHash: read.hash,
          validationFailed: prepared.error.code === "invalid_input",
          details: prepared.error.code,
        }),
      );
      return err(prepared.error);
    }
    const preparedVersion = prepared.value as {
      preparation_ref: string;
      files: readonly { preparation_ref: string }[];
    };
    const saved = await ports.client.call("documents/save", {
      input: preparedVersion,
      idempotency_key,
      compare: { base_version: baseVersion },
      prepared: [
        preparedVersion.preparation_ref,
        ...preparedVersion.files.map((file) => file.preparation_ref),
      ],
    });
    if (!saved.ok) {
      ports.status.report(
        key,
        status({ observedHash: read.hash, details: saved.error.code }),
      );
      return err(saved.error);
    }
    ports.status.report(
      key,
      status({ observedHash: read.hash, latestHash: read.hash }),
    );
    return ok(undefined);
  };
}

// 등록된 지침 파일의 관측 제출 근거. 등록의 문서 판·상태를 비교한다.
export function instructionBasisFromStore(
  store: Pick<BasisStore, "instruction">,
): (candidate: ObservationCandidate) => ObservationBasisCheck {
  return (candidate) => {
    const entry = store.instruction(candidate.canonical);
    return {
      project: entry?.project ?? "",
      projectRevision: entry?.instruction_revision ?? "",
      path: candidate.canonical,
      documentRevision: entry?.link?.document_revision ?? null,
      active: entry?.link === null || entry?.link === undefined ||
        entry.link.status === "active",
      archived: entry?.link?.status === "archived",
      rootPresent: entry !== undefined,
    };
  };
}

// 등록은 있는데 파일이 없다. 첫 저장 전에는 판이 없고(아무것도 만들지 않는다), 연결 문서가 있으면
// source_missing 상태다. 지침 부재 성공이 아니다.
export function reportInstructionMissing(
  ports: Pick<InstructionObservationPorts, "store" | "status" | "nowIso">,
  candidate: ObservationCandidate,
): void {
  const entry = ports.store.instruction(candidate.canonical);
  if (entry === undefined) return;
  const link = entry.link;
  ports.status.report(instructionTarget(entry), {
    tracked: link !== null,
    missing: true,
    unverified: false,
    validationFailed: false,
    observedHash: null,
    latestHash: link?.latest_hash ?? null,
    observedAt: ports.nowIso(),
    comparedVersion: link?.latest_version ?? null,
    projectRevision: entry.project_revision,
    details: null,
  });
}

// 등록된 지침 파일을 준비 worker로 읽는 port. coordinator는 등록 폴더(tracking을 끈 project 포함)를
// 읽을 권한이 없고, 준비 worker가 등록 폴더 전부와 data root를 읽는다. 소유자·symlink·일반 파일
// 검사와 안정 읽기는 준비 worker가 하고 coordinator는 hash·identity·바이트만 받는다.
export function poolInstructionRead(
  pool: Pick<PreparationPool, "request">,
  dataRoot: string,
): (path: string) => Promise<Result<StableOutcome, LophnError>> {
  return async (path) => {
    const answered = await pool.request({
      op: PREPARATION_OPS.readInstruction,
      payload: (_channel, replyChannel) => ({
        path,
        data_root: dataRoot,
        channel: replyChannel,
      }),
      replyBytes: true,
      priority: "background",
      keys: [path],
    });
    if (!answered.ok) return answered;
    const { payload, bytes } = answered.value as {
      payload: {
        kind: "stable" | "unverified";
        reason?: string;
        hash?: string;
        identity?: {
          realPath: string;
          device: number;
          inode: number;
          size: number;
          mtimeMs: number;
        };
      };
      bytes: Uint8Array;
    };
    if (payload.kind === "unverified") {
      return ok({
        kind: "unverified",
        reason: payload.reason ?? "instruction file is not stable",
      });
    }
    if (payload.hash === undefined || payload.identity === undefined) {
      return err({
        code: "unavailable",
        message: "instruction file read is invalid",
      });
    }
    return ok({
      kind: "stable",
      read: { hash: payload.hash, bytes, identity: payload.identity },
    });
  };
}
