import { err, ok, type Result } from "../../../../base/mod.ts";
import type { CheckViolation } from "../check/types.ts";
import { checkEntities } from "../checks/run.ts";
import type { CheckEntity } from "../checks/types.ts";
import { extractAll } from "../extract/run.ts";
import type { ProjectFiles } from "../extract/types.ts";
import { folderCovers, watchFolders } from "../watch/mod.ts";
import { replaceIndexRows, writeIndexState } from "./scan-write.ts";
import { type IndexStore, readIndexedFiles, readIndexState } from "./store.ts";
import type {
  FileStat,
  IndexedEntity,
  IndexedFile,
  ScanInput,
  ScanResult,
} from "./types.ts";

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// 훑는 중 files가 던진 오류. 이것만 `unavailable`로 바꾸고 다른 오류는 그대로 던진다.
class FileFailure extends Error {}

// context 하나의 index를 계약 경로의 stat으로 갱신한다(documents/contexts#R23).
//
// 1. 훑을 파일 = files.paths() 중 watchFolders(bundle.contract)가 덮는 것. 폴더 밖 파일은 stat도 하지 않고
//    index에 넣지 않는다. 훑는 중 files가 throw하면 `unavailable`을 돌려주고 store를 건드리지 않는다.
// 2. changed = index_files에 없거나 (size, mtime_ms)가 다른 파일. index_state의 bundle_hash가 입력 판과 다르거나
//    state가 없으면 훑은 파일 전부. removed = index_files에 있으나 훑은 목록에 없는 파일.
// 3. changed나 removed가 없으면 글을 읽지 않고 index_files·index_entities·index_violations에 쓰지 않는다.
//    index_state의 scanned_at만 clock.now()로 갱신한다.
// 4. 있으면 계약 전체를 훑은 파일 위에서 다시 추출·검사한다(`extractAll` + `checkEntities`, app-data는
//    읽지 않으므로 그 type의 개체는 저장하지 않는다). series의 path_mismatch, folder의 하위 폴더, 링크 대상 같은
//    관계가 파일 하나로 정해지지 않아서 개체와 위반은 통째로 바꾸고, 같은 transaction에서 index_files를
//    새 stat·판·상태(unreadable 위반이 있는 파일은 failed)로 맞추고 index_state를 complete로 쓴다.
// 5. rose = violation_count > recorded_count. 저장된 index가 ledger보다 앞서 있어도(응답 유실, store 재생성)
//    다음 scan이 다시 true를 내므로 제출이 재시도된다.
export function scanContext(
  store: IndexStore,
  input: ScanInput,
): Result<ScanResult> {
  try {
    return ok(scan(store, input));
  } catch (error) {
    if (error instanceof FileFailure) {
      return err({
        code: "unavailable",
        message: `project files cannot be scanned: ${error.message}`,
      });
    }
    throw error;
  }
}

function guarded<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    throw new FileFailure(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function scan(store: IndexStore, input: ScanInput): ScanResult {
  const { context, bundle, bundle_hash: bundleHash, files, clock } = input;

  const folders = watchFolders(bundle.contract);
  const stats = new Map<string, FileStat>();
  for (const path of guarded(() => files.paths())) {
    if (!folders.some((folder) => folderCovers(folder, path))) continue;
    const stat = guarded(() => files.stat(path));
    if (stat !== null) stats.set(path, stat);
  }
  const scanned = [...stats.keys()].sort(compare);

  const state = readIndexState(store.sql, context);
  const indexed = new Map(
    readIndexedFiles(store.sql, context).map((file) => [file.path, file]),
  );
  const everything = state === undefined || state.bundle_hash !== bundleHash;
  const changed = scanned.filter((path) => {
    const before = indexed.get(path);
    const stat = stats.get(path)!;
    return everything || before === undefined || before.size !== stat.size ||
      before.mtime_ms !== stat.mtime_ms;
  });
  const removed = [...indexed.keys()].filter((path) => !stats.has(path))
    .sort(compare);

  if (!everything && changed.length === 0 && removed.length === 0) {
    const count = violationCount(store, context);
    store.transaction((sql) =>
      writeIndexState(sql, context, {
        bundle_hash: state.bundle_hash,
        scanned_at: clock.now(),
        result: state.result,
      })
    );
    return {
      scanned: scanned.length,
      changed,
      removed,
      extracted: false,
      violation_count: count,
      rose: count > input.recorded_count,
    };
  }

  const view: ProjectFiles = {
    paths: () => scanned,
    read: (path) => guarded(() => files.read(path)),
  };
  const extracted = extractAll(bundle, view, () => undefined);
  const sourceKinds = new Map(
    bundle.contract.types.map((type) => [type.name, type.source.kind]),
  );
  const entities: IndexedEntity[] = extracted.entities.flatMap((entity) => {
    const kind = sourceKinds.get(entity.type);
    return kind === undefined || kind === "app-data"
      ? []
      : [{ ...entity, source_kind: kind }];
  });
  const rules = checkEntities(
    bundle.contract,
    extracted.entities as CheckEntity[],
    () => undefined,
  );
  const violations: CheckViolation[] = [...extracted.violations, ...rules]
    .sort((a, b) =>
      compare(a.path, b.path) || compare(a.kind, b.kind) ||
      compare(a.rule ?? "", b.rule ?? "") ||
      compare(a.section ?? "", b.section ?? "")
    );

  const unreadable = new Map<string, string>();
  for (const violation of violations) {
    if (violation.kind === "unreadable") {
      unreadable.set(violation.path, violation.kind);
    }
  }
  const rows: IndexedFile[] = scanned.map((path) => {
    const reason = unreadable.get(path) ?? null;
    return {
      path,
      ...stats.get(path)!,
      bundle_hash: bundleHash,
      status: reason === null ? "ok" : "failed",
      reason,
    };
  });

  store.transaction((sql) =>
    replaceIndexRows(sql, context, {
      files: rows,
      entities,
      violations,
      state: {
        bundle_hash: bundleHash,
        scanned_at: clock.now(),
        result: "complete",
      },
    })
  );
  return {
    scanned: scanned.length,
    changed,
    removed,
    extracted: true,
    violation_count: violations.length,
    rose: violations.length > input.recorded_count,
  };
}

function violationCount(store: IndexStore, context: string): number {
  const row = store.sql.get(
    "SELECT COUNT(*) AS n FROM index_violations WHERE context = ?",
    [context],
  );
  return Number(row?.n ?? 0);
}
