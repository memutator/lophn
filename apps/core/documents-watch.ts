// core가 documents coordinator의 context watch consumer에 저장 event를 보낸다(documents#T24).
// consumer의 자리(`watch` cursor)는 derived store에 있고 coordinator가 유일한 writer다. core는 그
// 자리부터 DocumentSaved·DocumentRestored를 feed 자격(`machine:documents-feed`)으로 읽고, 저장마다 source_seq
// 당시 watch였고 그 뒤 바뀌지 않은 문서 항목을 ledger snapshot read로 가려 coordinator에 보낸다.
// 비교와 `context.record_watch_change` 제출, cursor 진행은 coordinator가 한다. 구독 event는 깨우는
// 신호이고 읽기는 늘 cursor부터라서 구독이 끊긴 동안의 변화도 다음 확인이 따라잡는다
// (at-least-once: 같은 결과는 command의 중복키가 한 번만 기록한다). 추출이 끝나 다시 확인할 수
// 있게 된 미확인 비교는 같은 저장 event를 다시 보내 확인한다. 변화 event로 agent run을 시작하지
// 않는다.
import type { Result } from "../../packages/base/mod.ts";
import type { RequestContext } from "../../packages/contracts/platform/mod.ts";
import {
  SEARCH_OPS,
  WATCH_CONSUMED_EVENTS,
  WATCH_OPS,
  type WatchApplyRequest,
  type WatchVersionInfo,
} from "../../packages/documents/outline-and-search/mod.ts";
import type { EventBackend } from "../../packages/platform/ledger/mod.ts";

// 저장 event 하나의 확인 근거. 저장 판과 직전 판의 hash, 그 시점의 watch 항목이다.
export type WatchInput = {
  before: WatchVersionInfo | null;
  // 판 행이 없으면 null이다. 확인할 수 없어 지나간다.
  after: WatchVersionInfo | null;
  targets: WatchApplyRequest["targets"];
};

export type WatchSyncDeps = {
  events: EventBackend;
  // feed 자격(ledger credential 기록의 core 내부 machine).
  context: RequestContext;
  // coordinator 요청 통로.
  request(
    op: string,
    payload: unknown,
    timeoutMs: number,
  ): Promise<Result<unknown>>;
  // 저장 event의 확인 근거를 ledger snapshot에서 읽는다.
  inputOf(
    event: {
      document: string;
      version: string;
      previous_version: string | null;
      source_seq: string;
    },
  ): Promise<Result<WatchInput>>;
  // 지금 ledger의 식별. coordinator가 derived store를 이 ledger에 맞춘 뒤에 cursor를 돌려준다
  // (복원한 ledger의 같은 seq를 옛 cursor로 건너뛰지 않는다, platform#T42).
  ledgerId: string;
  // 읽기·보내기가 실패했을 때 다시 확인하기까지의 대기. 성공이면 timer를 두지 않는다.
  retryMs: number;
  pageLimit?: number;
};

export type WatchSync = {
  // 한 번 따라잡는다. event 구독자와 시험이 같은 함수를 부른다.
  check(): Promise<void>;
  stop(): void;
};

const REQUEST_TIMEOUT_MS = 5_000;
// 비교는 coordinator가 command를 제출하는 시간을 덮는다.
const APPLY_TIMEOUT_MS = 30_000;
const EVENT_PAGE = 200;

function seqOf(value: unknown): string | undefined {
  const body = value as { processed_seq?: unknown };
  return typeof body === "object" && body !== null &&
      typeof body.processed_seq === "string"
    ? body.processed_seq
    : undefined;
}

function seqsOf(value: unknown): string[] {
  const body = value as { source_seqs?: unknown };
  if (typeof body !== "object" || body === null) return [];
  if (!Array.isArray(body.source_seqs)) return [];
  return body.source_seqs.filter((seq): seq is string =>
    typeof seq === "string" && /^(0|[1-9]\d*)$/.test(seq)
  );
}

type SavedEvent = {
  seq: string;
  subject: string | null;
  payload: unknown;
};

export function watchContextChanges(deps: WatchSyncDeps): WatchSync {
  let stopped = false;
  let running: Promise<void> | undefined;
  let again = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  function retryLater() {
    if (stopped || retry !== undefined) return;
    retry = setTimeout(() => {
      retry = undefined;
      void check();
    }, deps.retryMs);
  }

  // 저장 event 하나를 확인한다. 항목이 없으면 보낼 것이 없다. force는 다시 확인하는 흐름으로,
  // 항목이 사라졌어도 coordinator가 그 event의 낡은 미확인을 지우도록 보낸다.
  async function applyOne(
    event: SavedEvent,
    force: boolean,
  ): Promise<Result<unknown> | undefined> {
    const body = event.payload as {
      version?: unknown;
      previous_version?: unknown;
    };
    if (
      typeof event.subject !== "string" || typeof body.version !== "string" ||
      !(body.previous_version === null ||
        typeof body.previous_version === "string")
    ) return undefined;
    const input = await deps.inputOf({
      document: event.subject,
      version: body.version,
      previous_version: body.previous_version,
      source_seq: event.seq,
    });
    if (!input.ok) return input;
    if (input.value.after === null) return undefined;
    if (input.value.targets.length === 0 && !force) return undefined;
    return await deps.request(
      WATCH_OPS.apply,
      {
        event: {
          seq: event.seq,
          document: event.subject,
          version: body.version,
          previous_version: body.previous_version,
        },
        before: input.value.before,
        after: input.value.after,
        targets: input.value.targets,
      },
      APPLY_TIMEOUT_MS,
    );
  }

  async function once(): Promise<void> {
    const ctx = await deps.events.current(deps.context.credential_ref);
    if (stopped) return;
    if (!ctx.ok) return retryLater();
    // derived store를 이 ledger에 맞추는 문은 search consumer 통로와 같다.
    const known = await deps.request(
      SEARCH_OPS.ledger,
      { ledger_id: deps.ledgerId },
      REQUEST_TIMEOUT_MS,
    );
    if (stopped) return;
    if (!known.ok) return retryLater();
    const cursor = await deps.request(WATCH_OPS.cursor, {}, REQUEST_TIMEOUT_MS);
    if (stopped) return;
    const start = cursor.ok ? seqOf(cursor.value) : undefined;
    if (start === undefined) return retryLater();
    let position = start;
    while (!stopped) {
      const batch = await deps.events.read(ctx.value, {
        position,
        inclusive: false,
        types: [...WATCH_CONSUMED_EVENTS],
        limit: deps.pageLimit ?? EVENT_PAGE,
      });
      if (stopped) return;
      if (!batch.ok) return retryLater();
      for (const event of batch.value.events) {
        const applied = await applyOne(event, false);
        if (stopped) return;
        if (applied !== undefined && !applied.ok) return retryLater();
      }
      const through = batch.value.scanned_through_seq;
      if (BigInt(through) <= BigInt(position)) break;
      // 확인할 항목이 없던 event를 지나 자리만 앞으로 보낸다.
      const advanced = await deps.request(
        WATCH_OPS.advance,
        { to: through },
        REQUEST_TIMEOUT_MS,
      );
      if (stopped) return;
      if (!advanced.ok) return retryLater();
      position = through;
      if (BigInt(through) >= BigInt(batch.value.head_seq)) break;
    }
    // 추출이 끝나는 등 다시 확인할 수 있게 된 미확인 비교는 그 저장 event를 다시 보낸다.
    const pending = await deps.request(
      WATCH_OPS.pending,
      {},
      REQUEST_TIMEOUT_MS,
    );
    if (stopped) return;
    if (!pending.ok) return retryLater();
    for (const seq of seqsOf(pending.value)) {
      const read = await deps.events.read(ctx.value, {
        position: (BigInt(seq) - 1n).toString(),
        inclusive: false,
        types: [...WATCH_CONSUMED_EVENTS],
        limit: 1,
      });
      if (stopped) return;
      if (!read.ok) return retryLater();
      const event = read.value.events.find((candidate) =>
        candidate.seq === seq
      );
      if (event === undefined) continue;
      const applied = await applyOne(event, true);
      if (stopped) return;
      if (applied !== undefined && !applied.ok) return retryLater();
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
