// `InvocationLedger` 구현. core 호출 경로가 직접 부르는 기록이다(앱 process의 통보가 아니다).
// 읽기는 `sql`, 쓰기는 한 transaction씩 `transaction`에 맡긴다. changeset bytes는 blob store에 두고
// 행에는 hash와 크기만 남기며, 참조 등록은 행을 닫는 같은 transaction에서 한다.
import { err, ok, type Result } from "../../../base/mod.ts";
import { appInvocationSchema } from "../../../protocol/apps/calls/mod.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import {
  BLOB_READ_MAX_BYTES,
  type PreparedBlob,
} from "../../../protocol/storage/mod.ts";
import { eraseBlobRefs } from "../../storage/blobs/mod.ts";
import type { InvocationLedger } from "../ports.ts";
import { CHANGESET_FIELD_NAME, CHANGESET_OWNER_KIND } from "./changesets.ts";
import {
  changesetVerdict,
  checkSummary,
  finishable,
  recordableOnce,
  redactSummary,
} from "./model.ts";
import {
  headSeq,
  insertInvocation,
  listInvocations,
  loadInvocation,
  releaseChangesetBytes,
} from "./store.ts";

export type ChangesetBlobs = {
  // purpose `app_changeset`로 준비한다. 준비 주체는 `transaction`의 자격과 같아야 한다.
  prepare(bytes: ReadableStream<Uint8Array>): Promise<Result<PreparedBlob>>;
  read(
    hash: string,
    offset: number,
    length: number,
  ): Promise<Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>>;
};

type InvocationLedgerDeps = {
  sql: Pick<Sql, "get" | "all">;
  // ledger 쓰기 transaction 하나. 돌려준 값이 err이면 rollback한다.
  transaction<T>(fn: (tx: Tx) => Result<T>): Result<T>;
  blobs: ChangesetBlobs;
  // 행을 쓴 transaction이 commit된 뒤 부른다. 화면(앱 Activity·Rewind)이 다시 읽게 알린다.
  changed(app: string): void;
};

function oneChunk(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

const CLOSED_COLUMNS = `status = ?, finished_at = ?, summary = ?, detail_hash = ?,
  changeset_hash = ?, changeset_size = ?`;

export function createInvocationLedger(
  deps: InvocationLedgerDeps,
): InvocationLedger {
  async function readChangeset(
    hash: string,
    size: number,
  ): Promise<Result<Uint8Array>> {
    const bytes = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      const chunk = await deps.blobs.read(
        hash,
        offset,
        Math.min(BLOB_READ_MAX_BYTES, size - offset),
      );
      if (!chunk.ok) return chunk;
      if (chunk.value.hash !== hash || chunk.value.bytes.length === 0) {
        return err({ code: "unavailable", message: "changeset is unreadable" });
      }
      bytes.set(chunk.value.bytes, offset);
      offset += chunk.value.bytes.length;
    }
    return ok(bytes);
  }

  function committed<T extends { app: string }>(result: Result<T>): Result<T> {
    if (result.ok) deps.changed(result.value.app);
    return result;
  }

  return {
    begin(input) {
      if (input.started_at === null) {
        return err({
          code: "invalid_input",
          message: "a started invocation has a start time",
        });
      }
      const row = appInvocationSchema.safeParse({
        ...input,
        status: "running",
        finished_at: null,
        summary: {},
        detail_hash: null,
        changeset: null,
        reverted_by: null,
      });
      if (!row.success) {
        return err({ code: "invalid_input", message: "invalid invocation" });
      }
      return committed(
        deps.transaction((tx) => {
          const known = loadInvocation(tx.sql, row.data.id);
          if (!known.ok) return known;
          if (known.value !== null)
            return conflict("invocation already exists");
          insertInvocation(tx, row.data);
          return ok(row.data);
        }),
      );
    },

    async finish(id, result) {
      const current = loadInvocation(deps.sql, id);
      if (!current.ok) return current;
      if (current.value === null) {
        return err({ code: "not_found", message: "invocation not found" });
      }
      const open = finishable(current.value);
      if (!open.ok) return open;
      const row = current.value;
      if (result.changeset !== null && row.effect === "read") {
        return err({
          code: "invalid_input",
          message: "a read has no changeset",
        });
      }

      // 호출 결과는 살린다. changeset을 못 붙이면 그것만 없이 닫고 이유를 요약에 남긴다.
      let dropped: "too_large" | "release_full" | "unavailable" | null = null;
      let prepared: PreparedBlob | null = null;
      const bytes = result.changeset;
      // 변경이 없으면 changeset이 비어 있다. 붙일 것이 없다.
      if (bytes !== null && bytes.length > 0) {
        const verdict = changesetVerdict(
          bytes.length,
          releaseChangesetBytes(deps.sql, row.app, row.release),
        );
        if (verdict !== "fits") dropped = verdict;
        else {
          const made = await deps.blobs.prepare(oneChunk(bytes));
          if (made.ok) prepared = made.value;
          else dropped = "unavailable";
        }
      }

      let registerFailed = false;
      const close = (blob: PreparedBlob | null, why: typeof dropped) => {
        const summary = redactSummary(
          why === null
            ? result.summary
            : { ...result.summary, changeset_dropped: why },
        );
        const sized = checkSummary(summary);
        if (!sized.ok) return sized;
        return deps.transaction((tx) => {
          const changed = tx.sql.run(
            `UPDATE invocations SET ${CLOSED_COLUMNS}
             WHERE id = ? AND status = 'running'`,
            [
              result.status,
              result.finished_at,
              JSON.stringify(summary),
              result.detail_hash,
              blob?.hash ?? null,
              blob?.size_bytes ?? null,
              id,
            ],
          );
          if (Number(changed.changes) !== 1) {
            return conflict("invocation is already finished");
          }
          if (blob !== null) {
            const registered = tx.registerBlobRef({
              owner_kind: CHANGESET_OWNER_KIND,
              owner_key: id,
              field: CHANGESET_FIELD_NAME,
              registered_seq: headSeq(tx.sql),
              source: { kind: "prepared", blob: { ...blob } },
            });
            if (!registered.ok) {
              registerFailed = true;
              return registered;
            }
          }
          const stored = loadInvocation(tx.sql, id);
          if (!stored.ok) return stored;
          return stored.value === null
            ? conflict("invocation is missing")
            : ok(stored.value);
        });
      };
      let closed = close(prepared, dropped);
      if (!closed.ok && registerFailed) closed = close(null, "unavailable");
      return committed(closed);
    },

    recordOnce(input) {
      const parsed = appInvocationSchema.safeParse(input);
      if (!parsed.success) {
        return Promise.resolve(
          err({ code: "invalid_input", message: "invalid invocation" }),
        );
      }
      const once = recordableOnce(parsed.data);
      if (!once.ok) return Promise.resolve(once);
      const summary = redactSummary(parsed.data.summary);
      const sized = checkSummary(summary);
      if (!sized.ok) return Promise.resolve(sized);
      const row = { ...parsed.data, summary };
      return Promise.resolve(
        committed(
          deps.transaction((tx) => {
            const known = loadInvocation(tx.sql, row.id);
            if (!known.ok) return known;
            if (known.value !== null)
              return conflict("invocation already exists");
            insertInvocation(tx, row);
            return ok(row);
          }),
        ),
      );
    },

    get: (id) => loadInvocation(deps.sql, id),

    list(filter) {
      const { cursor, limit, ...rest } = filter;
      return listInvocations(deps.sql, rest, { after: cursor, limit });
    },

    async changesetOf(id) {
      const found = loadInvocation(deps.sql, id);
      if (!found.ok) return found;
      if (found.value === null) {
        return err({ code: "not_found", message: "invocation not found" });
      }
      const ref = found.value.changeset;
      if (ref === null) return ok(null);
      return await readChangeset(ref.hash, ref.size_bytes);
    },

    markReverted(ids, rewind) {
      return deps.transaction((tx) => {
        for (const id of ids) {
          const changed = tx.sql.run(
            `UPDATE invocations SET reverted_by = ?
             WHERE id = ? AND status IN ('succeeded', 'failed', 'unknown')
               AND (reverted_by IS NULL OR reverted_by = ?)`,
            [rewind, id, rewind],
          );
          if (Number(changed.changes) !== 1) {
            return conflict(`invocation cannot be marked reverted: ${id}`);
          }
        }
        return ok(undefined);
      });
    },

    pruneChangesets(app, keepRelease) {
      return Promise.resolve(
        deps.transaction((tx) => {
          const rows = tx.sql.all(
            `SELECT id FROM invocations
           WHERE app = ? AND release <> ? AND changeset_hash IS NOT NULL`,
            [app, keepRelease],
          );
          if (rows.length === 0) return ok(0);
          const erased = eraseBlobRefs(
            tx,
            CHANGESET_OWNER_KIND,
            rows.map((row) => String(row.id)),
          );
          if (!erased.ok) return erased;
          tx.sql.run(
            `UPDATE invocations SET changeset_hash = NULL, changeset_size = NULL
           WHERE app = ? AND release <> ? AND changeset_hash IS NOT NULL`,
            [app, keepRelease],
          );
          return ok(rows.length);
        }),
      );
    },

    unfinished() {
      return listInvocations(deps.sql, { status: "running" });
    },
  };
}
