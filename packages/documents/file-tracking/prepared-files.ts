// 준비 worker가 하는 사람 파일 작업. 목표는 coordinator가 실제 root와 경로로 풀어 보낸 것이고,
// 여기서는 그 경로가 정말 root 안의 일반 파일인지 다시 본다(files.ts의 resolveTarget).
// 읽기·쓰기·working copy 확정만 둔다. 이름 변경·삭제는 files.ts를 그대로 쓴다.
import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  diskFailure,
  fail,
  type FileFailure,
  type FileOps,
  type FileStat,
  hashFile,
  resolveTarget,
  sameFileIdentity,
} from "./file-ops.ts";
import { type FileDeps, type FileDone, writeFile } from "./files.ts";
import type {
  FileIdentity,
  FileLocation,
  FileReadReply,
  PrepWindow,
  PrepWrite,
} from "./file-ipc.ts";
import { encodeWorkingCopyMeta, parseWorkingCopyMeta } from "./working-copy.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

async function slurp(
  ops: Pick<FileOps, "read">,
  path: string,
): Promise<{ bytes: Uint8Array; hash: string }> {
  const hash = createHash("sha256");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of ops.read(path)) {
    hash.update(chunk);
    chunks.push(chunk);
    size += chunk.length;
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return { bytes, hash: hash.digest("hex") };
}

function identityOf(stat: FileStat): FileIdentity {
  return {
    device: stat.device,
    inode: stat.inode,
    size: stat.size,
    mtime_ms: stat.mtimeMs,
  };
}

function sameIdentity(stat: FileStat, identity: FileIdentity): boolean {
  return stat.device === identity.device && stat.inode === identity.inode &&
    stat.size === identity.size && stat.mtimeMs === identity.mtime_ms;
}

// 파일 하나의 헤더(hash·크기·identity)를 읽는다. 바이트는 싣지 않는다: 크기와 무관하게
// stream으로 hash만 계산하고 바이트는 `readWindow`가 창 단위로 보낸다. hash를 계산하는 동안
// 파일이 바뀌면(읽기 전후 identity가 다르면) 한 번 더 읽고, 그래도 흔들리면 unavailable이다.
// 없으면 exists=false다(존재하지 않는 것은 오류가 아니다).
export async function readLocation(
  deps: FileDeps,
  location: FileLocation,
): Promise<Result<FileReadReply, FileFailure>> {
  const { ops } = deps;
  const absent = (meta: unknown): FileReadReply => ({
    exists: false,
    hash: null,
    size: 0,
    identity: null,
    meta,
  });
  // 아직 만들지 않은 working copy 폴더는 사본이 없는 것이다(오류가 아니다).
  if (
    location.meta !== undefined &&
    await ops.realPath(location.root) === undefined
  ) {
    return ok(absent(null));
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const target = await resolveTarget(ops, location.root, location.path);
    if (!target.ok) return target;
    const meta = await readMeta(deps, location);
    if (target.value.stat === undefined) return ok(absent(meta));
    const stat = target.value.stat;
    try {
      const hash = await hashFile(ops, target.value.path);
      const after = await ops.lstat(target.value.path);
      if (after === undefined || !sameFileIdentity(stat, after)) continue;
      return ok({
        exists: true,
        hash,
        size: stat.size,
        identity: identityOf(stat),
        meta,
      });
    } catch (error) {
      return err(diskFailure(error));
    }
  }
  return fail("unavailable", "file changed while reading");
}

// 헤더를 읽은 그대로인 파일의 한 창을 읽는다. 파일이 바뀌었으면(identity가 다르거나 창이
// 파일 밖이거나 읽은 길이가 모자라면) 일부 바이트로 꾸미지 않고 오류다: 바뀐 파일은
// conflict, 모자란 읽기는 unavailable이다.
export async function readWindow(
  deps: FileDeps,
  request: PrepWindow,
): Promise<Result<Uint8Array, FileFailure>> {
  const { ops } = deps;
  const target = await resolveTarget(
    ops,
    request.location.root,
    request.location.path,
  );
  if (!target.ok) return target;
  const stat = target.value.stat;
  if (stat === undefined) return fail("conflict", "the file changed");
  if (!sameIdentity(stat, request.identity)) {
    return fail("conflict", "the file changed");
  }
  if (request.offset + request.length > stat.size) {
    return fail("conflict", "the file changed");
  }
  try {
    const bytes = await ops.readRange(
      target.value.path,
      request.offset,
      request.length,
    );
    if (bytes.length !== request.length) {
      return fail("unavailable", "file changed while reading");
    }
    // 읽은 뒤에도 같은 파일이어야 한다.
    const after = await ops.lstat(target.value.path);
    if (after === undefined || !sameIdentity(after, request.identity)) {
      return fail("conflict", "the file changed");
    }
    return ok(bytes);
  } catch (error) {
    return err(diskFailure(error));
  }
}

async function readMeta(
  deps: FileDeps,
  location: FileLocation,
): Promise<unknown> {
  if (location.meta === undefined) return null;
  try {
    const target = await resolveTarget(deps.ops, location.root, location.meta);
    if (!target.ok || target.value.stat === undefined) return null;
    const { bytes } = await slurp(deps.ops, target.value.path);
    return JSON.parse(textDecoder.decode(bytes));
  } catch {
    // 읽거나 풀지 못한 metadata는 없는 것으로 다룬다. 사본 내용은 그대로 읽힌다.
    return null;
  }
}

// 파일을 쓰고, 새 working copy라면 metadata를 한 번 만든다. metadata 실패는 이미 성공한
// 파일 쓰기를 실패로 바꾸지 않는다(file-tracking#R15).
export async function writeLocation(
  deps: FileDeps,
  request: PrepWrite,
  content: AsyncIterable<Uint8Array>,
): Promise<Result<FileDone, FileFailure>> {
  const done = await writeFile(deps, {
    root: request.location.root,
    path: request.location.path,
    baseHash: request.base_hash,
    content,
    contentHash: request.content.hash,
    ...(request.location.temp_root === undefined
      ? {}
      : { tempRoot: request.location.temp_root }),
  });
  if (!done.ok || request.meta_create === undefined) return done;
  const metaPath = request.location.meta;
  if (metaPath === undefined) return done;
  const bytes = textEncoder.encode(request.meta_create);
  await writeFile(deps, {
    root: request.location.root,
    path: metaPath,
    baseHash: null,
    content: (async function* () {
      yield bytes;
    })(),
    contentHash: createHash("sha256").update(bytes).digest("hex"),
  });
  return done;
}

// 확정한 판이 바뀌었다. 사본 metadata의 연 판과 마지막 확정 내용을 새로 쓴다.
export async function confirmCopy(
  deps: FileDeps,
  input: {
    root: string;
    meta: string;
    baseVersion: string;
    confirmedHash: string;
  },
): Promise<Result<void, FileFailure>> {
  const target = await resolveTarget(deps.ops, input.root, input.meta);
  if (!target.ok) return target;
  if (target.value.stat === undefined) {
    return fail("invalid_input", "target is not available");
  }
  let current: { bytes: Uint8Array; hash: string };
  try {
    current = await slurp(deps.ops, target.value.path);
  } catch (error) {
    return err(diskFailure(error));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(textDecoder.decode(current.bytes));
  } catch {
    return fail("invalid_input", "target is not available");
  }
  const meta = parseWorkingCopyMeta(parsed);
  if (meta === undefined) {
    return fail("invalid_input", "target is not available");
  }
  const bytes = encodeWorkingCopyMeta({
    ...meta,
    base_version: input.baseVersion,
    confirmed_hash: input.confirmedHash,
  });
  const written = await writeFile(deps, {
    root: input.root,
    path: input.meta,
    baseHash: current.hash,
    content: (async function* () {
      yield bytes;
    })(),
    contentHash: createHash("sha256").update(bytes).digest("hex"),
  });
  return written.ok ? ok(undefined) : written;
}
