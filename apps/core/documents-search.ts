// core가 documents coordinator의 search consumer에 event와 저장 판 원문을 보낸다(documents#T21,
// T13에서 넘어온 것). consumer의 자리(cursor)는 derived store에 있고 coordinator가 유일한
// writer다. core는 그 자리부터 event 구독의 ledger를 feed 자격(`machine:documents-feed`)으로
// 읽어 consumer가 쓰는 event만 순서대로 보낸다. 저장 event의 판은 ledger 판 행의 파일 목록대로
// I/O worker의 원문 blob을 byte chunk frame으로 먼저 보낸다. 결과·FTS·cursor는 coordinator가
// 한 derived transaction에 쓴다. 구독 event는 깨우는 신호이고 읽기는 늘 cursor부터라서
// 구독이 끊긴 동안의 변화도 다음 확인이 따라잡는다(at-least-once, 같은 seq는 건너뛴다).
import type { Result } from "../../packages/base/mod.ts";
import {
  FORMAT_CHECK_CONTENT_MAX_BYTES,
  formatCheckLimitMessage,
  formatChecksContent,
} from "../../packages/contracts/documents/mod.ts";
import type { RequestContext } from "../../packages/contracts/platform/mod.ts";
import {
  extractionTargetOf,
  SEARCH_CONSUMED_EVENTS,
  SEARCH_OPS,
  type SearchExtractionRequest,
} from "../../packages/documents/outline-and-search/mod.ts";
import type { EventBackend } from "../../packages/platform/ledger/mod.ts";
import type { Streamer } from "./documents-validate.ts";

// 저장 판의 추출 입력. ledger 판 행과 파일 목록이다.
export type SearchVersion = {
  document: string;
  content_hash: string;
  format: { name: string; module_hash: string };
  files: readonly {
    path: string;
    blob_hash: string;
    bytes: number;
    media_type: string;
    primary: boolean;
  }[];
};

export type SearchSyncDeps = {
  events: EventBackend;
  // feed 자격(ledger credential 기록의 core 내부 machine).
  context: RequestContext;
  // coordinator 요청 통로.
  request(
    op: string,
    payload: unknown,
    timeoutMs: number,
  ): Promise<Result<unknown>>;
  // 판 행을 읽는다(reader의 내부 read). 없는 판은 null이다.
  versionOf(version: string): Promise<Result<SearchVersion | null>>;
  streamer: Streamer;
  // 지금 ledger의 식별. coordinator가 derived store를 이 ledger에 맞춘 뒤에 cursor를 돌려준다
  // (복원한 ledger의 같은 seq를 옛 cursor로 건너뛰지 않는다, platform#T42).
  ledgerId: string;
  // 읽기·보내기가 실패했을 때 다시 확인하기까지의 대기. 성공이면 timer를 두지 않는다.
  retryMs: number;
  pageLimit?: number;
};

export type SearchSync = {
  // 한 번 따라잡는다. event 구독자와 시험이 같은 함수를 부른다.
  check(): Promise<void>;
  stop(): void;
};

const REQUEST_TIMEOUT_MS = 5_000;
// 추출은 runner 호출(기한 5초)과 입력 이동을 덮는다.
const APPLY_TIMEOUT_MS = 30_000;
const EVENT_PAGE = 200;
// 같은 event의 원문을 읽어 보내지 못하는 일이 이만큼 연달아 이어지면 그 판은 확인할 수
// 없는 판으로 남기고 지난다. 사라진 blob 하나가 뒤의 모든 문서를 막지 않게 한다.
const UNREADABLE_ATTEMPTS = 3;

function seqOf(value: unknown): string | undefined {
  const body = value as { processed_seq?: unknown };
  return typeof body === "object" && body !== null &&
      typeof body.processed_seq === "string"
    ? body.processed_seq
    : undefined;
}

export function watchSearchIndex(deps: SearchSyncDeps): SearchSync {
  let stopped = false;
  let running: Promise<void> | undefined;
  let again = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const unreadable = new Map<string, number>();

  function retryLater() {
    if (stopped || retry !== undefined) return;
    retry = setTimeout(() => {
      retry = undefined;
      void check();
    }, deps.retryMs);
  }

  // event 하나를 coordinator에 적용한다. 저장 event는 원문과 함께다.
  async function apply(
    event: {
      seq: string;
      type: string;
      subject: string | null;
      payload: unknown;
    },
  ): Promise<Result<unknown>> {
    const message = {
      seq: event.seq,
      type: event.type,
      subject: event.subject,
      payload: event.payload,
    };
    const target = extractionTargetOf(message);
    if (target === undefined) {
      return await deps.request(
        SEARCH_OPS.apply,
        { event: message },
        APPLY_TIMEOUT_MS,
      );
    }
    const version = await deps.versionOf(target.version);
    if (!version.ok) return version;
    // 판 행이 없거나 다른 문서의 판이면 본문을 읽을 수 없다. 낡은 index 행만 걷는다.
    if (version.value === null || version.value.document !== target.document) {
      return await deps.request(
        SEARCH_OPS.apply,
        { event: message },
        APPLY_TIMEOUT_MS,
      );
    }
    const info = version.value;
    // 추출도 format 검사처럼 바이트를 읽는 format의 대표 파일 하나만 guest에 넘기고, 그 파일이
    // 한도를 넘으면 runner를 부르지 않고 이유를 밝힌 미확인으로 남긴다(세 번 실패하지 않는다).
    const reads = (file: { primary: boolean }) =>
      formatChecksContent(info.format.name) && file.primary;
    const primary = info.files.find((file) => file.primary);
    const base = {
      document: target.document,
      version: target.version,
      content_hash: info.content_hash,
      format: {
        name: info.format.name,
        module_hash: info.format.module_hash,
      },
    };
    if (
      primary !== undefined && reads(primary) &&
      primary.bytes > FORMAT_CHECK_CONTENT_MAX_BYTES
    ) {
      return await deps.request(
        SEARCH_OPS.apply,
        {
          event: message,
          extraction: {
            ...base,
            files: [],
            unverified: formatCheckLimitMessage(primary.bytes),
          },
        },
        APPLY_TIMEOUT_MS,
      );
    }
    const sent = await deps.streamer.exclusive(async () => {
      const streamed = await deps.streamer.stream(info.files, reads);
      if (!streamed.ok) return streamed;
      const extraction: SearchExtractionRequest = {
        ...base,
        files: streamed.value,
      };
      return await deps.request(
        SEARCH_OPS.apply,
        { event: message, extraction },
        APPLY_TIMEOUT_MS,
      );
    });
    if (sent.ok) {
      unreadable.delete(event.seq);
      return sent;
    }
    // 원문을 읽지 못한 실패가 이어지면 그 판은 확인할 수 없는 판이다.
    if (sent.error.code === "unavailable" && !stopped) {
      const failed = (unreadable.get(event.seq) ?? 0) + 1;
      if (failed < UNREADABLE_ATTEMPTS) {
        unreadable.set(event.seq, failed);
        return sent;
      }
      unreadable.delete(event.seq);
      return await deps.request(
        SEARCH_OPS.apply,
        {
          event: message,
          extraction: {
            ...base,
            files: [],
            unverified: "the original bytes could not be read",
          },
        },
        APPLY_TIMEOUT_MS,
      );
    }
    return sent;
  }

  async function once(): Promise<void> {
    const ctx = await deps.events.current(deps.context.credential_ref);
    if (stopped) return;
    if (!ctx.ok) return retryLater();
    const known = await deps.request(
      SEARCH_OPS.ledger,
      { ledger_id: deps.ledgerId },
      REQUEST_TIMEOUT_MS,
    );
    if (stopped) return;
    if (!known.ok) return retryLater();
    const cursor = await deps.request(
      SEARCH_OPS.cursor,
      {},
      REQUEST_TIMEOUT_MS,
    );
    if (stopped) return;
    const start = cursor.ok ? seqOf(cursor.value) : undefined;
    if (start === undefined) return retryLater();
    let position = start;
    while (!stopped) {
      const batch = await deps.events.read(ctx.value, {
        position,
        inclusive: false,
        types: [...SEARCH_CONSUMED_EVENTS],
        limit: deps.pageLimit ?? EVENT_PAGE,
      });
      if (stopped) return;
      if (!batch.ok) return retryLater();
      for (const event of batch.value.events) {
        const applied = await apply({
          seq: event.seq,
          type: event.type,
          subject: event.subject,
          payload: event.payload,
        });
        if (stopped) return;
        if (!applied.ok) return retryLater();
      }
      const through = batch.value.scanned_through_seq;
      if (BigInt(through) <= BigInt(position)) return;
      // consumer가 쓰지 않는 event를 지나 자리만 앞으로 보낸다.
      const advanced = await deps.request(
        SEARCH_OPS.advance,
        { to: through },
        REQUEST_TIMEOUT_MS,
      );
      if (stopped) return;
      if (!advanced.ok) return retryLater();
      position = through;
      if (BigInt(through) >= BigInt(batch.value.head_seq)) return;
    }
  }

  function check(): Promise<void> {
    // 겹친 확인은 하나로 합친다. 도는 중에 온 신호는 이미 읽은 값 뒤의 변화일 수 있어서
    // 끝난 뒤 한 번 더 확인한다.
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        try {
          await once();
        } catch {
          // 읽기 도중의 예외는 실패와 같다. 다음 확인이 같은 자리부터 다시 한다.
          retryLater();
        }
      } while (again && !stopped);
    })().finally(() => {
      running = undefined;
    });
    return running;
  }

  return {
    check,
    stop() {
      stopped = true;
      clearTimeout(retry);
      retry = undefined;
    },
  };
}
