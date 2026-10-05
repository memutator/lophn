// core가 documents coordinator에 search consumer 일을 맡기는 요청의 op 이름과 본문 모양.
// core는 event 구독에서 event를 읽고, 저장 event의 판은 원문 바이트를 byte chunk frame으로
// 먼저 보낸 뒤 같은 channel을 가리키는 요청을 보낸다(file-tracking의 format 검사와 같은
// 통로). coordinator가 유일한 derived writer라서 결과·FTS·cursor는 coordinator가 쓴다.
import type { ConsumerEvent } from "./work.ts";

export const SEARCH_OPS = {
  // 이어 받을 자리. 응답은 `{ processed_seq }`다.
  cursor: "documents.search_cursor",
  // event 하나와 (저장 event면) 그 판의 원문. 응답은 `{ processed_seq }`다.
  apply: "documents.search_apply",
  // consumer가 쓰지 않는 event를 지나 cursor만 앞으로 보낸다.
  advance: "documents.search_advance",
} as const;

// consumer가 이해하는 event. 이 밖의 event(대상 불명)는 전체 무효화가 되므로 보내지 않고
// cursor만 진행한다(`advanceSearchCursor`).
export const SEARCH_CONSUMED_EVENTS: ReadonlySet<string> = new Set([
  "DocumentSaved",
  "DocumentRestored",
  "DocumentArchived",
  "DocumentUnarchived",
  "DocumentMoved",
  "DocumentRenamed",
  "DocumentUpdated",
]);

export type ExtractionTarget = {
  document: string;
  version: string;
};

// 본문을 다시 추출해야 하는 event의 대상 판. 저장과 복원 event가 가리키는 판이다. 판의
// 내용 hash·format·파일은 event가 아니라 ledger의 판 행이 정한다. 대상이 없으면 undefined다.
export function extractionTargetOf(
  event: ConsumerEvent,
): ExtractionTarget | undefined {
  if (
    (event.type !== "DocumentSaved" && event.type !== "DocumentRestored") ||
    typeof event.subject !== "string"
  ) return undefined;
  const version = (event.payload as { version?: unknown }).version;
  if (typeof version !== "string") return undefined;
  return { document: event.subject, version };
}

// 한 판의 추출 입력 상한(guest 입력 16 MiB)은 file-tracking의 검사와 같다.
export const SEARCH_INPUT_MAX_BYTES = 16 * 1024 * 1024;

export type SearchExtractionRequest = {
  document: string;
  version: string;
  content_hash: string;
  format: { name: string; module_hash: string };
  files: {
    path: string;
    media_type: string;
    primary: boolean;
    bytes: number;
    channel: number;
  }[];
  // core가 원문을 읽어 보내지 못한 판. 파일은 없고 coordinator는 확인할 수 없는 판으로 남긴다.
  unreadable?: boolean;
};

export type SearchApplyRequest = {
  event: ConsumerEvent;
  // 저장 event일 때만. 원문을 읽지 못한 판은 보내지 않고 요청을 하지 않는다.
  extraction?: SearchExtractionRequest;
};

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function seq(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d*)$/.test(value);
}

export function parseSearchEvent(value: unknown): ConsumerEvent | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const body = value as Record<string, unknown>;
  if (!seq(body.seq) || !text(body.type)) return undefined;
  if (body.subject !== null && typeof body.subject !== "string") {
    return undefined;
  }
  return {
    seq: body.seq,
    type: body.type,
    subject: body.subject as string | null,
    payload: body.payload,
  };
}

function parseExtraction(value: unknown): SearchExtractionRequest | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const body = value as Record<string, unknown>;
  const format = body.format as Record<string, unknown> | undefined;
  if (
    !text(body.document) || !text(body.version) || !text(body.content_hash) ||
    typeof format !== "object" || format === null ||
    !text(format.name) || !text(format.module_hash) ||
    !Array.isArray(body.files)
  ) return undefined;
  const files: SearchExtractionRequest["files"] = [];
  let total = 0;
  for (const raw of body.files) {
    if (typeof raw !== "object" || raw === null) return undefined;
    const entry = raw as Record<string, unknown>;
    if (
      !text(entry.path) || typeof entry.media_type !== "string" ||
      typeof entry.primary !== "boolean" ||
      !Number.isSafeInteger(entry.bytes) || (entry.bytes as number) < 0 ||
      !Number.isSafeInteger(entry.channel) || (entry.channel as number) < 1
    ) return undefined;
    total += entry.bytes as number;
    files.push({
      path: entry.path,
      media_type: entry.media_type,
      primary: entry.primary,
      bytes: entry.bytes as number,
      channel: entry.channel as number,
    });
  }
  if (total > SEARCH_INPUT_MAX_BYTES) return undefined;
  if (body.unreadable !== undefined && typeof body.unreadable !== "boolean") {
    return undefined;
  }
  return {
    document: body.document,
    version: body.version,
    content_hash: body.content_hash,
    format: { name: format.name, module_hash: format.module_hash },
    files,
    ...(body.unreadable === true ? { unreadable: true } : {}),
  };
}

export function parseSearchApply(
  value: unknown,
): SearchApplyRequest | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const body = value as Record<string, unknown>;
  const event = parseSearchEvent(body.event);
  if (event === undefined) return undefined;
  if (body.extraction === undefined) return { event };
  const extraction = parseExtraction(body.extraction);
  return extraction === undefined ? undefined : { event, extraction };
}

export function parseSearchAdvance(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const to = (value as Record<string, unknown>).to;
  return seq(to) ? to : undefined;
}
