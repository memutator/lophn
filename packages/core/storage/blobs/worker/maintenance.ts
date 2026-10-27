// I/O worker의 정지 유지보수 조립.
// collectGarbage·trimCapacity는 정상 동작 중 부르지 않는다. 삭제는 세 정지
// 조건(새 준비 차단, command 차단, writer 정지)이 모두 관측될 때만 실행한다:
// 부르는 쪽이 deps의 실제 관측으로 조건을 채운다.
// 관측(observeBlobGc)은 삭제가 아니므로 정상 동작 중에도 그대로 돈다.

import { readdirSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { err, ok, type Result } from "../../../../base/mod.ts";
import { assignmentOf, isSha256Hash, type RetentionRule } from "../mod.ts";
import {
  collectGarbage,
  type GcDeps,
  type GcOutcome,
  trimCapacity,
} from "./gc.ts";
import { parsePurposeRecord } from "../mod.ts";
import { parseUnreferencedRecord, unreferencedPathFor } from "../mod.ts";
import { BLOB_STORE_TMP_DIR } from "../mod.ts";
import { objectPathFor } from "../mod.ts";

// GC 관측의 설치 blob 파일 목록. hash 폴더 2자 아래 나머지 62자다.
// core는 파일을 열지 않는다. 관측 실패는 없다고 본다.
export async function listInstalledBlobs(
  root: string,
): Promise<
  Result<
    readonly {
      hash: string;
      observedAtMs: number;
      sizeBytes: number;
      registeredAtMs: number;
    }[]
  >
> {
  const objects = `${root}/blobs/sha256`;
  const found: {
    hash: string;
    observedAtMs: number;
    sizeBytes: number;
    registeredAtMs: number;
  }[] = [];
  let prefixes: string[];
  try {
    prefixes = readdirSync(objects, { withFileTypes: true }).map((entry) =>
      entry.name
    );
  } catch {
    return ok([]);
  }
  for (const prefix of prefixes) {
    let names: string[];
    try {
      names = readdirSync(`${objects}/${prefix}`, { withFileTypes: true })
        .map((entry) => entry.name);
    } catch {
      continue;
    }
    for (const suffix of names) {
      try {
        const info = await stat(`${objects}/${prefix}/${suffix}`);
        if (!info.isFile()) continue;
        const at = info.mtime?.getTime() ?? 0;
        found.push({
          hash: `${prefix}${suffix}`,
          observedAtMs: at,
          sizeBytes: info.size,
          registeredAtMs: at,
        });
      } catch {
        // 관측 중 사라진 파일은 목록에서 뺀다.
      }
    }
  }
  return ok(found);
}

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
function fullyStopped(conditions: StoppedConditions): boolean {
  return conditions.preparationsBlocked && conditions.commandsBlocked &&
    conditions.writerStopped;
}

// 정지 유지보수 deps. 목록 관측은 실제 파일·ledger에서 잡아 넣는다.
type MaintenanceDeps = {
  root: string;
  // 세 정지 조건의 실제 관측. 하나라도 거짓이면 유지보수는 실행하지 않는다.
  conditions(): StoppedConditions | Promise<StoppedConditions>;
  // 소유 concern이 등록한 blob field. 보존 종류가 함께 있다(blobFields).
  fields(): readonly RetentionRule[];
  // 고정 ledger blob_refs의 참조 행 관측. 정지 뒤 고정 blob_refs 전체다.
  listReferenceRows(): Promise<
    Result<readonly { hash: string; owner_kind: string; field: string }[]>
  >;
  nowMs(): number;
  // 유예기간. 없으면 7일이다. 테스트가 짧게 줄인다.
  graceMs?: number;
};

// 정지 유지보수 1회. 순서:
// 1. 세 정지 조건 확인 — 하나라도 거짓이면 아무것도 하지 않는다.
// 2. trimCapacity의 할당 산출(참조 field 규칙 + 목적 기록) — 관측 실패면
//    아무것도 지우지 않는다(fail-closed).
// 3. collectGarbage(미참조 확인 기록의 유예기간이 지난 분만) →
//    trimCapacity(미참조 확인 기록의 유예기간이 지난 초과분만).
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
  // blob_refs 참조 행 + 등록 field 규칙 + 목적 기록으로 trimCapacity의
  // 할당을 산다. 목록 관측 실패는 아무것도 지우지 않는다(fail-closed).
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
  });
}

// 처음 확인 시각 기록. io.ts의 매일 관측과 정지 유지보수가 이 helper로
// 남긴다. 유예기간은 처음 확인한 시각부터 센다 — 부른 쪽이 기록이 없을 때만
// 부른다(collectGarbage·observeBlobGc의 기록 갱신 순서).
async function recordUnreferenced(
  root: string,
  hash: string,
  atMs: number,
): Promise<Result<void>> {
  const path = unreferencedPathFor(root, hash);
  if (!path.ok) return path;
  try {
    await mkdir(path.value.slice(0, path.value.lastIndexOf("/")), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(
      path.value,
      `${JSON.stringify({ unreferenced_at_ms: atMs })}\n`,
    );
    return ok(undefined);
  } catch {
    return err({
      code: "unavailable",
      message: "미참조 확인 기록을 남기지 못했다",
    });
  }
}

// 다시 참조된 hash의 기록 지우기(다음 미참조 확인부터 유예기간이 새로 섞인다).
async function forgetUnreferenced(
  root: string,
  hash: string,
): Promise<Result<void>> {
  const path = unreferencedPathFor(root, hash);
  if (!path.ok) return path;
  try {
    await rm(path.value);
    return ok(undefined);
  } catch {
    // 이미 사라진 기록은 사라진 것으로 둔다.
    return ok(undefined);
  }
}

// collectGarbage·trimCapacity가 부르는 파일 관측 deps. 삭제·목록·기록은 이
// file worker의 실제 관측이다.
function maintenanceObservation(deps: MaintenanceDeps): GcDeps {
  return {
    root: deps.root,
    listInstalled: () => listInstalledBlobs(deps.root),
    listReferences: async () => {
      const rows = await deps.listReferenceRows();
      if (!rows.ok) return rows;
      return ok(rows.value.map((row) => ({ hash: row.hash })));
    },
    // 미참조 확인 기록 관측. blobs/unreferenced/<2>/<62>.json이다.
    listUnreferenced: () => readUnreferencedRecords(deps.root),
    // 처음 확인 시각 기록. 이미 있는 기록은 바꾸지 않는다.
    recordUnreferenced: (hash, atMs) =>
      recordUnreferenced(deps.root, hash, atMs),
    // 다시 참조된 hash의 기록 지우기(유예기간이 새로 섞인다).
    forgetUnreferenced: (hash) => forgetUnreferenced(deps.root, hash),
    removeBlob: (hash) =>
      (async () => {
        try {
          await rm(objectPathFor(deps.root, hash));
          return ok(undefined);
        } catch {
          return err({ code: "unavailable", message: "blob 삭제에 실패했다" });
        }
      })(),
    listTmp: async () => {
      const entries: { name: string; observedAtMs: number }[] = [];
      let names: string[];
      try {
        names = readdirSync(`${deps.root}/${BLOB_STORE_TMP_DIR}`, {
          withFileTypes: true,
        }).map((entry) => entry.name);
      } catch {
        return ok([]);
      }
      for (const name of names) {
        try {
          const info = await stat(
            `${deps.root}/${BLOB_STORE_TMP_DIR}/${name}`,
          );
          if (!info.isFile()) continue;
          entries.push({ name, observedAtMs: info.mtime?.getTime() ?? 0 });
        } catch {
          // 관측 중 사라진 파일은 목록에서 뺀다.
        }
      }
      return ok(entries);
    },
    removeTmp: (name) =>
      (async () => {
        try {
          await rm(`${deps.root}/${BLOB_STORE_TMP_DIR}/${name}`);
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

// 목적 기록 관측. 준비가 남긴 blobs/purposes/<2>/<62>.json 파일을 읽어
// hash → purpose로 모은다. 없거나 모양이 다른 기록은 건너뛴다: 정지
// 유지보수는 기록 없는 hash를 지우지 않는다(fail-closed).
async function readPurposeRecords(
  root: string,
): Promise<Result<ReadonlyMap<string, string>>> {
  const found = new Map<string, string>();
  const read = await readRecordDir(`${root}/blobs/purposes`);
  if (!read.ok) return read;
  for (const [hash, raw] of read.value) {
    const record = parsePurposeRecord(raw);
    if (record !== undefined) found.set(hash, record.purpose);
  }
  return ok(found);
}

// 미참조 확인 기록 관측. blobs/unreferenced/<2>/<62>.json 파일을 읽어
// hash → 처음 확인 시각으로 모은다. 없거나 모양이 다른 기록은 건너뛴다:
// 기록 없는 hash는 지금부터 미참조다(fail-closed).
export async function readUnreferencedRecords(
  root: string,
): Promise<Result<ReadonlyMap<string, number>>> {
  const found = new Map<string, number>();
  const read = await readRecordDir(`${root}/blobs/unreferenced`);
  if (!read.ok) return read;
  for (const [hash, raw] of read.value) {
    const record = parseUnreferencedRecord(raw);
    if (record !== undefined) found.set(hash, record.unreferencedAtMs);
  }
  return ok(found);
}

// 기록 폴더 순회. blobs/<name>/<2>/<62>.json을 JSON으로 모은다. 이름에서
// hash로 만들 때 sha256 모양만 남긴다(다른 이름은 경로의 근거가 아니다).
async function readRecordDir(
  dir: string,
): Promise<Result<ReadonlyMap<string, unknown>>> {
  const found = new Map<string, unknown>();
  let prefixes: string[];
  try {
    prefixes = readdirSync(dir, { withFileTypes: true }).map((entry) =>
      entry.name
    );
  } catch {
    return ok(found);
  }
  for (const prefix of prefixes) {
    let names: string[];
    try {
      names = readdirSync(`${dir}/${prefix}`, { withFileTypes: true }).map(
        (entry) => entry.name,
      );
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const hash = `${prefix}${name.slice(0, name.length - ".json".length)}`;
      if (!isSha256Hash(hash)) continue;
      try {
        found.set(
          hash,
          JSON.parse(await readFile(`${dir}/${prefix}/${name}`, "utf8")),
        );
      } catch {
        // 읽지 못한 기록은 건너뛴다.
      }
    }
  }
  return ok(found);
}
