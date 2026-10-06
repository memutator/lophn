// 사람 파일 쓰기 알고리즘(file-tracking#R11, R12, R16). 저장·이름 변경·삭제 모두
// 1) 같은 canonical 목표의 작업을 줄 세우고 2) 시작에 base_hash를 실제 파일과 대조하고
// 3) 교체 직전에 경계·file identity·hash를 다시 대조한 뒤 4) 원자 교체한다.
// 확인된 충돌에는 쓰지 않는다. 마지막 대조와 교체 사이의 외부 쓰기는 막지 못한다
// (공동 잠금이 없다). 그래서 교체 뒤 파일을 다시 읽어 changed_again을 낸다.
// 원자 교체·no-replace 설치를 지원하지 않으면 복사 덮어쓰기로 바꾸지 않고 unavailable이다.
import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  dirname,
  diskFailure,
  fail,
  type FileClock,
  type FileFailure,
  FileOpFault,
  type FileOps,
  type FileSerializer,
  hashFile,
  type ResolvedTarget,
  resolveTarget,
  sameFileIdentity,
  type TempFile,
  tempNameFor,
} from "./file-ops.ts";

export type FileDeps = {
  ops: FileOps;
  serializer: FileSerializer;
  clock: FileClock;
  // 임시 파일 이름에 쓰는 난수 token. 호출마다 다른 값이어야 한다.
  token(): string;
};

// FileOperationResult의 파일 쪽 사실. 본문은 없고 경로와 hash만 있다.
export type FileDone = {
  outcome: "written" | "renamed" | "deleted" | "unverified";
  beforePath: string | null;
  afterPath: string | null;
  beforeHash: string | null;
  writtenHash: string | null;
  observedHash: string | null;
  observedAt: string | null;
  changedAgain: boolean | null;
};

export type WriteInput = {
  root: string;
  path: string;
  // 기존 파일이면 수정 전 실제 hash, 새 파일이면 null(없어야 한다).
  baseHash: string | null;
  // 새 바이트. 한 번만 읽는다.
  content: AsyncIterable<Uint8Array>;
  // 호출자가 준 내용의 hash. 실제로 쓴 바이트의 hash와 다르면 설치하지 않는다.
  contentHash: string;
  // 임시 파일을 둘 폴더. 없으면 목표의 폴더다. 목표 폴더를 쓸 수 없는 전역 지침 파일이 쓴다
  // (같은 파일 시스템 안의 교체여야 하고, 아니면 복사로 바꾸지 않고 unavailable이다).
  tempRoot?: string;
};

type Done = Result<FileDone, FileFailure>;

// 교체 직전까지의 임시 파일을 지운다. 지우지 못해도 결과를 바꾸지 않는다.
async function discard(
  ops: FileOps,
  temp: string,
  handle?: TempFile,
): Promise<void> {
  try {
    await handle?.close();
  } catch { /* 이미 닫혔다 */ }
  try {
    await ops.remove(temp);
  } catch { /* 안 남는 것이 목표지 결과가 아니다 */ }
}

// 시작에 목표를 다시 풀고 base_hash를 실제 파일과 대조한다.
async function compareBase(
  ops: FileOps,
  target: ResolvedTarget,
  baseHash: string | null,
): Promise<Result<string | null, FileFailure>> {
  if (baseHash === null) {
    return target.stat === undefined
      ? ok(null)
      : fail("conflict", "target already exists");
  }
  if (target.stat === undefined) return fail("conflict", "target is gone");
  let current: string;
  try {
    current = await hashFile(ops, target.path);
  } catch (error) {
    return err(diskFailure(error));
  }
  return current === baseHash ? ok(current) : fail("conflict", "base differs");
}

// 교체 직전 재검사. 경계·file identity·hash가 처음 본 것과 같아야 한다.
async function recheck(
  ops: FileOps,
  root: string,
  path: string,
  first: ResolvedTarget,
  baseHash: string | null,
): Promise<Result<void, FileFailure>> {
  const again = await resolveTarget(ops, root, path);
  if (!again.ok) return again;
  if (again.value.path !== first.path) return fail("conflict", "target moved");
  if (baseHash === null) {
    return again.value.stat === undefined
      ? ok(undefined)
      : fail("conflict", "target already exists");
  }
  const before = first.stat;
  const now = again.value.stat;
  if (before === undefined || now === undefined) {
    return fail("conflict", "target is gone");
  }
  if (!sameFileIdentity(before, now)) return fail("conflict", "file replaced");
  let hash: string;
  try {
    hash = await hashFile(ops, first.path);
  } catch (error) {
    return err(diskFailure(error));
  }
  return hash === baseHash ? ok(undefined) : fail("conflict", "base differs");
}

async function observe(
  deps: FileDeps,
  path: string,
  expected: string | null,
): Promise<
  Pick<FileDone, "observedHash" | "observedAt" | "changedAgain">
> {
  try {
    const hash = await hashFile(deps.ops, path);
    return {
      observedHash: hash,
      observedAt: deps.clock.nowIso(),
      changedAgain: hash !== expected,
    };
  } catch {
    // 다시 읽지 못했다. 바뀌었는지 모른다.
    return { observedHash: null, observedAt: null, changedAgain: null };
  }
}

export function writeFile(
  deps: FileDeps,
  input: WriteInput,
): Promise<Done> {
  return withTarget(
    deps,
    input.root,
    input.path,
    (target) => writeOnce(deps, input, target),
  );
}

// 같은 canonical 목표의 작업은 줄을 서므로, 줄에 선 뒤에 목표를 다시 푼다.
async function withTarget(
  deps: FileDeps,
  root: string,
  path: string,
  work: (target: ResolvedTarget) => Promise<Done>,
): Promise<Done> {
  const resolved = await resolveTarget(deps.ops, root, path);
  if (!resolved.ok) return resolved;
  return await deps.serializer.run(resolved.value.path, async () => {
    const fresh = await resolveTarget(deps.ops, root, path);
    if (!fresh.ok) return fresh;
    return await work(fresh.value);
  });
}

async function writeOnce(
  deps: FileDeps,
  input: WriteInput,
  target: ResolvedTarget,
): Promise<Done> {
  const { ops } = deps;
  const base = await compareBase(ops, target, input.baseHash);
  if (!base.ok) return base;
  const beforeHash = base.value;

  const temp = tempNameFor(input.tempRoot ?? target.parent, deps.token());
  let handle: TempFile;
  try {
    handle = await ops.createTemp(
      temp,
      target.stat?.mode == null ? null : target.stat.mode & 0o777,
    );
  } catch (error) {
    return err(diskFailure(error));
  }
  const hash = createHash("sha256");
  try {
    for await (const chunk of input.content) {
      await handle.write(chunk);
      hash.update(chunk);
    }
    await handle.sync();
    await handle.close();
  } catch (error) {
    await discard(ops, temp, handle);
    return err(diskFailure(error));
  }
  const writtenHash = hash.digest("hex");
  if (writtenHash !== input.contentHash) {
    await discard(ops, temp);
    return fail("invalid_input", "content does not match its hash");
  }

  const checked = await recheck(
    ops,
    input.root,
    input.path,
    target,
    input.baseHash,
  );
  if (!checked.ok) {
    await discard(ops, temp);
    return checked;
  }
  try {
    if (input.baseHash === null) {
      await ops.install(temp, target.path);
      await discard(ops, temp);
    } else {
      await ops.replace(temp, target.path);
    }
  } catch (error) {
    return await replaceFailed(deps, {
      error,
      temp,
      path: target.path,
      baseHash: input.baseHash,
      writtenHash,
    });
  }
  await ops.syncDirectory(target.parent);
  const observed = await observe(deps, target.path, writtenHash);
  return ok({
    outcome: "written",
    beforePath: input.baseHash === null ? null : target.path,
    afterPath: target.path,
    beforeHash,
    writtenHash,
    ...observed,
  });
}

// 교체 호출이 실패했다. 실제로 교체됐는지 현재 파일로 가린다. 교체되지 않았으면 이전
// 상태 그대로고 unavailable이다. 알 수 없으면 unverified로 돌려주고 자동으로 다시 쓰지 않는다.
async function replaceFailed(
  deps: FileDeps,
  failed: {
    error: unknown;
    temp: string;
    path: string;
    baseHash: string | null;
    writtenHash: string;
  },
): Promise<Done> {
  const { ops } = deps;
  // 새 파일 자리에 누가 먼저 만들었다. 덮지 않는다.
  if (failed.error instanceof FileOpFault && failed.error.kind === "exists") {
    await discard(ops, failed.temp);
    return fail("conflict", "target already exists");
  }
  let current: string | null;
  try {
    current = (await ops.lstat(failed.path)) === undefined
      ? null
      : await hashFile(ops, failed.path);
  } catch {
    await discard(ops, failed.temp);
    return ok({
      outcome: "unverified",
      beforePath: failed.baseHash === null ? null : failed.path,
      afterPath: failed.path,
      beforeHash: failed.baseHash,
      writtenHash: failed.writtenHash,
      observedHash: null,
      observedAt: null,
      changedAgain: null,
    });
  }
  await discard(ops, failed.temp);
  if (current === failed.writtenHash) {
    return ok({
      outcome: "written",
      beforePath: failed.baseHash === null ? null : failed.path,
      afterPath: failed.path,
      beforeHash: failed.baseHash,
      writtenHash: failed.writtenHash,
      observedHash: current,
      observedAt: deps.clock.nowIso(),
      changedAgain: false,
    });
  }
  if (current === failed.baseHash) return err(diskFailure(failed.error));
  return ok({
    outcome: "unverified",
    beforePath: failed.baseHash === null ? null : failed.path,
    afterPath: failed.path,
    beforeHash: failed.baseHash,
    writtenHash: failed.writtenHash,
    observedHash: current,
    observedAt: deps.clock.nowIso(),
    changedAgain: true,
  });
}

export type RenameInput = {
  root: string;
  path: string;
  newPath: string;
  baseHash: string;
};

// 새 이름은 no-replace다: 새 이름을 hard link로 만들어 이미 있으면 거절하고, 옛 이름은
// 새 이름이 같은 내용임을 다시 확인한 뒤에 지운다. 중간에 끊기면 두 이름이 같은
// 파일을 가리킬 뿐 내용을 잃지 않는다.
export function renameFile(
  deps: FileDeps,
  input: RenameInput,
): Promise<Done> {
  return withTarget(deps, input.root, input.path, async (source) => {
    const { ops } = deps;
    if (source.stat === undefined) return fail("conflict", "target is gone");
    const destination = await resolveTarget(ops, input.root, input.newPath);
    if (!destination.ok) return destination;
    if (destination.value.path === source.path) {
      return fail("invalid_input", "target is not available");
    }
    const based = await compareBase(ops, source, input.baseHash);
    if (!based.ok) return based;
    // 새 이름도 같은 줄에 선다: 같은 새 이름으로 두 작업이 동시에 들어오지 못한다.
    return await deps.serializer.run(destination.value.path, async () => {
      const again = await resolveTarget(ops, input.root, input.newPath);
      if (!again.ok) return again;
      if (again.value.stat !== undefined) {
        return fail("conflict", "target already exists");
      }
      try {
        await ops.install(source.path, again.value.path);
      } catch (error) {
        return err(diskFailure(error));
      }
      const moved = await verifyMoved(deps, source, again.value.path, input);
      if (!moved.ok) {
        try {
          await ops.remove(again.value.path);
        } catch { /* 새 이름이 남아도 같은 파일이라 내용은 잃지 않는다 */ }
        return moved;
      }
      try {
        await ops.remove(source.path);
      } catch (error) {
        return err(diskFailure(error));
      }
      await ops.syncDirectory(source.parent);
      if (again.value.parent !== source.parent) {
        await ops.syncDirectory(again.value.parent);
      }
      const observed = await observe(deps, again.value.path, input.baseHash);
      return ok({
        outcome: "renamed",
        beforePath: source.path,
        afterPath: again.value.path,
        beforeHash: input.baseHash,
        writtenHash: null,
        ...observed,
      });
    });
  });
}

// 옛 이름을 지우기 직전, 새 이름이 처음 비교한 내용 그대로이고 옛 파일이 그대로다.
async function verifyMoved(
  deps: FileDeps,
  source: ResolvedTarget,
  newPath: string,
  input: RenameInput,
): Promise<Result<void, FileFailure>> {
  const still = await recheck(
    deps.ops,
    input.root,
    input.path,
    source,
    input.baseHash,
  );
  if (!still.ok) return still;
  try {
    return (await hashFile(deps.ops, newPath)) === input.baseHash
      ? ok(undefined)
      : fail("conflict", "base differs");
  } catch (error) {
    return err(diskFailure(error));
  }
}

export type DeleteInput = {
  root: string;
  path: string;
  baseHash: string;
};

export function deleteFile(
  deps: FileDeps,
  input: DeleteInput,
): Promise<Done> {
  return withTarget(deps, input.root, input.path, async (target) => {
    const { ops } = deps;
    const based = await compareBase(ops, target, input.baseHash);
    if (!based.ok) return based;
    // 삭제 직전에 목표를 다시 확인한다. 이 뒤 바뀐 것은 막지 못한다.
    const checked = await recheck(
      ops,
      input.root,
      input.path,
      target,
      input.baseHash,
    );
    if (!checked.ok) return checked;
    try {
      await ops.remove(target.path);
    } catch (error) {
      return err(diskFailure(error));
    }
    await ops.syncDirectory(dirname(target.path));
    // 지운 자리에 누가 다시 만들었는지 본다.
    let again: Pick<FileDone, "observedHash" | "observedAt" | "changedAgain"> =
      {
        observedHash: null,
        observedAt: null,
        changedAgain: null,
      };
    try {
      if ((await ops.lstat(target.path)) !== undefined) {
        again = await observe(deps, target.path, null);
      }
    } catch { /* 재관측하지 못했다 */ }
    return ok({
      outcome: "deleted",
      beforePath: target.path,
      afterPath: null,
      beforeHash: input.baseHash,
      writtenHash: null,
      ...again,
    });
  });
}
