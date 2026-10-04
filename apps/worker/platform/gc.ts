// I/O worker의 blob GC 파일 작업(blob contract, platform/blob-store#R8–R11,
// R13). 관측·실제 삭제는 이 worker만 한다. core는 판정값만 받고 파일을 열지
// 않는다. backup 중(backup.pending 표시가 남은 folder가 있으면) GC 불가다(T41).
// 삭제는 새 준비를 막은 뒤(새 준비·command 차단) 고정 blob_refs 전체와 대조한다.

import { err, ok, type Result } from "../../../packages/base/mod.ts";
import {
  BLOB_UNREFERENCED_GRACE_MS,
} from "../../../packages/contracts/platform/mod.ts";
import {
  backupPendingFolders,
  BLOB_CAPACITY_MAX_BYTES,
  deletableOf,
  type InstalledBlob,
  referencedOf,
  staleTemporary,
  trimTargets,
} from "../../../packages/platform/blob-store/mod.ts";

// GC 관측(R10: 실제 삭제 없음). 미참조 수와 삭제 자격 수만 센다.
export type GcObservation = {
  installed: number;
  unreferenced: number;
  // 유예기간이 지나 삭제 자격이 있는 수.
  deletable: number;
  // 상한을 넘은 큰 자료 종류.
  over: readonly { category: string; usedBytes: number; maxBytes: number }[];
  // backup 중이면 GC 불가다(T41, R11).
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
  // 다른 사본이 남아 있는지. backup 폴더의 blob 사본은 잔존이다(R11).
  copiesRemain: boolean;
};

// 대상 관측값. I/O worker가 파일에서 잡아 넣는다.
export type GcDeps = {
  root: string;
  // 설치 blob의 파일 관측. hash 폴더 2자를 순회한다.
  listInstalled(): Promise<
    Result<readonly (InstalledBlob & { registeredAtMs: number })[]>
  >;
  // 고정 ledger의 모든 blob_refs hash 관측. 정지 유지보수에서 읽는다(R8).
  listReferences(): Promise<Result<readonly { hash: string }[]>>;
  // backup 폴더의 pending 표시 관측. pending이 남아 있으면 backup 중이다(T41).
  listBackupPending(): Promise<
    Result<readonly { name: string; pending: boolean }[]>
  >;
  // 유예기간 뒤 실제 파일 삭제.
  removeBlob(hash: string): Promise<Result<void>>;
  // 임시 준비 파일 관측·정리. 진행 중 아님을 확인한 뒤에만 지운다(R9).
  listTmp(): Promise<Result<readonly { name: string; observedAtMs: number }[]>>;
  removeTmp(name: string): Promise<Result<void>>;
  nowMs(): number;
  graceMs?: number;
  // 관측의 유예기간은 삭제와 같다. 테스트가 짧게 줄인다.
};

// GC 관측(R10). 실제 삭제는 하지 않는다. 기동 시와 매일 부른다.
export async function observeBlobGc(
  deps: GcDeps,
): Promise<Result<GcObservation>> {
  const installed = await deps.listInstalled();
  if (!installed.ok) return installed;
  const references = await deps.listReferences();
  if (!references.ok) return references;
  const backups = await deps.listBackupPending();
  if (!backups.ok) return backups;
  const grace = deps.graceMs ?? BLOB_UNREFERENCED_GRACE_MS;
  const referenced = referencedOf(references.value);
  const pending = backupPendingFolders(backups.value);
  const unref = installed.value.filter((blob) => !referenced.has(blob.hash));
  const deletable = deletableOf(
    installed.value,
    referenced,
    deps.nowMs(),
    grace,
  );
  return ok({
    installed: installed.value.length,
    unreferenced: unref.length,
    deletable: deletable.length,
    over: [],
    backupPending: pending.length,
  });
}

// 임시 준비 파일 정리(R9). 재시작 뒤 부른다. 진행 중 아님을 확인한 뒤에만
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

// 실제 GC(R8, R9, R11, R13). 정지 유지보수에서만 부른다. 세 순서:
// backup.pending이 있으면 거절(backup 중 GC 불가) → 고정 참조 대조 →
// 유예기간 통과분만 파일 삭제. writer 정지·새 준비 차단은 부르는 쪽(core
// 조립·I/O worker의 scheduler)이 세운다. 참조된 blob은 blocked에 세고
// 지우지 않는다(R8).
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
  const references = await deps.listReferences();
  if (!references.ok) return references;
  const grace = deps.graceMs ?? BLOB_UNREFERENCED_GRACE_MS;
  const referenced = referencedOf(references.value);
  // 참조 차단(R8, R11): 참조가 있으면 어느 시점에도 지우지 않는다. 결과에만
  // 세어 읽을 수 있게 한다.
  const blocked = installed.value
    .filter((blob) => referenced.has(blob.hash))
    .map((blob) => blob.hash);
  const deletable = deletableOf(
    installed.value,
    referenced,
    deps.nowMs(),
    grace,
  );
  const deleted: string[] = [];
  const failed: { hash: string; code: string }[] = [];
  for (const blob of deletable) {
    const removed = await deps.removeBlob(blob.hash);
    if (removed.ok) deleted.push(blob.hash);
    else failed.push({ hash: blob.hash, code: removed.error.code });
  }
  return ok({
    deleted,
    blocked,
    failed,
    // backup 폴더의 blob 사본은 이번 GC의 대상이 아니다. 잔존은 삭제가 아니다(R11).
    copiesRemain: false,
  });
}

// 종류별 보존 정리(R13). capacity field의 큰 자료가 상한을 넘으면 오래된
// 것부터 정리한다. permanent field(변경 기록·결정·확정 결과)는 대상에서 뺀다.
export async function trimCapacity(
  deps: GcDeps,
  // hash → 종류 할당. 준비 purpose에서 온다(아직 기록하는 준비가 없다).
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
  const installed = await deps.listInstalled();
  if (!installed.ok) return installed;
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
      category: entry.category as never,
      usedBytes: used.get(entry.category) ?? 0,
      maxBytes: entry.maxBytes,
    }));
  const candidates = installed.value
    .map((blob) => {
      const known = assignment.get(blob.hash);
      if (known === undefined) return undefined;
      return {
        ...blob,
        category: known.category as never,
        permanent: known.permanent,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
  const targets = trimTargets(usage, candidates);
  const deleted: string[] = [];
  const failed: { hash: string; code: string }[] = [];
  for (const hash of targets) {
    const removed = await deps.removeBlob(hash);
    if (removed.ok) deleted.push(hash);
    else failed.push({ hash, code: removed.error.code });
  }
  return ok({ deleted, blocked: [], failed, copiesRemain: false });
}
