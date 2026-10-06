// 준비 worker가 받는 사람 파일 작업 요청(file-tracking#R11, R12). coordinator가 목표를 실제
// root와 경로로 풀어 보낸 요청을 packages의 알고리즘(files.ts·prepared-files.ts)에 넘긴다.
// 이 프로세스는 신뢰한 코드지만 요청마다 경로가 root 안의 일반 파일인지 다시 본다.
// 알고리즘 실패는 공통 오류 코드 그대로 돌려주고 경로·본문은 응답에 넣지 않는다.
import { err, ok, type Result } from "../../../packages/base/mod.ts";
import type { LophnError } from "../../../packages/base/mod.ts";
import type { WorkerRequest } from "../../../packages/contracts/platform/mod.ts";
import { denoFileOps } from "../../../packages/documents/file-tracking/adapters/file-ops.ts";
import {
  createFileSerializer,
  type FileFailure,
} from "../../../packages/documents/file-tracking/file-ops.ts";
import {
  deleteFile,
  type FileDeps,
  type FileDone,
  renameFile,
} from "../../../packages/documents/file-tracking/files.ts";
import {
  prepConfirmSchema,
  prepDeleteSchema,
  prepReadSchema,
  prepRenameSchema,
  prepWriteSchema,
} from "../../../packages/documents/file-tracking/file-ipc.ts";
import { PREPARATION_OPS } from "../../../packages/documents/file-tracking/ipc.ts";
import {
  confirmCopy,
  readLocation,
  writeLocation,
} from "../../../packages/documents/file-tracking/prepared-files.ts";
import type { ByteInbox } from "./byte-inbox.ts";

const WRITE_CHUNK = 64 * 1024;

export function productFileDeps(): FileDeps {
  return {
    ops: denoFileOps(),
    serializer: createFileSerializer(),
    clock: { nowIso: () => new Date().toISOString() },
    token: () => crypto.randomUUID().replaceAll("-", ""),
  };
}

function invalid(): Result<never, LophnError> {
  return err({ code: "invalid_input", message: "invalid file request" });
}

function failure(error: FileFailure): Result<never, LophnError> {
  return err({ code: error.code, message: error.message });
}

async function* chunked(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  for (let at = 0; at < bytes.length; at += WRITE_CHUNK) {
    yield bytes.subarray(at, at + WRITE_CHUNK);
  }
}

function donePayload(done: FileDone): FileDone {
  return { ...done };
}

// 파일 작업 op가 아니면 undefined다. 호출자가 다른 op로 넘긴다.
export function acceptFileOp(
  request: WorkerRequest,
  inbox: ByteInbox,
  deps: FileDeps = productFileDeps(),
): Promise<Result<unknown, LophnError>> | undefined {
  switch (request.op) {
    case PREPARATION_OPS.readFile:
      return readOp(request, deps);
    case PREPARATION_OPS.writeFile:
      return writeOp(request, inbox, deps);
    case PREPARATION_OPS.renameFile:
      return renameOp(request, deps);
    case PREPARATION_OPS.deleteFile:
      return deleteOp(request, deps);
    case PREPARATION_OPS.confirmCopy:
      return confirmOp(request, deps);
    default:
      return undefined;
  }
}

async function readOp(
  request: WorkerRequest,
  deps: FileDeps,
): Promise<Result<unknown, LophnError>> {
  const parsed = prepReadSchema.safeParse(request.payload);
  if (!parsed.success) return invalid();
  const read = await readLocation(deps, parsed.data.location);
  return read.ok ? ok(read.value) : failure(read.error);
}

async function writeOp(
  request: WorkerRequest,
  inbox: ByteInbox,
  deps: FileDeps,
): Promise<Result<unknown, LophnError>> {
  const parsed = prepWriteSchema.safeParse(request.payload);
  if (!parsed.success) return invalid();
  // 바이트는 요청 앞에 도착해 있다. 모자라거나 넘치면 쓰지 않는다.
  const taken = inbox.take(
    parsed.data.content.channel,
    parsed.data.content.bytes,
  );
  if (!taken.ok) {
    return err({ code: "unavailable", message: taken.error.message });
  }
  const done = await writeLocation(deps, parsed.data, chunked(taken.value));
  return done.ok ? ok(donePayload(done.value)) : failure(done.error);
}

async function renameOp(
  request: WorkerRequest,
  deps: FileDeps,
): Promise<Result<unknown, LophnError>> {
  const parsed = prepRenameSchema.safeParse(request.payload);
  if (!parsed.success) return invalid();
  const done = await renameFile(deps, {
    root: parsed.data.root,
    path: parsed.data.path,
    newPath: parsed.data.new_path,
    baseHash: parsed.data.base_hash,
  });
  return done.ok ? ok(donePayload(done.value)) : failure(done.error);
}

async function deleteOp(
  request: WorkerRequest,
  deps: FileDeps,
): Promise<Result<unknown, LophnError>> {
  const parsed = prepDeleteSchema.safeParse(request.payload);
  if (!parsed.success) return invalid();
  const done = await deleteFile(deps, {
    root: parsed.data.root,
    path: parsed.data.path,
    baseHash: parsed.data.base_hash,
  });
  return done.ok ? ok(donePayload(done.value)) : failure(done.error);
}

async function confirmOp(
  request: WorkerRequest,
  deps: FileDeps,
): Promise<Result<unknown, LophnError>> {
  const parsed = prepConfirmSchema.safeParse(request.payload);
  if (!parsed.success) return invalid();
  const done = await confirmCopy(deps, {
    root: parsed.data.root,
    meta: parsed.data.meta,
    baseVersion: parsed.data.base_version,
    confirmedHash: parsed.data.confirmed_hash,
  });
  return done.ok ? ok({ confirmed: true }) : failure(done.error);
}
