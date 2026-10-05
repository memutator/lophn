// search consumer. derived_cursors.search부터 event를 소비하고 한 event의
// 결과·FTS 교체·cursor를 한 derived transaction에 쓴다(architecture/documents 7.4).
// 재생성 시작은 rebuilding flag를 심는다. catch-up과 교체는 재생성 흐름 몫이다.
// 재생성·재파생은 ledger에 아무것도 쓰지 않는다. model·agent run을 시작하지 않는다.
import { ok, parseSeq, type Result } from "../../base/mod.ts";
import type { DerivedRead, DerivedStore } from "./adapters/store.ts";
import { SEARCH_CONSUMER, WATCH_CONSUMER } from "./work-consumers.ts";

export type SearchConsumerDeps = {
  store: DerivedStore;
  // ledger read snapshot. as_of_seq=S의 일관된 재생성 기준과 event 구독이 쓴다.
  eventsAlg: EventScanLike;
  nowMs: () => number;
};

export type EventScanLike = {
  // seq position부터 batch로 읽는다. type·subject 필터는 registry가 결정한다.
  scan(position: string, limit: number): Result<ConsumerEventBatch>;
};

export type ConsumerEventBatch = {
  events: ConsumerEvent[];
  scanned_through_seq: string;
  head_seq: string;
};

export type ConsumerEvent = {
  seq: string;
  type: string;
  subject: string | null;
  payload: unknown;
};

export const COALESCE_MS = 500;
export const EVENT_PAGE_LIMIT = 200;
export const OMISSION_FAILED = "extraction failed";
export const OMISSION_UNSUPPORTED = "extraction unsupported";
export const OMISSION_UNVERIFIED = "extraction unverified";
export { SEARCH_CONSUMER, WATCH_CONSUMER };

export type SearchCoverage = {
  processed_seq: string;
  ledger_basis_seq: string;
  lagging: boolean;
  rebuilding: boolean;
  omissions: {
    document: string;
    version: string;
    reason: string;
  }[];
};

export type LedgerIdSource = {
  // `${path}:${stat.size}`와 같은 식별. core의 platform/status와 같은 근원이다.
  ledgerId(): Result<string>;
};

// consumer의 한 event 적용. FTS 교체 trigger는 search_rows delete/insert가 거친다.
export function applySearchEvent(
  store: DerivedStore,
  event: ConsumerEvent,
): Result<SearchCoverage> {
  const parsed = parseEvent(event);
  if (!parsed.ok) {
    // 대상 불명 event는 전체 무효화다. cursor는 진행하고 무효화만 남긴다.
    return store.transaction((tx) =>
      ok({
        processed_seq: event.seq,
        ledger_basis_seq: event.seq,
        lagging: false,
        rebuilding: false,
        omissions: invalidateAll(tx.sql),
      })
    );
  }
  return store.transaction((tx) => writeEvent(tx, event, parsed.value));
}

function invalidateAll(sql: DerivedRead["sql"]): SearchCoverage["omissions"] {
  // 전체 무효화. 낡은 index 행 전부를 지운다. cursor는 이미 진행했다고 본다.
  sql.run(`DELETE FROM search_documents`, []);
  return [];
}

type ParsedEvent =
  | { kind: "saved"; document: string; payload: SavedPayload }
  | { kind: "archive"; document: string }
  | { kind: "unarchive"; document: string }
  | { kind: "rename"; document: string; payload: RenamePayload }
  | { kind: "move"; document: string; payload: MovePayload }
  | { kind: "restored"; document: string; payload: { version: string } }
  | { kind: "unknown" };

type SavedPayload = {
  version: string;
  previous_version: string | null;
  content_hash: string;
  format: { name: string; module_hash: string };
};

type RenamePayload = {
  title: string;
};

type MovePayload = {
  place: { kind: "project" | "app"; id: string } | null;
  name: string | null;
};

function parseEvent(event: ConsumerEvent): Result<ParsedEvent> {
  const document = event.subject;
  if (typeof document !== "string" || document.length === 0) {
    return ok({ kind: "unknown" });
  }
  if (event.type === "DocumentSaved") {
    const payload = savedPayload(event);
    if (payload === undefined) return ok({ kind: "unknown" });
    return ok({ kind: "saved" as const, document, payload });
  }
  if (event.type === "DocumentRestored") {
    const payload = event.payload as { version?: unknown };
    if (typeof payload.version !== "string") return ok({ kind: "unknown" });
    return ok({
      kind: "restored" as const,
      document,
      payload: { version: payload.version },
    });
  }
  if (event.type === "DocumentArchived") {
    return ok({ kind: "archive" as const, document });
  }
  if (event.type === "DocumentUnarchived") {
    return ok({ kind: "unarchive" as const, document });
  }
  if (event.type === "DocumentMoved") {
    const payload = event.payload as { place?: unknown; name?: unknown };
    const place = placeOf(payload.place);
    if (place === null && typeof payload.name !== "string") {
      return ok({ kind: "unknown" });
    }
    return ok({
      kind: "move" as const,
      document,
      payload: {
        place,
        name: typeof payload.name === "string" ? payload.name : null,
      },
    });
  }
  if (event.type === "DocumentRenamed") {
    const payload = event.payload as { name?: unknown };
    if (typeof payload.name !== "string") return ok({ kind: "unknown" });
    return ok({
      kind: "rename" as const,
      document,
      payload: { title: payload.name },
    });
  }
  if (event.type === "DocumentUpdated") {
    const payload = event.payload as { title?: unknown };
    if (typeof payload.title !== "string") return ok({ kind: "unknown" });
    return ok({
      kind: "rename" as const,
      document,
      payload: { title: payload.title },
    });
  }
  if (event.type === "DocumentSourceChanged") {
    return ok({ kind: "unknown" as const });
  }
  return ok({ kind: "unknown" as const });
}

function savedPayload(event: ConsumerEvent): SavedPayload | undefined {
  const payload = event.payload as {
    version?: unknown;
    previous_version?: unknown;
    content_hash?: unknown;
    format?: unknown;
  };
  if (
    typeof payload.version !== "string" ||
    typeof payload.content_hash !== "string" ||
    typeof payload.format !== "object" || payload.format === null ||
    typeof (payload.format as { name?: unknown }).name !== "string" ||
    typeof (payload.format as { module_hash?: unknown }).module_hash !==
      "string"
  ) {
    return undefined;
  }
  const format = payload.format as { name: string; module_hash: string };
  return {
    version: payload.version,
    previous_version: typeof payload.previous_version === "string"
      ? payload.previous_version
      : null,
    content_hash: payload.content_hash,
    format,
  };
}

function placeOf(
  value: unknown,
): { kind: "project" | "app"; id: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const kind = (value as { kind?: unknown }).kind;
  const id = (value as { id?: unknown }).id;
  if ((kind === "project" || kind === "app") && typeof id === "string") {
    return { kind, id };
  }
  return null;
}

function writeEvent(
  tx: { sql: DerivedRead["sql"] },
  event: ConsumerEvent,
  parsed: ParsedEvent,
): Result<SearchCoverage> {
  let omissions: SearchCoverage["omissions"] = [];
  if (parsed.kind === "archive" || parsed.kind === "unarchive") {
    const status = parsed.kind === "archive" ? "archived" : "active";
    tx.sql.run(
      `UPDATE search_documents SET status = ?, saved_seq = ? WHERE document = ?`,
      [status, event.seq, parsed.document],
    );
    omissions = pendingOmissions(tx.sql, parsed.document);
  }
  if (parsed.kind === "move") {
    // move는 출발·도착 자리名单을 함께 갱신한다. 낡은 index 행은 지우고 새 행은
    // 재파생이 심는다. 바로 알 수 없으므로 행을 지운다.
    tx.sql.run(
      `UPDATE search_documents
       SET place_kind = ?, place_id = ?, name = ?, saved_seq = ?
       WHERE document = ?`,
      [
        parsed.payload.place === null ? null : parsed.payload.place.kind,
        parsed.payload.place === null ? null : parsed.payload.place.id,
        parsed.payload.name,
        event.seq,
        parsed.document,
      ],
    );
  }
  if (parsed.kind === "rename") {
    tx.sql.run(
      `UPDATE search_documents SET name = ?, saved_seq = ? WHERE document = ?`,
      [parsed.payload.title, event.seq, parsed.document],
    );
  }
  if (parsed.kind === "saved" || parsed.kind === "restored") {
    // saved는 재파입 결과(recordExtraction)가 심는다. 낡은 행만 지운다.
    tx.sql.run(`DELETE FROM search_rows WHERE document = ?`, [parsed.document]);
  }
  if (parsed.kind === "unknown") {
    invalidateAll(tx.sql);
    return ok({
      processed_seq: event.seq,
      ledger_basis_seq: event.seq,
      lagging: false,
      rebuilding: false,
      omissions: [],
    });
  }
  return ok({
    processed_seq: event.seq,
    ledger_basis_seq: event.seq,
    lagging: false,
    rebuilding: false,
    omissions,
  });
}

// 낡은 index 행이 있어도 현재 ledger 상태의 보관 문서는 기본 결과에서 뺀다(R17).
// 실패 판은 이유를 남기고 cursor가 진행해도 omissions로 돌려준다.
function pendingOmissions(
  sql: DerivedRead["sql"],
  document: string,
): SearchCoverage["omissions"] {
  const rows = sql.all(
    `SELECT version, extraction_status, failure_reason
     FROM derived_versions WHERE document = ? AND extraction_status <> 'ready'
     ORDER BY version`,
    [document],
  );
  const omissions: SearchCoverage["omissions"] = [];
  for (const row of rows) {
    omissions.push(omissionRow(document, row));
  }
  return omissions;
}

export function omissionRow(
  document: string,
  row: Record<string, unknown>,
): SearchCoverage["omissions"][number] {
  const status = String(row.extraction_status);
  const reason = status === "failed"
    ? String(row.failure_reason ?? OMISSION_FAILED)
    : status === "unsupported"
    ? OMISSION_UNSUPPORTED
    : OMISSION_UNVERIFIED;
  return {
    document,
    version: String(row.version),
    reason,
  };
}

// 현재 scope 전체의 실패·미지원·미확인 누락. 파생 cursor가 진행해도 남는다.
export function allOmissions(
  sql: DerivedRead["sql"],
): SearchCoverage["omissions"] {
  const rows = sql.all(
    `SELECT document, version, extraction_status, failure_reason
     FROM derived_versions WHERE extraction_status <> 'ready' ORDER BY document, version`,
    [],
  );
  return rows.map((row) => omissionRow(String(row.document), row));
}

export function coverageOf(
  read: DerivedRead,
  ledgerBasisSeq: string,
): SearchCoverage {
  const row = read.sql.get(
    `SELECT processed_seq, rebuilding FROM derived_cursors WHERE consumer = ?`,
    [SEARCH_CONSUMER],
  );
  const processed = row === undefined ? "0" : String(row.processed_seq);
  const rebuilding = row === undefined ? false : Number(row.rebuilding) === 1;
  const basis = ledgerBasisSeq === "0" ? "0" : ledgerBasisSeq;
  const lagging = BigInt(processed) < BigInt(basis);
  return {
    processed_seq: processed,
    ledger_basis_seq: basis,
    lagging,
    rebuilding,
    omissions: allOmissions(read.sql),
  };
}

// 재생성 시작. rebuilding flag를 양 consumer에 심는다. 파일 생성은 rebuild 흐름 몫이다.
export function startRebuild(
  store: DerivedStore,
  asOfSeq: string,
): Result<void> {
  return store.transaction((tx) => {
    tx.sql.run(
      `INSERT OR REPLACE INTO derived_cursors
         (consumer, processed_seq, rebuilding, rebuild_basis_seq)
       VALUES (?, ?, 1, ?)`,
      [SEARCH_CONSUMER, asOfSeq, asOfSeq],
    );
    tx.sql.run(
      `INSERT OR REPLACE INTO derived_cursors
         (consumer, processed_seq, rebuilding, rebuild_basis_seq)
       VALUES (?, ?, 1, ?)`,
      [WATCH_CONSUMER, asOfSeq, asOfSeq],
    );
    return ok(undefined);
  });
}

export function omitPosition(read: DerivedRead): Result<string> {
  const found = read.sql.get(
    `SELECT processed_seq FROM derived_cursors WHERE consumer = ?`,
    [SEARCH_CONSUMER],
  );
  if (found === undefined) return ok("0");
  const parsed = parseSeq(String(found.processed_seq));
  return parsed.ok ? ok(String(parsed.value)) : parsed;
}
