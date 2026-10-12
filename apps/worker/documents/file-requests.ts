// 준비 worker가 받는 사람 파일 작업 요청(file-tracking#R11, R12). coordinator가 목표를 실제
// root와 경로로 풀어 보낸 요청을 packages의 알고리즘(files.ts·prepared-files.ts)에 넘긴다.
// 이 프로세스는 신뢰한 코드지만 요청마다 경로가 root 안의 일반 파일인지 다시 본다.
// 알고리즘 실패는 공통 오류 코드 그대로 돌려주고 경로·본문은 응답에 넣지 않는다.
import { err, ok, type Result } from "../../../packages/base/mod.ts";
import type { LophnError } from "../../../packages/base/mod.ts";
import type { WorkerRequest } from "../../../packages/protocol/server/mod.ts";
import { denoFileOps } from "../../../packages/core/projects/file-tracking/adapters/file-ops.ts";
import {
  createFileSerializer,
  type FileFailure,
} from "../../../packages/core/projects/file-tracking/file-ops.ts";
import {
  deleteFile,
  type FileDeps,
  type FileDone,
  renameFile,
} from "../../../packages/core/projects/file-tracking/files.ts";
import {
  INSTRUCTION_READ_MAX_BYTES,
  prepConfirmSchema,
  prepDeleteSchema,
  prepInstructionReadSchema,
  prepReadSchema,
  prepRenameSchema,
  prepWindowSchema,
  prepWriteSchema,
} from "../../../packages/core/projects/file-tracking/file-ipc.ts";
import { PREPARATION_OPS } from "../../../packages/core/projects/file-tracking/ipc.ts";
import { instructionReadPort } from "../../../packages/core/projects/file-tracking/fs.ts";
import { readStably } from "../../../packages/core/projects/file-tracking/work.ts";
import {
  confirmCopy,
  readLocation,
  readWindow,
  writeLocation,
} from "../../../packages/core/projects/file-tracking/prepared-files.ts";
import type { ByteInbox } from "./byte-inbox.ts";

const WRITE_CHUNK = 64 * 1024;

// 응답 앞에 byte chunk frame을 보내는 출구. 준비 worker의 감독 session이 채운다.
export type ByteOutbox = {
  send(channel: number, bytes: Uint8Array): Promise<void>;
};

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
  outbox?: ByteOutbox,
): Promise<Result<unknown, LophnError>> | undefined {
  switch (request.op) {
    case PREPARATION_OPS.readFile:
      return readOp(request, deps);
    case PREPARATION_OPS.readWindow:
      return windowOp(request, deps, outbox);
    case PREPARATION_OPS.readInstruction:
      return instructionOp(request, outbox);
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

// 파일의 한 창을 byte chunk frame으로 보내고(응답보다 먼저 간다) 보낸 길이를 답한다.
async function windowOp(
  request: WorkerRequest,
  deps: FileDeps,
  outbox: ByteOutbox | undefined,
): Promise<Result<unknown, LophnError>> {
  const parsed = prepWindowSchema.safeParse(request.payload);
  if (!parsed.success) return invalid();
  if (outbox === undefined) {
    return err({ code: "unavailable", message: "no byte channel" });
  }
  const read = await readWindow(deps, parsed.data);
  if (!read.ok) return failure(read.error);
  try {
    await outbox.send(parsed.data.channel, read.value);
  } catch {
    return err({ code: "unavailable", message: "file bytes were not sent" });
  }
  return ok({ bytes: read.value.length });
}

// 등록된 지침 파일 하나를 안정 읽기해 hash·identity와 바이트(응답 전 byte frame)를 돌려준다. 소유자·
// symlink·일반 파일 검사에 걸리면 invalid_input, 없으면 not_found다. 한 frame 안에 들어오지 않는
// 큰 파일은 판을 만들 수 없어 미확인이다(검사 상한은 lophn-agent/instructions가 따로 막는다).
async function instructionOp(
  request: WorkerRequest,
  outbox: ByteOutbox | undefined,
): Promise<Result<unknown, LophnError>> {
  const parsed = prepInstructionReadSchema.safeParse(request.payload);
  if (!parsed.success) return invalid();
  if (outbox === undefined) {
    return err({ code: "unavailable", message: "no byte channel" });
  }
  const read = await readStably(
    instructionReadPort(parsed.data.data_root),
    parsed.data.path,
  );
  if (!read.ok) return err(read.error);
  if (read.value.kind === "unverified") {
    return ok({ kind: "unverified", reason: read.value.reason, bytes: 0 });
  }
  const { hash, bytes, identity } = read.value.read;
  if (bytes.length > INSTRUCTION_READ_MAX_BYTES) {
    return ok({
      kind: "unverified",
      reason: "instruction file is too large to observe",
      bytes: 0,
    });
  }
  try {
    // 빈 파일(빈 사람 지침)은 보낼 바이트가 없다. 우편함은 0바이트를 받은 것으로 본다.
    if (bytes.length > 0) await outbox.send(parsed.data.channel, bytes);
  } catch {
    return err({ code: "unavailable", message: "file bytes were not sent" });
  }
  return ok({ kind: "stable", hash, identity, bytes: bytes.length });
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
