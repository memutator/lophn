// I/O worker의 정지 유지보수 조립(platform/blob-store#R8, R9, R11, R13, T44).
// collectGarbage·trimCapacity는 정상 동작 중 부르지 않는다. 삭제는 세 정지
// 조건(새 준비 차단, command 차단, writer 정지)이 모두 관측될 때만 실행한다:
// 부르는 쪽이 deps의 실제 관측으로 조건을 채운다(architecture 7.5 종료 순서).
// backup.pending 표시가 남아 있으면 이번 회수를 건너뛴다(T41, R11).
// 관측(observeBlobGc)은 삭제가 아니므로 정상 동작 중에도 그대로 돈다(R10).

import { err, ok, type Result } from "../../../packages/base/mod.ts";
import {
  assignmentOf,
  backupPendingFolders,
  type RetentionRule,
} from "../../../packages/platform/blob-store/mod.ts";
import {
  collectGarbage,
  type GcDeps,
  type GcOutcome,
  trimCapacity,
} from "./gc.ts";
import { listBackupPending, listInstalledBlobs } from "./io.ts";
import {
  parsePurposeRecord,
  purposesPathFor,
} from "../../../packages/platform/blob-store/mod.ts";
import { BLOB_STORE_TMP_DIR } from "../../../packages/platform/blob-store/mod.ts";
import { objectPathFor } from "../../../packages/platform/blob-store/mod.ts";

// 정지 조건 관측값. 부르는 쪽(core 종료 조립)이 실제 관측으로 채운다.
export type StoppedConditions = {
  // 새 준비 차단: 새 blob.prepare 접수를 받지 않은 것이다.
  preparationsBlocked: boolean;
  // command 차단: 새 command 입장을 닫은 것이다(ready=false, API 정지).
  commandsBlocked: boolean;
  // writer 정지: writer Worker와 writer 메모리 참조를 닫은 것이다.
  writerStopped: boolean;
};

// 세 조건이 모두 관측됐는지. 하나라도 거짓이면 유지보수는 아무것도 하지 않는다.
export function fullyStopped(conditions: StoppedConditions): boolean {
  return conditions.preparationsBlocked && conditions.commandsBlocked &&
    conditions.writerStopped;
}

// 정지 유지보수 deps. 목록 관측은 실제 파일·ledger에서 잡아 넣는다.
export type MaintenanceDeps = {
  root: string;
  // 세 정지 조건의 실제 관측. 하나라도 거짓이면 유지보수는 실행하지 않는다.
  conditions(): StoppedConditions | Promise<StoppedConditions>;
  // 소유 concern이 등록한 blob field. 보존 종류가 함께 있다(blobFields).
  fields(): readonly RetentionRule[];
  // 고정 ledger blob_refs의 참조 행 관측. 정지 뒤 고정 blob_refs 전체다(R8).
  listReferenceRows(): Promise<
    Result<readonly { hash: string; owner_kind: string; field: string }[]>
  >;
  nowMs(): number;
  // 유예기간. 없으면 R9 7일이다. 테스트가 짧게 줄인다.
  graceMs?: number;
};

// 정지 유지보수 1회. 순서:
// 1. 세 정지 조건 확인 — 하나라도 거짓이면 아무것도 하지 않는다(R8).
// 2. backup.pending 확인 — 있으면 이번 회수를 건너뛴다(T41, R11).
// 3. trimCapacity의 할당 산출(참조 field 규칙 + 목적 기록) — 관측 실패면
//    아무것도 지우지 않는다(fail-closed).
// 4. collectGarbage(유예기간 지난 미참조분만) → trimCapacity(종류별 초과분만).
export async function runMaintenanceGc(
  deps: MaintenanceDeps,
): Promise<Result<GcOutcome>> {
  const conditions = await deps.conditions();
  if (!fullyStopped(conditions)) {
    return err({
      code: "conflict",
      message: "정지 조건이 모두 관측되지 않아 유지보수를 실행하지 않는다",
    });
  }
  const backups = await listBackupPending(deps.root);
  if (!backups.ok) return backups;
  if (backupPendingFolders(backups.value).length > 0) {
    return err({
      code: "conflict",
      message: "backup이 진행 중이라 유지보수를 건너뛴다",
    });
  }
  // blob_refs 참조 행 + 등록 field 규칙 + 목적 기록으로 trimCapacity의
  // 할당을 산다(T44). 목록 관측 실패는 아무것도 지우지 않는다(fail-closed).
  const rows = await deps.listReferenceRows();
  if (!rows.ok) return rows;
  const purposes = await readPurposeRecords(deps.root);
  if (!purposes.ok) return purposes;
  const assignment = assignmentOf(deps.fields(), rows.value, purposes.value);
  const outcome = await collectGarbage(maintenanceObservation(deps));
  if (!outcome.ok) return outcome;
  const trimmed = await trimCapacity(maintenanceObservation(deps), assignment);
  if (!trimmed.ok) return trimmed;
  return ok({
    deleted: [...outcome.value.deleted, ...trimmed.value.deleted],
    blocked: outcome.value.blocked,
    failed: [...outcome.value.failed, ...trimmed.value.failed],
    copiesRemain: outcome.value.copiesRemain || trimmed.value.copiesRemain,
  });
}

// collectGarbage·trimCapacity가 부르는 파일 관측 deps. 삭제·목록은 이 file
// worker의 실제 관측이다.
function maintenanceObservation(deps: MaintenanceDeps): GcDeps {
  return {
    root: deps.root,
    listInstalled: () => listInstalledBlobs(deps.root),
    listReferences: async () => {
      const rows = await deps.listReferenceRows();
      if (!rows.ok) return rows;
      return ok(rows.value.map((row) => ({ hash: row.hash })));
    },
    listBackupPending: () => listBackupPending(deps.root),
    removeBlob: (hash) =>
      (async () => {
        try {
          await Deno.remove(objectPathFor(deps.root, hash));
          return ok(undefined);
        } catch {
          return err({ code: "unavailable", message: "blob 삭제에 실패했다" });
        }
      })(),
    listTmp: async () => {
      const entries: { name: string; observedAtMs: number }[] = [];
      let names: string[];
      try {
        names = [
          ...Deno.readDirSync(`${deps.root}/${BLOB_STORE_TMP_DIR}`),
        ].map((entry) => entry.name);
      } catch {
        return ok([]);
      }
      for (const name of names) {
        try {
          const stat = await Deno.stat(
            `${deps.root}/${BLOB_STORE_TMP_DIR}/${name}`,
          );
          if (!stat.isFile) continue;
          entries.push({ name, observedAtMs: stat.mtime?.getTime() ?? 0 });
        } catch {
          // 관측 중 사라진 파일은 목록에서 뺀다.
        }
      }
      return ok(entries);
    },
    removeTmp: (name) =>
      (async () => {
        try {
          await Deno.remove(`${deps.root}/${BLOB_STORE_TMP_DIR}/${name}`);
          return ok(undefined);
        } catch {
          return err({
            code: "unavailable",
            message: "임시 파일 삭제에 실패했다",
          });
        }
      })(),
    nowMs: deps.nowMs,
    graceMs: deps.graceMs,
  };
}

// 목적 기록 관측(T44). 준비가 남긴 blobs/purposes/<2>/<62>.json 파일을 읽어
// hash → purpose로 모은다. 없거나 모양이 다른 기록은 건너뛴다: 정지
// 유지보수는 기록 없는 hash를 지우지 않는다(fail-closed).
export async function readPurposeRecords(
  root: string,
): Promise<Result<ReadonlyMap<string, string>>> {
  const found = new Map<string, string>();
  let prefixes: string[];
  try {
    prefixes = [...Deno.readDirSync(`${root}/blobs/purposes`)].map((
      entry,
    ) => entry.name);
  } catch {
    return ok(found);
  }
  for (const prefix of prefixes) {
    let names: string[];
    try {
      names = [
        ...Deno.readDirSync(`${root}/blobs/purposes/${prefix}`),
      ].map((entry) => entry.name);
    } catch {
      continue;
    }
    for (const name of names) {
      const hash = `${prefix}${name.replace(/\.json$/, "")}`;
      try {
        const raw: unknown = JSON.parse(
          await Deno.readTextFile(purposesPathFor(root, hash)),
        );
        const record = parsePurposeRecord(raw);
        if (record !== undefined) found.set(hash, record.purpose);
      } catch {
        // 읽지 못한 기록은 건너뛴다. 기록 없는 hash는 정리 대상이 아니다.
      }
    }
  }
  return ok(found);
}
