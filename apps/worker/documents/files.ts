// coordinator의 사람 파일 쓰기 처리(file-tracking#R1, R2, R11, R15, R17). core가 user 자격을
// 확인하고 바이트를 먼저 보낸 요청을 받아, 목표를 실제 root와 경로로 풀고(범위 밖은 없는
// 것과 같은 invalid_input), 준비 worker pool에 맡기고, 성공한 작업을 machine credential의
// `file.record_result`로 기록한다. 파일 결과·기록 결과·version 결과는 따로 낸다: 뒤 단계의
// 실패가 이미 성공한 파일 작업을 실패로 바꾸지 않는다. 읽기·상태는 files-status.ts다.
import { err, ok, type Result, sha256Hex } from "../../../packages/base/mod.ts";
import type { LophnError } from "../../../packages/base/mod.ts";
import type {
  FileOperationResult,
  FileTarget,
} from "../../../packages/protocol/projects/mod.ts";
import { fileOperationResultSchema } from "../../../packages/protocol/projects/mod.ts";
import {
  type ContentRef,
  coreFileDeleteSchema,
  coreFileRenameSchema,
  coreFileWriteSchema,
  coreWorkingCopyConfirmSchema,
  type WorkingCopyBasis,
} from "../../../packages/core/projects/file-tracking/file-ipc.ts";
import type { FileDone } from "../../../packages/core/projects/file-tracking/files.ts";
import { PREPARATION_OPS } from "../../../packages/core/projects/file-tracking/ipc.ts";
import type { FileOps } from "../../../packages/core/projects/file-tracking/file-ops.ts";
import type { StatusRecorder } from "../../../packages/core/projects/file-tracking/status.ts";
import {
  encodeWorkingCopyMeta,
  workingCopyLocation,
} from "../../../packages/core/projects/file-tracking/working-copy.ts";
import type { BasisStore } from "./basis.ts";
import type { ByteInbox } from "./byte-inbox.ts";
import { createLocator, notAvailable } from "./files-locate.ts";
import { createStatusHandlers, type StatusHandlers } from "./files-status.ts";
import type { PreparationPool } from "./pool.ts";

export type FilesDeps = {
  // LOPHN_HOME. working copy 폴더의 근원이다.
  dataRoot: string;
  // 쓸 수 있는 폴더(folders)와 관측 root(roots)를 구별해서 쓴다.
  basis: Pick<BasisStore, "roots" | "folders" | "instructions">;
  pool: Pick<PreparationPool, "request">;
  inbox: ByteInbox;
  status: StatusRecorder;
  // symlink를 푼 같은 목표의 key와 working copy 폴더를 만드는 데 쓴다.
  ops: Pick<FileOps, "realPath" | "makeDirectory">;
  // 성공한 작업을 machine credential로 기록한다. core에 닿지 못하면 err다.
  record(
    result: FileOperationResult,
  ): Promise<Result<FileOperationResult, LophnError>>;
  // core에 byte chunk frame을 보낸다(파일 창). 보내지 못하면 던진다.
  sendBytes(channel: number, bytes: Uint8Array): Promise<void>;
  // 지침 파일에 쓴 직후 그 파일을 바로 다시 관측하게 한다(file-tracking#R19, R20).
  nudge?(path: string): void;
  nowIso(): string;
  watchWaitMs?: number;
  watchPollMs?: number;
};

export type FileHandlers = StatusHandlers & {
  write(payload: unknown): Promise<Result<unknown, LophnError>>;
  rename(payload: unknown): Promise<Result<unknown, LophnError>>;
  delete(payload: unknown): Promise<Result<unknown, LophnError>>;
  confirmCopy(payload: unknown): Promise<Result<unknown, LophnError>>;
};

type Operation = {
  request_key: string;
  operation: "write" | "rename" | "delete";
  target: FileTarget;
};

function parseDone(value: unknown): FileDone | undefined {
  const done = value as Partial<FileDone> | null;
  return typeof done === "object" && done !== null &&
      typeof done.outcome === "string"
    ? done as FileDone
    : undefined;
}

function asResult(
  request: Operation,
  done: FileDone,
  versionResult: FileOperationResult["version_result"],
): FileOperationResult {
  return {
    request_key: request.request_key,
    operation: request.operation,
    target: request.target,
    outcome: done.outcome,
    before_path: done.beforePath,
    after_path: done.afterPath,
    before_hash: done.beforeHash,
    written_hash: done.writtenHash,
    observed_hash: done.observedHash,
    observed_at: done.observedAt,
    changed_again: done.changedAgain,
    recording: "unverified",
    event_seq: null,
    version_result: versionResult,
  };
}

function metaText(
  target: FileTarget,
  basis: WorkingCopyBasis,
): string | undefined {
  if (target.kind !== "working_copy") return undefined;
  return new TextDecoder().decode(encodeWorkingCopyMeta({
    document: target.document,
    base_version: basis.base_version,
    primary_path: basis.primary_path,
    media_type: basis.media_type,
    confirmed_hash: basis.confirmed_hash,
  }));
}

export function createFileHandlers(deps: FilesDeps): FileHandlers {
  const locator = createLocator(deps);
  const statuses = createStatusHandlers({ ...deps, locator });

  // 성공한 작업만 기록한다. 기록하지 못해도 파일 결과는 그대로고 recording만 unverified다.
  async function recorded(
    result: FileOperationResult,
  ): Promise<FileOperationResult> {
    if (result.outcome === "unverified") return result;
    const answered = await deps.record(result).catch(() => undefined);
    if (answered === undefined || !answered.ok) return result;
    const checked = fileOperationResultSchema.safeParse(answered.value);
    return checked.success && checked.data.recording === "recorded"
      ? { ...result, recording: "recorded", event_seq: checked.data.event_seq }
      : result;
  }

  function bytesOf(content: ContentRef): Result<Uint8Array, LophnError> {
    const taken = deps.inbox.take(content.channel, content.bytes);
    return taken.ok
      ? taken
      : err({ code: "unavailable", message: "file content did not arrive" });
  }

  // 도착한 바이트는 쓰지 않을 때 우편함에서 비운다.
  function drop(content: ContentRef) {
    deps.inbox.take(content.channel, content.bytes);
  }

  async function finish(
    request: Operation,
    done: Result<unknown, LophnError>,
    versionResult: FileOperationResult["version_result"],
  ): Promise<Result<unknown, LophnError>> {
    if (!done.ok) return done;
    const fileDone = parseDone(done.value);
    if (fileDone === undefined) {
      return err({ code: "unavailable", message: "file result is invalid" });
    }
    return ok(await recorded(asResult(request, fileDone, versionResult)));
  }

  return {
    ...statuses,
    async write(payload) {
      const parsed = coreFileWriteSchema.safeParse(payload);
      if (!parsed.success) {
        // 요청이 어긋나도 이미 도착한 바이트는 우편함에 남기지 않는다.
        const raw = (payload as { content?: Partial<ContentRef> } | null)
          ?.content;
        if (typeof raw?.channel === "number" && typeof raw.bytes === "number") {
          deps.inbox.take(raw.channel, raw.bytes);
        }
        return notAvailable();
      }
      const { request, content } = parsed.data;
      const located = await locator.locate(request.target);
      if (!located.ok) {
        drop(content);
        return located;
      }
      const basis = parsed.data.working_copy;
      // working copy는 core가 ledger에서 읽은 근거(연 판·대표 파일)가 있어야 쓴다.
      if (located.value.copy !== undefined) {
        if (basis === undefined) {
          drop(content);
          return notAvailable();
        }
        const made = await locator.ensureCopyDirectories(located.value.copy);
        if (!made.ok) {
          drop(content);
          return made;
        }
      }
      // project 파일의 판은 관측 loop가 만든다. 관측 root가 아닌 폴더(tracking을 끈 project)는
      // 관측하지 않으니 판 요청에 기다릴 판이 없다(Q28).
      const versionResultOf = (requested: boolean) =>
        !requested
          ? "not_requested" as const
          : request.target.kind === "project_file" &&
              !deps.basis.roots().some((root) =>
                root.root === located.value.location.root
              )
          ? "not_requested" as const
          : "preparing" as const;
      const bytes = bytesOf(content);
      if (!bytes.ok) return bytes;
      const meta = basis === undefined
        ? undefined
        : metaText(request.target, basis);
      const done = await deps.pool.request({
        op: PREPARATION_OPS.writeFile,
        payload: (channel) => ({
          location: located.value.location,
          base_hash: request.base_hash,
          content: { channel, bytes: content.bytes, hash: content.hash },
          ...(meta === undefined ? {} : { meta_create: meta }),
        }),
        bytes: bytes.value,
        priority: "human",
        keys: [located.value.key],
      });
      const answered = await finish(
        {
          request_key: request.request_key,
          operation: "write",
          target: request.target,
        },
        done,
        versionResultOf(request.version_request !== undefined),
      );
      // 쓴 지침 파일의 새 판은 관측이 만든다. 60초 주기를 기다리지 않고 바로 다시 읽게 한다.
      if (request.target.kind === "instruction_file" && done.ok) {
        deps.nudge?.(located.value.location.path);
      }
      return answered;
    },
    async rename(payload) {
      const parsed = coreFileRenameSchema.safeParse(payload);
      if (!parsed.success) return notAvailable();
      const { request } = parsed.data;
      if (request.target.kind !== "project_file") return notAvailable();
      const located = await locator.locate(request.target);
      if (!located.ok) return located;
      // 새 이름도 같은 등록 폴더 안이어야 한다.
      const root = locator.rootOf(request.target.project, request.path);
      if (root !== located.value.location.root) return notAvailable();
      const done = await deps.pool.request({
        op: PREPARATION_OPS.renameFile,
        payload: {
          root,
          path: located.value.location.path,
          new_path: request.path,
          base_hash: request.base_hash,
        },
        priority: "human",
        keys: [located.value.key, await locator.canonicalKey(request.path)],
      });
      return await finish(
        {
          request_key: request.request_key,
          operation: "rename",
          target: request.target,
        },
        done,
        "not_requested",
      );
    },
    async delete(payload) {
      const parsed = coreFileDeleteSchema.safeParse(payload);
      if (!parsed.success) return notAvailable();
      const { request } = parsed.data;
      if (request.target.kind !== "project_file") return notAvailable();
      const located = await locator.locate(request.target);
      if (!located.ok) return located;
      const done = await deps.pool.request({
        op: PREPARATION_OPS.deleteFile,
        payload: {
          root: located.value.location.root,
          path: located.value.location.path,
          base_hash: request.base_hash,
        },
        priority: "human",
        keys: [located.value.key],
      });
      return await finish(
        {
          request_key: request.request_key,
          operation: "delete",
          target: request.target,
        },
        done,
        "not_requested",
      );
    },
    async confirmCopy(payload) {
      const parsed = coreWorkingCopyConfirmSchema.safeParse(payload);
      if (!parsed.success) return notAvailable();
      const copy = workingCopyLocation(deps.dataRoot, parsed.data.document);
      if (!copy.ok) return notAvailable();
      return await deps.pool.request({
        op: PREPARATION_OPS.confirmCopy,
        payload: {
          root: copy.value.root,
          meta: copy.value.meta,
          base_version: parsed.data.base_version,
          confirmed_hash: parsed.data.confirmed_hash,
        },
        priority: "human",
        keys: [copy.value.content],
      });
    },
  };
}

// 결과 기록 command의 idempotency key. 같은 `(request_key, operation)`은 같은 key라
// 공통 command 결과가 event 중복을 막는다.
export async function recordKeyOf(
  result: Pick<FileOperationResult, "request_key" | "operation">,
): Promise<string> {
  const digest = await sha256Hex(`${result.request_key}\n${result.operation}`);
  return `file-result-${digest.slice(0, 40)}`;
}
