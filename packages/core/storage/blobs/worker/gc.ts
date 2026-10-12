// I/O worker의 blob GC 파일 작업(blob contract, platform/blob-store#R8–R11,
// R13). 관측·실제 삭제는 이 worker만 한다. core는 판정값만 받고 파일을 열지
// 않는다. backup 중(backup.pending 표시가 남은 folder가 있으면) GC 불가다.
// 삭제는 새 준비를 막은 뒤(새 준비·command 차단) 고정 blob_refs 전체와 대조한다.

import { err, ok, type Result } from "../../../../base/mod.ts";
import { BLOB_UNREFERENCED_GRACE_MS } from "../../../../protocol/storage/mod.ts";
import {
  backupPendingFolders,
  BLOB_CAPACITY_MAX_BYTES,
  type InstalledBlob,
  referencedOf,
  staleTemporary,
  trimTargets,
  unreferencedGracePassed,
} from "../mod.ts";

// GC 관측(실제 삭제 없음). 미참조 수와 삭제 자격 수만 센다.
export type GcObservation = {
  installed: number;
  unreferenced: number;
  // 유예기간이 지나 삭제 자격이 있는 수.
  deletable: number;
  // 상한을 넘은 큰 자료 종류.
  over: readonly { category: string; usedBytes: number; maxBytes: number }[];
  // backup 중이면 GC 불가다.
  backupPending: number;
};

// GC 결과. R11의 구별. 참조 차단·반환 차단·OS 삭제·사본 잔존을 혼동하지 않는다.
export type GcOutcome = {
  // 유예기간 뒤 실제로 지운 hash(OS 삭제).
  deleted: readonly string[];
  // 참조 차단: 참조가 있어 대상에서 뺀 hash. 파일은 남는다.
  blocked: readonly string[];
  // 지우지 못한 hash(OS 실패).
  failed: readonly { hash: string; code: string }[];
  // 다른 사본이 남아 있는지. backup 폴더의 blob 사본은 잔존이다.
  copiesRemain: boolean;
};

// 대상 관측값. I/O worker가 파일에서 잡아 넣는다.
export type GcDeps = {
  root: string;
  // 설치 blob의 파일 관측. hash 폴더 2자를 순회한다.
  listInstalled(): Promise<
    Result<readonly (InstalledBlob & { registeredAtMs: number })[]>
  >;
  // 고정 ledger의 모든 blob_refs hash 관측. 정지 유지보수에서 읽는다.
  // 알 수 없으면 없다: 참조 모름 상태다. 관측은 참조를 모르면 기록을
  // 하나도 만들거나 지우지 않는다(unknown ≠ unreferenced).
  listReferences?(): Promise<Result<readonly { hash: string }[]>>;
  // 미참조 확인 기록 관측. 처음 확인 시각만 남긴 worker 관리 파일이다.
  // 유예기간 판정은 이 기록만 본다: 기록 없는 hash는 지금부터 미참조다.
  listUnreferenced(): Promise<
    Result<ReadonlyMap<string, number>>
  >;
  // 미참조 확인 기록 남기기. 알 수 있는 관측(collectGarbage)만 부른다.
  // 처음 확인한 시각. 이미 있으면 바꾸지 않는다.
  recordUnreferenced?(hash: string, atMs: number): Promise<Result<void>>;
  // 다시 참조된 hash의 미참조 기록 지우기(유예기간이 새로 섞인다).
  forgetUnreferenced?(hash: string): Promise<Result<void>>;
  // backup 폴더의 pending 표시 관측. pending이 남아 있으면 backup 중이다.
  listBackupPending(): Promise<
    Result<readonly { name: string; pending: boolean }[]>
  >;
  // 유예기간 뒤 실제 파일 삭제.
  removeBlob(hash: string): Promise<Result<void>>;
  // 임시 준비 파일 관측·정리. 진행 중 아님을 확인한 뒤에만 지운다.
  listTmp(): Promise<Result<readonly { name: string; observedAtMs: number }[]>>;
  removeTmp(name: string): Promise<Result<void>>;
  // 준비 등록(garbage 조립이 아닌 live 준비) 중 hash 관측. 준비 중 blob은
  // 어느 정리의 대상도 아니다. 없으면 tmp 관측만으로 준비를 판정한다.
  preparationRefs?(): Promise<Result<readonly { hash: string }[]>>;
  nowMs(): number;
  graceMs?: number;
  // 관측의 유예기간은 삭제와 같다. 테스트가 짧게 줄인다.
};

// GC 관측. 실제 삭제는 하지 않는다. 기동 시와 매일 부른다. 참조를 아는
// 관측만 미참조 확인 시각을 기록한다(유예기간의 근원): 참조 행 관측이
// 없으면 기록을 하나도 만들거나 지우지 않는다(unknown ≠ unreferenced —
// 참조를 모르는 상태에서 기록을 남기면 유예기간의 근거가 흐트러진다).
export async function observeBlobGc(
  deps: GcDeps,
): Promise<Result<GcObservation>> {
  const installed = await deps.listInstalled();
  if (!installed.ok) return installed;
  const backups = await deps.listBackupPending();
  if (!backups.ok) return backups;
  const grace = deps.graceMs ?? BLOB_UNREFERENCED_GRACE_MS;
  const pending = backupPendingFolders(backups.value);
  const now = deps.nowMs();
  // 참조 행 관측이 없으면 참조 모름 상태다. 기록을 하나도 만들거나
  // 지우지 않고, deleting 자격 수도 모른다(unknown 참조).
  if (deps.listReferences === undefined) {
    return ok({
      installed: installed.value.length,
      unreferenced: 0,
      deletable: 0,
      over: [],
      backupPending: pending.length,
    });
  }
  const references = await deps.listReferences();
  if (!references.ok) return references;
  const records = await deps.listUnreferenced();
  if (!records.ok) return records;
  const referenced = referencedOf(references.value);
  for (const blob of installed.value) {
    if (referenced.has(blob.hash)) {
      if (records.value.has(blob.hash)) {
        if (deps.forgetUnreferenced === undefined) {
          return err({
            code: "invalid_input",
            message: "미참조 기록 지우기 관측이 없다",
          });
        }
        const forgotten = await deps.forgetUnreferenced(blob.hash);
        if (!forgotten.ok) return forgotten;
      }
      continue;
    }
    if (!records.value.has(blob.hash)) {
      if (deps.recordUnreferenced === undefined) {
        return err({
          code: "invalid_input",
          message: "미참조 기록 관측이 없다",
        });
      }
      const recorded = await deps.recordUnreferenced(blob.hash, now);
      if (!recorded.ok) return recorded;
    }
  }
  // 기록 갱신 뒤 삭제 자격 수를 센다(처음 확인 시각 + 유예기간).
  const refreshed = await deps.listUnreferenced();
  if (!refreshed.ok) return refreshed;
  const unref = installed.value.filter((blob) => !referenced.has(blob.hash));
  const deletable = unref.filter((blob) =>
    unreferencedGracePassed(
      parseRecord(refreshed.value.get(blob.hash)),
      now,
      grace,
    )
  );
  return ok({
    installed: installed.value.length,
    unreferenced: unref.length,
    deletable: deletable.length,
    over: [],
    backupPending: pending.length,
  });
}

// 임시 준비 파일 정리. 재시작 뒤 부른다. 진행 중 아님을 확인한 뒤에만
// 지운다: 살아 있는 준비 worker가 쓰는 임시 파일은 지우지 않는다. 관측은
// 파일 시각 하나이고, 유예기간 안의 파일은 남는다.
export async function clearTemporary(
  deps: Pick<GcDeps, "listTmp" | "removeTmp" | "nowMs" | "graceMs">,
): Promise<Result<readonly string[]>> {
  const list = await deps.listTmp();
  if (!list.ok) return list;
  const grace = deps.graceMs ?? BLOB_UNREFERENCED_GRACE_MS;
  const cleared: string[] = [];
  for (const entry of list.value) {
    if (!staleTemporary(entry.observedAtMs, deps.nowMs(), grace)) continue;
    const removed = await deps.removeTmp(entry.name);
    if (removed.ok) cleared.push(entry.name);
  }
  return ok(cleared);
}

// 실제 GC. 정지 유지보수에서만 부른다. 세 순서:
// backup.pending이 있으면 거절(backup 중 GC 불가) → 고정 참조 대조 →
// 유예기간 통과분만 파일 삭제. writer 정지·새 준비 차단은 부르는 쪽(core
// 조립·I/O worker의 scheduler)이 세운다. 관측과 삭제 사이의 경합(writer
// 정지 뒤 참조가 늘지 않음)도 부르는 쪽의 몫이다. 참조된 blob은 blocked에
// 세고 지우지 않는다.
export async function collectGarbage(
  deps: GcDeps,
): Promise<Result<GcOutcome>> {
  const backups = await deps.listBackupPending();
  if (!backups.ok) return backups;
  if (backupPendingFolders(backups.value).length > 0) {
    return err({
      code: "conflict",
      message: "backup이 진행 중이라 GC를 실행하지 않는다",
    });
  }
  const installed = await deps.listInstalled();
  if (!installed.ok) return installed;
  if (deps.listReferences === undefined) {
    return err({
      code: "invalid_input",
      message: "고정 참조 관측이 없다",
    });
  }
  const references = await deps.listReferences();
  if (!references.ok) return references;
  // 미참조 확인 기록. 유예기간 판정은 이 기록만 본다: 파일 mtime이
  // 아니라 처음 미참조를 확인한 시각부터 센다. 기록 없는 hash는 지금부터
  // 미참조라 이번에 지우지 않는다(fail-closed).
  const records = await deps.listUnreferenced();
  if (!records.ok) return records;
  const grace = deps.graceMs ?? BLOB_UNREFERENCED_GRACE_MS;
  const referenced = referencedOf(references.value);
  // 참조 차단: 참조가 있으면 어느 시점에도 지우지 않는다. 결과에만
  // 세어 읽을 수 있게 한다.
  const blocked = installed.value
    .filter((blob) => referenced.has(blob.hash))
    .map((blob) => blob.hash);
  // 미참조 확인 기록 갱신: 처음 본 hash는 지금 시각으로 남기고, 다시
  // 참조된 hash의 기록은 지운다(유예기간이 새로 섞인다).
  const now = deps.nowMs();
  for (const blob of installed.value) {
    if (referenced.has(blob.hash)) {
      if (records.value.has(blob.hash)) {
        if (deps.forgetUnreferenced === undefined) {
          return err({
            code: "invalid_input",
            message: "미참조 기록 지우기 관측이 없다",
          });
        }
        const forgotten = await deps.forgetUnreferenced(blob.hash);
        if (!forgotten.ok) return forgotten;
      }
      continue;
    }
    if (!records.value.has(blob.hash)) {
      if (deps.recordUnreferenced === undefined) {
        return err({
          code: "invalid_input",
          message: "미참조 기록 관측이 없다",
        });
      }
      const recorded = await deps.recordUnreferenced(blob.hash, now);
      if (!recorded.ok) return recorded;
    }
  }
  // 기록 갱신 뒤 판정한다. 삭제 자격은 기록의 처음 확인 시각과 유예기간으로만 본다.
  const refreshed = await deps.listUnreferenced();
  if (!refreshed.ok) return refreshed;
  const deletable = installed.value
    .filter((blob) => !referenced.has(blob.hash))
    .filter((blob) =>
      unreferencedGracePassed(
        parseRecord(refreshed.value.get(blob.hash)),
        now,
        grace,
      )
    );
  const deleted: string[] = [];
  const failed: { hash: string; code: string }[] = [];
  let copiesRemain = false;
  for (const blob of deletable) {
    const removed = await deps.removeBlob(blob.hash);
    if (removed.ok) {
      deleted.push(blob.hash);
      // backup 폴더에 사본이 남는지. 사본의 잔존은 삭제와 다르다.
      if (!copiesRemain && await backupCopyExists(deps.root, blob.hash)) {
        copiesRemain = true;
      }
    } else failed.push({ hash: blob.hash, code: removed.error.code });
  }
  return ok({
    deleted,
    blocked,
    failed,
    copiesRemain,
  });
}

// 미참조 기록의 시각을 검사한다. 모양이 다르면 기록 없음으로 본다(fail-closed).
function parseRecord(atMs: number | undefined) {
  if (atMs === undefined || !Number.isFinite(atMs) || atMs < 0) {
    return undefined;
  }
  return { unreferencedAtMs: atMs };
}

// 종류별 보존 정리. capacity field의 큰 자료가 상한을 넘으면 오래된
// 것부터 정리한다. permanent field(변경 기록·결정·확정 결과)는 대상에서 뺀다.
// 준비 중(tmp 또는 준비 등록)과 미참조 확인 유예기간 안의 blob은 정리 대상에서
// 뺀다(유예기간은 미참조 확인 기록의 시각부터 센다). 할당에 없거나 상한
// 밖 category가 있으면 아무것도 지우지 않고 fail-closed다. 관측과 삭제 사이의
// 경합(writer 정지·새 준비 차단)은 부르는 쪽(정지 유지보수 조립)이 세운다.
export async function trimCapacity(
  deps: GcDeps,
  // hash → 종류 할당. 참조 field 규칙과 준비가 남긴 목적 기록에서 온다.
  assignment: ReadonlyMap<string, { category: string; permanent: boolean }>,
): Promise<Result<GcOutcome>> {
  const backups = await deps.listBackupPending();
  if (!backups.ok) return backups;
  if (backupPendingFolders(backups.value).length > 0) {
    return err({
      code: "conflict",
      message: "backup이 진행 중이라 보존 정리를 실행하지 않는다",
    });
  }
  // 할당 밖 category는 fail-closed다. 잘못된 category로 지우지 않는다.
  const categories = new Set(
    Object.keys(BLOB_CAPACITY_MAX_BYTES),
  );
  for (const [hash, known] of assignment) {
    if (!categories.has(known.category)) {
      return err({
        code: "invalid_input",
        message: `blob ${hash.slice(0, 8)}의 category가 상한 밖이다`,
      });
    }
  }
  const installed = await deps.listInstalled();
  if (!installed.ok) return installed;
  // 할당이 없는 설치 blob도 fail-closed다. 어느 종류인지 모르면 지우지 않는다.
  for (const blob of installed.value) {
    if (!assignment.has(blob.hash)) {
      return err({
        code: "unavailable",
        message: `blob ${blob.hash.slice(0, 8)}의 종류를 모른다`,
      });
    }
  }
  const grace = deps.graceMs ?? BLOB_UNREFERENCED_GRACE_MS;
  const now = deps.nowMs();
  // 미참조 확인 기록. trim의 유예기간도 이 기록부터 센다. 기록 없는
  // hash는 지금부터 미참조라 정리하지 않는다(fail-closed).
  const records = await deps.listUnreferenced();
  if (!records.ok) return records;
  // 준비 등록 중 hash. 준비 중 blob은 trim 대상에서 뺀다.
  let preparing: ReadonlySet<string> = new Set();
  if (deps.preparationRefs) {
    const preparation = await deps.preparationRefs();
    if (!preparation.ok) return preparation;
    preparing = referencedOf(preparation.value);
  }
  const explicit = Object.entries(BLOB_CAPACITY_MAX_BYTES).map((
    [category, maxBytes],
  ) => ({ category, maxBytes }));
  const used = new Map<string, number>();
  for (const blob of installed.value) {
    const known = assignment.get(blob.hash);
    if (known === undefined || known.permanent) continue;
    used.set(known.category, (used.get(known.category) ?? 0) + blob.sizeBytes);
  }
  const usage = explicit
    .filter((entry) => used.has(entry.category))
    .map((entry) => ({
      category: entry.category as keyof typeof BLOB_CAPACITY_MAX_BYTES,
      usedBytes: used.get(entry.category) ?? 0,
      maxBytes: entry.maxBytes,
    }));
  const candidates = installed.value
    .map((blob) => {
      const known = assignment.get(blob.hash);
      if (known === undefined) return undefined;
      return {
        ...blob,
        category: known.category as keyof typeof BLOB_CAPACITY_MAX_BYTES,
        permanent: known.permanent,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    // 준비 중(등록 또는 tmp 파일 시각)과 미참조 확인 기록의 유예기간 안인
    // blob은 정리 대상에서 뺀다(유예기간은 기록의 시각부터 센다).
    .filter((entry) =>
      !preparing.has(entry.hash) &&
      unreferencedGracePassed(
        parseRecord(records.value.get(entry.hash)),
        now,
        grace,
      )
    );
  const targets = trimTargets(usage, candidates);
  const deleted: string[] = [];
  const failed: { hash: string; code: string }[] = [];
  let copiesRemain = false;
  for (const hash of targets) {
    const removed = await deps.removeBlob(hash);
    if (removed.ok) {
      deleted.push(hash);
      // backup 폴더에 사본이 남는지. 사본의 잔존은 삭제와 다르다.
      if (!copiesRemain && await backupCopyExists(deps.root, hash)) {
        copiesRemain = true;
      }
    } else failed.push({ hash, code: removed.error.code });
  }
  return ok({ deleted, blocked: [], failed, copiesRemain });
}

// backup 폴더의 blob 사본 잔존 관측. backups/<stamp>/blobs/sha256/<2>/<62>.
async function backupCopyExists(root: string, hash: string): Promise<boolean> {
  try {
    for await (const stamp of Deno.readDir(`${root}/backups`)) {
      if (!stamp.isDirectory) continue;
      try {
        await Deno.stat(
          `${root}/backups/${stamp.name}/blobs/sha256/${hash.slice(0, 2)}/${
            hash.slice(2)
          }`,
        );
        return true;
      } catch {
        // 이 stamp 폴더에 사본은 없다. 다음을 본다.
      }
    }
  } catch {
    // backups 폴더 자체가 없으면 사본도 없다.
  }
  return false;
}
