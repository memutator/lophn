// documents coordinator의 context watch consumer 조립(documents#T24). core가 DocumentSaved를 읽고
// source_seq 당시의 watch 항목을 가려 보내면, 이 process가 derived store의 section으로 전후 고정
// 판을 비교하고, 확인된 변화만 machine credential의 `context.record_watch_change`로 제출한다.
// 추출 미완료·실패·비교 의미를 모르는 module 변경은 `watch_unverified`에 남기고 나중에 다시
// 확인한다. command가 수락된 뒤에만 `watch` cursor를 진행한다. ledger를 직접 열지 않고
// model·agent run을 시작하지 않는다(변화 event는 agent run의 계기가 아니다).
import { err, ok, type Result, sha256Hex } from "../../../packages/base/mod.ts";
import type { LophnError } from "../../../packages/base/mod.ts";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../../../packages/contracts/platform/mod.ts";
import {
  compareWatchedItem,
  targetKey,
  unverifiedReason,
  type WatchedItemComparison,
  type WatchSectionState,
} from "../../../packages/documents/contexts/mod.ts";
import type { DerivedStore } from "../../../packages/documents/outline-and-search/adapters/store.ts";
import {
  advanceWatchCursor,
  applyWatchStep,
  listWatchUnverified,
  loadWatchSectionState,
  parseSearchAdvance,
  parseWatchApply,
  WATCH_OPS,
  type WatchApplyRequest,
  watchCursorOf,
  type WatchUnverifiedRow,
} from "../../../packages/documents/outline-and-search/mod.ts";
import type { LedgerGate } from "./ledger-gate.ts";

// 같은 항목의 제출이 구성 변경과 이만큼 연달아 부딪치면 미확인으로 남기고 cursor를 진행한다.
// 계속 바뀌는 context 하나가 뒤의 모든 문서를 막지 않게 한다.
export const WATCH_CONFLICT_ATTEMPTS = 5;
export const WATCH_CONFLICT_REASON =
  "context changed while the comparison was submitted";
// 한 번에 돌려주는 다시 확인할 저장 event의 수.
export const WATCH_PENDING_LIMIT = 50;

export type WatchServing = {
  // 이 요청이 watch op가 아니면 undefined다.
  handle(request: WorkerRequest): Promise<WorkerResponse> | undefined;
};

export type WatchDeps = {
  store: DerivedStore;
  // store가 지금 ledger의 것임을 확인하는 문. 있으면 맞춰질 때까지 요청은 기다린다.
  gate?: LedgerGate;
  // 확인된 변화를 command로 제출한다. base_revision은 비교한 구성의 revision이다.
  submit(
    comparison: WatchedItemComparison,
    baseRevision: string,
  ): Promise<Result<unknown, LophnError>>;
};

function respond(
  request: WorkerRequest,
  result: Result<unknown>,
): WorkerResponse {
  return result.ok
    ? {
      type: "worker_response",
      request_id: request.request_id,
      ok: true,
      payload: result.value,
    }
    : {
      type: "worker_response",
      request_id: request.request_id,
      ok: false,
      error: {
        code: result.error.code === "invalid_input"
          ? "invalid_input"
          : "unavailable",
        message: "watch consumer request failed",
      },
    };
}

function badRequest(request: WorkerRequest): WorkerResponse {
  return respond(request, err({ code: "invalid_input", message: "bad" }));
}

// 이 비교가 아직 막혀 있는 이유를 지금 derived 상태로 다시 구한다. 확인할 수 있으면 null이다.
function reasonNow(deps: WatchDeps, row: WatchUnverifiedRow): string | null {
  const section = row.section;
  if (section === null) return null;
  const read = deps.store.read;
  const states: { before: WatchSectionState | null; after: WatchSectionState } =
    {
      before: row.before_version === null
        ? null
        : loadWatchSectionState(read, row.before_version, section),
      after: loadWatchSectionState(read, row.after_version, section),
    };
  return unverifiedReason(states, row.before_version !== null);
}

export function createWatchServing(deps: WatchDeps): WatchServing {
  const conflicts = new Map<string, number>();

  async function apply(
    request: WatchApplyRequest,
  ): Promise<Result<{ processed_seq: string }>> {
    const unverified: WatchUnverifiedRow[] = [];
    const read = deps.store.read;
    for (const target of request.targets) {
      const watched = {
        kind: "document" as const,
        document: request.event.document,
        section: target.section,
      };
      const key = targetKey(watched);
      const comparison = compareWatchedItem({
        context: target.context,
        context_revision: target.context_revision,
        target: watched,
        source_seq: request.event.seq,
        before: request.before,
        after: request.after,
        ...(target.section === null ? {} : {
          sections: {
            before: request.before === null ? null : loadWatchSectionState(
              read,
              request.before.version,
              target.section,
            ),
            after: loadWatchSectionState(
              read,
              request.after.version,
              target.section,
            ),
          },
        }),
      });
      const row = (reason: string): WatchUnverifiedRow => ({
        context: target.context,
        document: request.event.document,
        section: target.section,
        source_seq: request.event.seq,
        context_revision: target.context_revision,
        before_version: request.before?.version ?? null,
        after_version: request.after.version,
        reason,
      });
      if (comparison.result === "unchanged") continue;
      if (comparison.result === "unverified") {
        unverified.push(row(comparison.unverified_reason ?? "unverified"));
        continue;
      }
      const attempt = `${request.event.seq}\u0000${target.context}\u0000${key}`;
      const submitted = await deps.submit(comparison, target.context_revision);
      if (submitted.ok) {
        conflicts.delete(attempt);
        continue;
      }
      const code = submitted.error.code;
      // 구성이 바뀌어 낡았거나 근거가 없는 결과다. 기록하지 않고 지난다.
      if (code === "not_found" || code === "invalid_input") {
        conflicts.delete(attempt);
        continue;
      }
      if (code === "conflict") {
        const failed = (conflicts.get(attempt) ?? 0) + 1;
        if (failed < WATCH_CONFLICT_ATTEMPTS) {
          conflicts.set(attempt, failed);
          return err({
            code: "unavailable",
            message: "the context changed while submitting",
          });
        }
        conflicts.delete(attempt);
        unverified.push(row(WATCH_CONFLICT_REASON));
        continue;
      }
      // 제출하지 못한 결과는 cursor를 진행하지 않고 다시 받는다.
      return err({ code: "unavailable", message: "watch submit failed" });
    }
    return applyWatchStep(deps.store, {
      source_seq: request.event.seq,
      unverified,
    });
  }

  function pending(): Result<{ source_seqs: string[] }> {
    const seqs: string[] = [];
    for (const row of listWatchUnverified(deps.store.read)) {
      if (seqs.includes(row.source_seq)) continue;
      const now = reasonNow(deps, row);
      // 확인할 수 있게 됐거나 이유가 달라졌으면 다시 확인한다.
      if (now === null || now !== row.reason) seqs.push(row.source_seq);
      if (seqs.length >= WATCH_PENDING_LIMIT) break;
    }
    return ok({ source_seqs: seqs });
  }

  function route(request: WorkerRequest): Promise<WorkerResponse> | undefined {
    if (request.op === WATCH_OPS.cursor) {
      return Promise.resolve(
        respond(
          request,
          ok({ processed_seq: watchCursorOf(deps.store.read) }),
        ),
      );
    }
    if (request.op === WATCH_OPS.advance) {
      const to = parseSearchAdvance(request.payload);
      if (to === undefined) return Promise.resolve(badRequest(request));
      return Promise.resolve(
        respond(request, advanceWatchCursor(deps.store, to)),
      );
    }
    if (request.op === WATCH_OPS.pending) {
      return Promise.resolve(respond(request, pending()));
    }
    if (request.op === WATCH_OPS.apply) {
      const parsed = parseWatchApply(request.payload);
      if (parsed === undefined) return Promise.resolve(badRequest(request));
      return apply(parsed).then((result) => respond(request, result));
    }
    return undefined;
  }

  return {
    handle(request) {
      const watch = request.op === WATCH_OPS.cursor ||
        request.op === WATCH_OPS.advance || request.op === WATCH_OPS.pending ||
        request.op === WATCH_OPS.apply;
      if (!watch) return undefined;
      if (deps.gate === undefined) return route(request);
      return deps.gate.ready().then((ready) =>
        ready.ok
          ? route(request) ?? respond(request, ok(undefined))
          : respond(request, ready)
      );
    },
  };
}

// 같은 변화의 제출을 재시도해도 같은 요청으로 보이도록 키를 근거에서 만든다. 비교한 구성의
// revision이 달라지면 다른 요청이다.
export async function watchSubmitKey(
  comparison: WatchedItemComparison,
  baseRevision: string,
): Promise<string> {
  return await sha256Hex(
    new TextEncoder().encode(
      [
        "watch",
        comparison.context,
        targetKey(comparison.target),
        comparison.after_version,
        baseRevision,
      ].join("\u0000"),
    ),
  );
}
