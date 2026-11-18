// terminal view: 폰이 보는 터미널(coding session의 터미널과 폰이 연 터미널)의 최신 화면(메모리)과 보는 principal의 lease다. 여는 것과
// 입력은 `terminals/open|input`이 한다.
// lease가 있는 터미널만 core가 PTY host의 화면을 주기로 읽어 최신 하나를 둔다. 내용은 event에 싣지 않고 seq만 알린다(폰이 snapshot을
// 다시 읽는다). PTY 크기는 마지막에 잡은 쪽이 이긴다: 폰이 `resize`로 잡고(폰 크기 표지) desktop 탭은 focus가 오면 다시 잡는다. lease가
// 모두 끝나면 core가 폰의 크기를 놓아 desktop 탭이 자기 크기로 되돌린다(지킴 18).
import {
  type Clock,
  err,
  type LophnError,
  ok,
  type Result,
} from "../../base/mod.ts";
import type { BusEvent } from "../../protocol/events/bus.ts";
import type { TerminalScreen, Terminals } from "../terminals/ports.ts";

// 폰이 10초마다 갱신하고 core는 30초 안에 갱신이 없으면 lease를 거둔다.
export const LEASE_MS = 30_000;
export const TAIL_DEFAULT = 100;
// lease가 있는 동안 화면을 읽는 간격.
export const SCREEN_MS = 250;

export type TerminalViewDeps = {
  clock: Clock;
  publish(event: BusEvent): void;
  terminals: Pick<Terminals, "resize" | "screen" | "runtime">;
  // ms 뒤에 한 번 부른다. 취소하는 함수를 돌려준다.
  after(ms: number, run: () => void): () => void;
  // 그 터미널이 coding session 목록에 있다. 기기가 `terminals/open`으로 연 터미널은 이 모듈이 따로 안다(`adopt`).
  known(terminal: string): boolean;
  // 이 principal이 터미널에 칠 수 있다(`snapshot`의 input. 폰이 입력 칸을 그릴지 정한다).
  mayType(principal: string): boolean;
};

type Lease = { terminal: string; tail: number; expiresAt: number };

const GONE = "The terminal is not open on the computer.";

// 이 route들이 선언한 code 가운데 터미널이 돌려줄 수 있는 것만 그대로 내보낸다. 나머지는 unavailable이다.
const PASSED_CODES = new Set<string>([
  "invalid_input",
  "not_found",
  "conflict",
  "unavailable",
]);
const passed = (error: LophnError): LophnError =>
  PASSED_CODES.has(error.code) ? error : { ...error, code: "unavailable" };

export function createTerminalView(deps: TerminalViewDeps) {
  const { terminals } = deps;
  // 키는 `<principal>\n<terminal>`이다.
  const leases = new Map<string, Lease>();
  const screens = new Map<string, TerminalScreen>();
  // 화면을 읽는 timer. lease가 있는 터미널만 있다.
  const polls = new Map<string, () => void>();
  // 폰이 연 터미널. coding session 목록에 없어도 본다. 터미널이 없다고 답하면 뺀다.
  const opened = new Set<string>();
  const known = (terminal: string) =>
    opened.has(terminal) || deps.known(terminal);

  // lease들의 tail 최대다. lease가 없으면 null(읽지 않는다).
  function wanted(terminal: string): number | null {
    let tail: number | null = null;
    for (const lease of leases.values()) {
      if (lease.terminal === terminal && (tail === null || lease.tail > tail)) {
        tail = lease.tail;
      }
    }
    return tail;
  }

  // 지금 화면을 읽어 바뀌었으면 두고 알린다.
  async function read(terminal: string): Promise<Result<void>> {
    const tail = wanted(terminal);
    if (tail === null) return ok(undefined);
    const done = await terminals.screen(terminal, tail);
    if (!done.ok) return done;
    if (wanted(terminal) === null) return ok(undefined);
    const before = screens.get(terminal);
    screens.set(terminal, done.value);
    if (
      before === undefined ||
      before.seq !== done.value.seq ||
      before.generation !== done.value.generation ||
      before.columns !== done.value.columns ||
      before.rows !== done.value.rows
    ) {
      deps.publish({
        type: "TerminalScreenChanged",
        subject: `terminal:${terminal}`,
        at: deps.clock.now(),
        payload: { terminal, seq: done.value.seq },
      } as BusEvent);
    }
    return ok(undefined);
  }

  function poll(terminal: string): void {
    if (polls.has(terminal)) return;
    const next = () => {
      polls.set(
        terminal,
        deps.after(SCREEN_MS, () => {
          if (wanted(terminal) === null) return;
          void read(terminal).then(() => {
            if (wanted(terminal) !== null) next();
          });
        }),
      );
    };
    next();
  }

  // 그 터미널의 lease가 다 끝났다. 읽기를 멈추고 폰이 잡은 크기를 놓는다(크기는 그대로, 표지만 놓는다).
  function quiet(terminal: string): void {
    if (wanted(terminal) !== null) return;
    polls.get(terminal)?.();
    polls.delete(terminal);
    screens.delete(terminal);
    const runtime = terminals.runtime(terminal);
    if (runtime?.remote_size === true && runtime.state === "running") {
      void terminals.resize(
        terminal,
        runtime.generation,
        { columns: runtime.columns, rows: runtime.rows },
        { remote: false },
      );
    }
  }

  function drop(terminal: string) {
    for (const [key, lease] of leases) {
      if (lease.terminal === terminal) leases.delete(key);
    }
    quiet(terminal);
    opened.delete(terminal);
  }

  const gone = () => err({ code: "not_found" as const, message: GONE });

  return {
    snapshot(principal: string, terminal: string) {
      if (!known(terminal)) return gone();
      const screen = screens.get(terminal);
      if (screen === undefined) {
        return err({
          code: "unavailable" as const,
          message: "The terminal screen has not arrived yet.",
        });
      }
      return ok({ terminal, ...screen, input: deps.mayType(principal) });
    },

    // 켜면 lease를 만들거나 갱신하고 화면을 한 번 읽는다. 끄면 거둔다.
    async watch(
      principal: string,
      input: { terminal: string; on: boolean; tail?: number },
    ): Promise<Result<Record<string, never>>> {
      const { terminal } = input;
      const key = `${principal}\n${terminal}`;
      if (!input.on) {
        leases.delete(key);
        quiet(terminal);
        return ok({});
      }
      if (!known(terminal)) return gone();
      leases.set(key, {
        terminal,
        tail: input.tail ?? TAIL_DEFAULT,
        expiresAt: deps.clock.nowMs() + LEASE_MS,
      });
      const done = await read(terminal);
      if (done.ok) {
        poll(terminal);
        return ok({});
      }
      // 폰이 연 터미널이 컴퓨터에서 닫혔다.
      if (done.error.code === "not_found" && !deps.known(terminal)) {
        drop(terminal);
      }
      return err(passed(done.error));
    },

    // 보는 principal만 PTY 크기를 잡는다. 놓는 것은 lease가 모두 끝난 때다.
    async resize(
      principal: string,
      input: { terminal: string; columns: number; rows: number },
    ): Promise<Result<Record<string, never>>> {
      const { terminal } = input;
      if (!known(terminal)) return gone();
      if (!leases.has(`${principal}\n${terminal}`)) {
        return err({
          code: "conflict" as const,
          message: "Watch the terminal before sizing it.",
        });
      }
      const runtime = terminals.runtime(terminal);
      if (runtime === null) return gone();
      const done = await terminals.resize(
        terminal,
        runtime.generation,
        { columns: input.columns, rows: input.rows },
        { remote: true },
      );
      return done.ok ? ok({}) : err(passed(done.error));
    },

    // 기기가 `terminals/open`으로 연 터미널이다. 목록에 없어도 본다.
    adopt(terminal: string): void {
      opened.add(terminal);
    },

    // 기한이 지난 lease를 거둔다(주기로 부른다).
    expire(): void {
      const now = deps.clock.nowMs();
      const touched = new Set<string>();
      for (const [key, lease] of leases) {
        if (lease.expiresAt <= now) {
          leases.delete(key);
          touched.add(lease.terminal);
        }
      }
      for (const terminal of touched) quiet(terminal);
    },

    // coding session 목록이 바뀌었다. 목록에서 빠진 터미널의 화면과 lease를 지운다.
    pruned(): void {
      const all = new Set([
        ...screens.keys(),
        ...polls.keys(),
        ...[...leases.values()].map((lease) => lease.terminal),
      ]);
      for (const terminal of all) {
        if (!known(terminal)) drop(terminal);
      }
    },

    stop(): void {
      for (const cancel of polls.values()) cancel();
      polls.clear();
    },
  };
}

export type TerminalView = ReturnType<typeof createTerminalView>;
