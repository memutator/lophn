// Ledger의 domain event를 cursor로 이어 읽고 종류마다 등록된 handler를 부른다.
// 표가 정본이고 Bus 도착은 깨우기일 뿐이다(놓쳐도 5초 poll이 메운다).
import type { Clock, Result } from "../../../base/mod.ts";
import {
  type DomainEvent,
  domainEventSchema,
  type DomainEventType,
} from "../../../protocol/events/mod.ts";
import { reactionIdempotencyKey } from "../../storage/ledger/reaction.ts";
import type { Reactor, ReactorContext, ReactorHandler } from "../ports.ts";

const BATCH = 256;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const POLL_MS = 5_000;

export type ReactorReader = {
  // seq 뒤의 events 행을 seq 순서로 읽는다. 행은 envelope 모양이다.
  after(seq: string, limit: number): Promise<Result<unknown[]>>;
};

export type ReactorCursor = {
  read(): Promise<Result<string>>;
  // 이 event까지 끝났다. 저장되면 다시 켜도 그 뒤부터 잇는다.
  advance(through: string): Promise<Result<void>>;
};

export type ReactorDeps = {
  reader: ReactorReader;
  cursor: ReactorCursor;
  clock: Pick<Clock, "nowMs">;
  log?: (message: string) => void;
};

export type ReactorRunner = Reactor & {
  start(): void;
  stop(): Promise<void>;
  // 지금 표에 있는 새 event를 모두 처리한다. 겹쳐 불러도 한 번에 한 줄로 돈다.
  wake(): Promise<void>;
};

type AnyHandler = ReactorHandler<DomainEventType>;

export function createReactor(deps: ReactorDeps): ReactorRunner {
  const log = deps.log ?? ((message) => console.error(message));
  const handlers = new Map<string, AnyHandler[]>();
  let running: Promise<void> | undefined;
  let again = false;
  let stopped = false;
  let started = false;
  let failures = 0;
  let retryAt = 0;
  let poll: ReturnType<typeof setInterval> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  function contextFor(handler: AnyHandler, event: DomainEvent): ReactorContext {
    return {
      async idempotencyKey(reaction) {
        const key = await reactionIdempotencyKey({
          subscriber: handler.name,
          cause_seq: event.seq,
          reaction,
        });
        if (!key.ok) throw new Error(key.error.message);
        return key.value;
      },
    };
  }

  // 같은 event의 handler를 등록 순서로 부른다. unavailable이나 throw면 false(다시 한다).
  async function react(event: DomainEvent): Promise<boolean> {
    for (const handler of handlers.get(event.type) ?? []) {
      let result: Result<void>;
      try {
        result = await handler.handle(
          event as never,
          contextFor(handler, event),
        );
      } catch {
        log(`reactor: ${handler.name} threw at ${event.type} #${event.seq}`);
        return false;
      }
      if (result.ok) continue;
      if (result.error.code === "unavailable") {
        log(
          `reactor: ${handler.name} unavailable at ${event.type} #${event.seq}`,
        );
        return false;
      }
      // 다시 해도 같은 결과일 오류다. 남기고 이 handler는 끝난 것으로 본다.
      log(
        `reactor: ${handler.name} failed at ${event.type} #${event.seq}: ${result.error.code}`,
      );
    }
    return true;
  }

  function backoff(): void {
    const delay = Math.min(
      BACKOFF_MAX_MS,
      BACKOFF_MIN_MS * 2 ** Math.min(failures, 10),
    );
    failures++;
    retryAt = deps.clock.nowMs() + delay;
    if (started && !stopped) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void wake(), delay);
    }
  }

  // 막히면 false다. backoff는 이미 걸었다.
  async function drain(): Promise<void> {
    while (!stopped) {
      if (deps.clock.nowMs() < retryAt) return;
      const cursor = await deps.cursor.read();
      if (!cursor.ok) return backoff();
      const rows = await deps.reader.after(cursor.value, BATCH);
      if (!rows.ok) return backoff();
      if (rows.value.length === 0) {
        failures = 0;
        return;
      }
      let skipped = 0;
      // 건너뛴 행까지 포함해 마지막으로 지나간 seq. 다음 event가 끝날 때 함께 저장된다.
      let through: string | undefined;
      for (const row of rows.value) {
        if (stopped) return;
        const seq = seqOf(row);
        const parsed = domainEventSchema.safeParse(row);
        if (!parsed.success) {
          skipped++;
          through = seq ?? through;
          continue;
        }
        if (!await react(parsed.data)) return backoff();
        const saved = await deps.cursor.advance(parsed.data.seq);
        if (!saved.ok) return backoff();
        through = undefined;
        failures = 0;
      }
      if (through !== undefined) {
        const saved = await deps.cursor.advance(through);
        if (!saved.ok) return backoff();
      }
      if (skipped > 0) {
        log(`reactor: skipped ${skipped} rows that are not domain events`);
      }
    }
  }

  function wake(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (running !== undefined) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await drain();
        } while (again && !stopped);
      } catch (thrown) {
        log(`reactor: pass failed: ${String(thrown)}`);
        backoff();
      } finally {
        running = undefined;
      }
    })();
    return running;
  }

  return {
    on(type, handler) {
      const list = handlers.get(type) ?? [];
      if (list.some((existing) => existing.name === handler.name)) {
        throw new Error(`reactor handler name taken: ${handler.name}`);
      }
      list.push(handler as unknown as AnyHandler);
      handlers.set(type, list);
    },
    wake,
    start() {
      if (started) return;
      started = true;
      poll = setInterval(() => void wake(), POLL_MS);
      void wake();
    },
    async stop() {
      stopped = true;
      clearInterval(poll);
      clearTimeout(retryTimer);
      await running;
    },
  };
}

function seqOf(row: unknown): string | undefined {
  const seq = (row as { seq?: unknown } | null)?.seq;
  return typeof seq === "string" ? seq : undefined;
}
