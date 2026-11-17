// terminal view: 폰이 보는 터미널(coding session의 터미널과 폰이 연 터미널)의 최신 화면(메모리), 보는 principal의 lease, 입력 key 기억이다.
// 화면은 host가 lease가 있는 터미널만 밀어 올리고 core는 최신 하나만 둔다. 내용은 event에 싣지 않고 seq만 알린다(폰이 snapshot을 다시 읽는다).
// PTY 크기는 마지막에 잡은 쪽이 이긴다: 폰이 `resize`로 잡고 desktop 탭은 focus가 오면 다시 잡는다. 화면 밀기가 꺼지면(lease가 모두
// 끝나면) host가 폰의 크기를 놓아 desktop 탭이 자기 크기로 되돌린다.
import {
  err,
  ok,
  type Clock,
  type LophnError,
  type Result,
} from "../../base/mod.ts";
import type { BusEvent } from "../../protocol/events/bus.ts";
import type { HostFrameOf } from "../../protocol/host-link/frames.ts";

// 폰이 10초마다 갱신하고 core는 30초 안에 갱신이 없으면 lease를 거둔다.
export const LEASE_MS = 30_000;
export const TAIL_DEFAULT = 100;
// 터미널마다 기억하는 입력 key 수.
export const INPUT_KEYS_MAX = 200;
// 다시 보낸 open을 알아보는 key 수(전체).
const OPEN_KEYS_MAX = 200;

export type TerminalViewDeps = {
  clock: Clock;
  publish(event: BusEvent): void;
  // host에 보내는 연결 요청이다. 연결이 없거나 닫히거나 기한이 지나면 `unavailable`이다.
  call(request: TerminalRequest): Promise<Result<unknown>>;
  // 그 터미널이 coding session 목록에 있다. 폰이 `open`으로 연 터미널은 이 모듈이 따로 안다.
  known(terminal: string): boolean;
  // 이 principal이 터미널에 칠 수 있다.
  mayType(principal: string): boolean;
};

export type TerminalRequest =
  | {
      kind: "terminal_stream";
      payload: { terminal_ref: string; on: boolean; tail: number };
    }
  | {
      kind: "terminal_input";
      payload: { terminal_ref: string; text: string };
    }
  | {
      kind: "terminal_resize";
      payload: { terminal_ref: string; columns: number; rows: number };
    }
  | {
      kind: "terminal_open";
      payload: { project: string };
    };

type Screen = HostFrameOf<"terminal_screen">;
type Lease = { terminal: string; tail: number; expiresAt: number };

const GONE = "The terminal is not open on the computer.";

// 이 route들이 선언한 code 가운데 host가 돌려줄 수 있는 것만 그대로 내보낸다. 나머지는 unavailable이다.
const PASSED_CODES = new Set<string>([
  "invalid_input",
  "not_found",
  "conflict",
  "unavailable",
]);
const passed = (error: LophnError): LophnError =>
  PASSED_CODES.has(error.code) ? error : { ...error, code: "unavailable" };

// host의 답은 JSON `{"terminal_ref":"…"}` 글 하나다.
function terminalOf(content: unknown): string | null {
  const first = Array.isArray(content) ? content[0] : undefined;
  if (first?.type !== "text") return null;
  try {
    const ref = (JSON.parse(first.text) as { terminal_ref?: unknown })
      .terminal_ref;
    return typeof ref === "string" && ref.startsWith("trm_") ? ref : null;
  } catch {
    return null;
  }
}

export function createTerminalView(deps: TerminalViewDeps) {
  // 키는 `<principal>\n<terminal>`이다.
  const leases = new Map<string, Lease>();
  const screens = new Map<string, Screen>();
  // host에 켜 달라고 한 tail(성공한 것만). 연결이 닫히면 host가 잃으므로 비운다.
  const sent = new Map<string, number>();
  const flying = new Map<string, Promise<Result<unknown>>>();
  const keys = new Map<string, Map<string, Promise<Result<unknown>>>>();
  // 폰이 연 터미널. coding session 목록에 없어도 본다. host가 그 터미널이 없다고 답하면 뺀다.
  const opened = new Set<string>();
  const opens = new Map<string, Promise<Result<{ terminal: string }>>>();
  const known = (terminal: string) =>
    opened.has(terminal) || deps.known(terminal);

  // lease들의 tail 최대다. lease가 없으면 null(꺼야 한다).
  function wanted(terminal: string): number | null {
    let tail: number | null = null;
    for (const lease of leases.values()) {
      if (lease.terminal === terminal && (tail === null || lease.tail > tail)) {
        tail = lease.tail;
      }
    }
    return tail;
  }

  // host가 아는 것을 lease들이 원하는 것에 맞춘다. 진행 중이면 끝난 뒤 다시 맞춘다(켜고 끄는 순서가 뒤집히지 않게).
  function sync(terminal: string): Promise<Result<unknown>> {
    const running = flying.get(terminal);
    if (running !== undefined) return running.then(() => sync(terminal));
    const want = wanted(terminal);
    if ((sent.get(terminal) ?? null) === want) return Promise.resolve(ok({}));
    const call = deps
      .call({
        kind: "terminal_stream",
        payload: {
          terminal_ref: terminal,
          on: want !== null,
          tail: want ?? 0,
        },
      })
      .then((done) => {
        flying.delete(terminal);
        if (done.ok) {
          if (want === null) sent.delete(terminal);
          else sent.set(terminal, want);
        }
        return done;
      });
    flying.set(terminal, call);
    return call;
  }

  function drop(terminal: string) {
    for (const [key, lease] of leases) {
      if (lease.terminal === terminal) leases.delete(key);
    }
    screens.delete(terminal);
    keys.delete(terminal);
    sent.delete(terminal);
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
      return ok({
        terminal,
        generation: screen.generation,
        seq: screen.seq,
        columns: screen.columns,
        rows: screen.rows,
        cursor: screen.cursor,
        scrollback: screen.scrollback,
        lines: screen.lines,
        input: deps.mayType(principal),
      });
    },

    // 켜면 lease를 만들거나 갱신하고, 끄면 거둔다. host에 닿지 않아도 lease는 남아 다시 연결될 때 켠다.
    async watch(
      principal: string,
      input: { terminal: string; on: boolean; tail?: number },
    ): Promise<Result<Record<string, never>>> {
      const { terminal } = input;
      const key = `${principal}\n${terminal}`;
      if (!input.on) {
        leases.delete(key);
        if (wanted(terminal) === null) screens.delete(terminal);
        void sync(terminal);
        return ok({});
      }
      if (!known(terminal)) return gone();
      leases.set(key, {
        terminal,
        tail: input.tail ?? TAIL_DEFAULT,
        expiresAt: deps.clock.nowMs() + LEASE_MS,
      });
      const done = await sync(terminal);
      if (done.ok) return ok({});
      // 폰이 연 터미널이 컴퓨터에서 닫혔다.
      if (done.error.code === "not_found" && !deps.known(terminal)) {
        drop(terminal);
      }
      return err(passed(done.error));
    },

    // 보는 principal만 PTY 크기를 잡는다. 놓는 것은 host가 화면 밀기를 끌 때 한다(lease가 모두 끝난 때).
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
      const done = await deps.call({
        kind: "terminal_resize",
        payload: {
          terminal_ref: terminal,
          columns: input.columns,
          rows: input.rows,
        },
      });
      return done.ok ? ok({}) : err(passed(done.error));
    },

    // project에 터미널 탭을 연다. 같은 key는 한 번만 연다(보내는 중이거나 성공한 것의 답을 준다. 실패한 key는 잊는다).
    open(input: {
      project: string;
      key: string;
    }): Promise<Result<{ terminal: string }>> {
      const seen = opens.get(input.key);
      if (seen !== undefined) return seen;
      const sending = deps
        .call({ kind: "terminal_open", payload: { project: input.project } })
        .then((done): Result<{ terminal: string }> => {
          if (!done.ok) return err(passed(done.error));
          const terminal = terminalOf(done.value);
          if (terminal === null) {
            return err({
              code: "unavailable" as const,
              message: "The lophn app answered without a terminal.",
            });
          }
          opened.add(terminal);
          return ok({ terminal });
        });
      opens.set(input.key, sending);
      while (opens.size > OPEN_KEYS_MAX) {
        opens.delete(opens.keys().next().value!);
      }
      void sending.then((done) => {
        if (!done.ok && opens.get(input.key) === sending) {
          opens.delete(input.key);
        }
      });
      return sending;
    },

    // 허락 확인은 부른 쪽이 아니라 여기서 한다. 같은 key는 터미널마다 200개를 기억해 host에 다시 보내지 않는다.
    input(
      principal: string,
      input: { terminal: string; text: string; key: string },
    ): Promise<Result<Record<string, never>>> {
      if (!deps.mayType(principal)) {
        return Promise.resolve(
          err({
            code: "forbidden" as const,
            message: "This device may not type into terminals.",
          }),
        );
      }
      const { terminal } = input;
      if (!known(terminal)) return Promise.resolve(gone());
      let seen = keys.get(terminal);
      if (seen === undefined) keys.set(terminal, (seen = new Map()));
      const before = seen.get(input.key);
      if (before !== undefined) return before as never;
      const table = seen;
      const sentInput = deps
        .call({
          kind: "terminal_input",
          payload: { terminal_ref: terminal, text: input.text },
        })
        .then((done): Result<Record<string, never>> => {
          if (!done.ok) {
            if (table.get(input.key) === sentInput) table.delete(input.key);
            return err(passed(done.error));
          }
          return ok({});
        });
      table.set(input.key, sentInput);
      while (table.size > INPUT_KEYS_MAX) {
        table.delete(table.keys().next().value!);
      }
      return sentInput;
    },

    // lease가 있는 터미널의 최신 화면으로 바꾸고 알린다.
    screen(frame: Screen): void {
      const terminal = frame.terminal_ref;
      if (wanted(terminal) === null || !known(terminal)) return;
      screens.set(terminal, frame);
      deps.publish({
        type: "TerminalScreenChanged",
        subject: `terminal:${terminal}`,
        at: deps.clock.now(),
        payload: { terminal, seq: frame.seq },
      } as BusEvent);
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
      for (const terminal of touched) {
        if (wanted(terminal) === null) screens.delete(terminal);
        void sync(terminal);
      }
    },

    // coding session 목록이 바뀌었다. 목록에서 빠진 터미널의 화면과 lease를 지운다.
    pruned(): void {
      const all = new Set([
        ...screens.keys(),
        ...sent.keys(),
        ...keys.keys(),
        ...[...leases.values()].map((lease) => lease.terminal),
      ]);
      for (const terminal of all) {
        if (!known(terminal)) drop(terminal);
      }
    },

    // 연결이 닫혔다. host는 화면을 밀던 것을 잃는다.
    closed(): void {
      sent.clear();
    },

    // 연결이 다시 열렸다. 살아 있는 lease마다 다시 켠다.
    opened(): void {
      for (const terminal of new Set(
        [...leases.values()].map((l) => l.terminal),
      )) {
        void sync(terminal);
      }
    },
  };
}

export type TerminalView = ReturnType<typeof createTerminalView>;
