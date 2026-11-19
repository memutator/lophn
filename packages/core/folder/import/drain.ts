// held 적용(drain). 이 기계의 앱이 held의 release가 되면, 출처마다 그 release의 held를 번호 순서로 stream과 같은 적용
// 길(`FolderApply`)로 적용하고, 하나가 성공할 때마다 그 행을 지우고 사본을 지운다. 실패하면 그 출처는 그 행에서 멈추고
// 다음 계기(읽기마다, release가 바뀌어 읽기가 다시 돌 때)에 같은 행부터 한다. 지금 release의 held가 남은 출처의 stream은
// 읽지 않는다: stream의 cursor는 held 뒤에 있어 먼저 읽으면 순서가 뒤집힌다(stream.ts가 지킨다).
// 다른 release의 held는 두고, 같은 출처의 더 큰 번호 snapshot이 담을 때만 지운다.
import { ok, type Result } from "../../../base/mod.ts";
import {
  CHANGES_PAYLOAD_MAX_BYTES,
  CONTAINER_HEAD_MAX_BYTES,
  type DataKind,
  dataEntryPath,
  decodeContainer,
  readContainerHead,
} from "../../../protocol/folder/mod.ts";
import { createFolderReader } from "../fs.ts";
import {
  type ApplyTarget,
  applyChangesFile,
  type Counts,
  fileInvalid,
  mergeFile,
  type Stop,
} from "./apply.ts";
import { type FolderImportDeps, folderError } from "./deps.ts";
import { dropCovered, removeHeldFiles } from "./held.ts";

export type Drained = {
  files: number;
  changes: Counts;
  /** 지금 release의 held가 남았다. error가 null이면 조용히 다음 계기를 기다린다(release가 사이에 바뀜). */
  stop: Omit<Stop, "kind"> | null;
};

type HeldRow = { n: number; kind: DataKind; path: string };

export async function drainHeld(
  deps: FolderImportDeps,
  target: ApplyTarget,
): Promise<Result<Drained>> {
  const me = deps.machine();
  const { app, origin } = target;
  const local = createFolderReader(deps.root);
  const out: Drained = {
    files: 0,
    changes: { applied: 0, skipped: 0, duplicate: 0, held: 0 },
    stop: null,
  };
  for (;;) {
    // 매번 다시 읽는다: snapshot을 합치면 그보다 옛 행이 지워진다.
    const next = deps.sql.get(
      `SELECT n, kind, path FROM folder_held
       WHERE machine = ? AND app = ? AND origin = ? AND code_commit = ? ORDER BY n LIMIT 1`,
      [me, app, origin, target.release.code_commit],
    ) as HeldRow | undefined;
    if (next === undefined) return ok(out);
    const n = Number(next.n);
    // header는 그 file이 폴더에 있던 path로 본다(번호와 출처가 맞는지).
    const rel = dataEntryPath(origin, app, n, next.kind);
    const missing = () =>
      stop(
        out,
        folderError(
          deps.clock,
          "invalid_file",
          `the kept copy of ${rel} is missing or unreadable`,
        ),
      );
    let applied: Stop | { kind: "applied"; counts?: Counts };
    if (next.kind === "changes") {
      const read = await local.read(
        next.path,
        CONTAINER_HEAD_MAX_BYTES + CHANGES_PAYLOAD_MAX_BYTES,
      );
      if (!read.ok) return ok(missing());
      const decoded = await decodeContainer(read.value, rel);
      if (!decoded.ok) {
        return ok(stop(out, fileInvalid(deps, rel, decoded.error).error));
      }
      applied = await applyChangesFile(
        deps,
        target,
        decoded.value.header,
        decoded.value.payload,
      );
    } else {
      const headRead = await local.readHead(
        next.path,
        CONTAINER_HEAD_MAX_BYTES,
      );
      if (!headRead.ok) return ok(missing());
      const head = await readContainerHead(headRead.value.bytes, rel);
      if (!head.ok) {
        return ok(stop(out, fileInvalid(deps, rel, head.error).error));
      }
      const merged = await mergeFile(
        deps,
        target,
        n,
        local,
        next.path,
        head.value,
      );
      if (merged.kind === "gone") return ok(missing());
      if (merged.kind === "invalid") return ok(stop(out, merged.error));
      applied = merged.kind === "merged" ? { kind: "applied" } : merged;
    }
    if (applied.kind === "stop") {
      out.stop = { error: applied.error, backoff: applied.backoff };
      return ok(out);
    }
    const removed = deps.transaction((tx) => {
      const covered =
        next.kind === "snapshot" ? dropCovered(tx.sql, me, app, origin, n) : [];
      tx.sql.run(
        `DELETE FROM folder_held WHERE machine = ? AND app = ? AND origin = ? AND n = ?`,
        [me, app, origin, n],
      );
      return ok([...covered, next.path]);
    });
    if (!removed.ok) return removed;
    await removeHeldFiles(deps.root, removed.value);
    out.files += 1;
    if (applied.counts !== undefined) {
      out.changes.applied += applied.counts.applied;
      out.changes.skipped += applied.counts.skipped;
      out.changes.duplicate += applied.counts.duplicate;
      out.changes.held += applied.counts.held;
    }
  }
}

function stop(out: Drained, error: NonNullable<Stop["error"]>): Drained {
  out.stop = { error, backoff: true };
  return out;
}
