// search consumer의 한 걸음. 한 event의 적용·추출 결과·FTS 교체·cursor를 한 derived
// transaction에 쓴다(architecture/documents 7.4). 추출은 format runner를 부르는 일이라
// transaction 밖에서 끝내고 결과만 받는다. 같은 event가 다시 와도(at-least-once) 이미 지난
// seq는 아무것도 하지 않는다. ledger에는 아무것도 쓰지 않고 model·agent run을 시작하지 않는다.
import { ok, type Result } from "../../../base/mod.ts";
import type { DerivedRead, DerivedStore } from "./adapters/store.ts";
import { type ExtractionRecord, writeExtraction } from "./extraction.ts";
import { SEARCH_CONSUMER } from "./work-consumers.ts";
import { applySearchEventTx, type ConsumerEvent } from "./work.ts";

export function searchCursorOf(read: DerivedRead): string {
  const row = read.sql.get(
    `SELECT processed_seq FROM derived_cursors WHERE consumer = ?`,
    [SEARCH_CONSUMER],
  );
  return row === undefined ? "0" : String(row["processed_seq"]);
}

function setCursor(sql: DerivedRead["sql"], seq: string): void {
  sql.run(
    `INSERT INTO derived_cursors (consumer, processed_seq, rebuilding, rebuild_basis_seq)
     VALUES (?, ?, 0, NULL)
     ON CONFLICT(consumer) DO UPDATE SET processed_seq = excluded.processed_seq`,
    [SEARCH_CONSUMER, seq],
  );
}

export type SearchStep = {
  event: ConsumerEvent;
  // 저장 event면 그 판의 추출 결과. 없으면 이 event는 본문을 바꾸지 않는다.
  extraction?: ExtractionRecord;
};

// event 하나와 그 추출 결과를 cursor와 함께 쓴다. 이미 지난 seq는 건너뛴다.
export function applySearchStep(
  store: DerivedStore,
  step: SearchStep,
): Result<{ applied: boolean; processed_seq: string }> {
  return store.transaction<{ applied: boolean; processed_seq: string }>(
    (tx) => {
      const current = searchCursorOf({ sql: tx.sql });
      if (BigInt(step.event.seq) <= BigInt(current)) {
        return ok({ applied: false, processed_seq: current });
      }
      const applied = applySearchEventTx(tx, step.event);
      if (!applied.ok) return applied;
      if (step.extraction !== undefined) {
        writeExtraction(tx, step.extraction, step.event.seq);
      }
      setCursor(tx.sql, step.event.seq);
      return ok({ applied: true, processed_seq: step.event.seq });
    },
  );
}

// consumer가 쓰지 않는 event를 지나 cursor만 앞으로 보낸다. 뒤로 가지 않는다.
export function advanceSearchCursor(
  store: DerivedStore,
  seq: string,
): Result<{ processed_seq: string }> {
  return store.transaction((tx) => {
    const current = searchCursorOf({ sql: tx.sql });
    if (BigInt(seq) <= BigInt(current)) {
      return ok({ processed_seq: current });
    }
    setCursor(tx.sql, seq);
    return ok({ processed_seq: seq });
  });
}
