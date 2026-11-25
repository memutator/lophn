// terminal view: 기기(폰, 연결된 컴퓨터)가 보는 터미널의 최신 화면(메모리)과 보는 principal의 lease다. 이 기계의 어느 터미널이든
// 본다. 여는 것과 입력은 `terminals/open|input`이 한다.
// lease가 있는 터미널만 core가 PTY host의 화면을 읽어 최신 하나를 둔다. 읽는 때는 출력이 났을 때(echo가 보이게 10ms 뒤), 바뀐 직후(30ms),
// 아무 일 없을 때(250ms)다. 바뀐 것이 작으면 event에 바뀐 줄을 diff로 싣고(보는 쪽이 snapshot을 한 번 더 부르지 않는다), 크면 seq만
// 알려 보는 쪽이 snapshot을 읽는다. 날 출력을 넘기지 않는 것은 그대로다: 큰 변화는 250ms 간격으로 묶는다. PTY 크기는 마지막에 잡은 쪽이 이긴다: 폰이 `resize`로 잡고(폰 크기 표지) desktop 탭은 focus가 오면 다시 잡는다. lease가
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
import { diffScreen, SMALL_DIFF_CHARS } from "./diff.ts";

// 폰이 10초마다 갱신하고 core는 30초 안에 갱신이 없으면 lease를 거둔다.
export const LEASE_MS = 30_000;
export const TAIL_DEFAULT = 100;
// 아무 일 없을 때 화면을 읽는 간격이고, 큰 변화(통째로 다시 그리는 TUI, 쏟아지는 출력) 뒤에 다음 읽기까지 두는 간격이다.
export const SCREEN_MS = 250;
// 출력이 난 뒤 화면을 읽기까지: 바로 이어진 짧은 조각을 묶되 echo 지연을 줄인다.
export const ECHO_MS = 6;
// 작은 변화(키 입력의 echo) 뒤 다음 읽기까지.
export const FAST_MS = 25;

export type TerminalViewDeps = {
  clock: Clock;
  publish(event: BusEvent): void;
  terminals: Pick<Terminals, "resize" | "screen" | "runtime" | "onOutput">;
  // ms 뒤에 한 번 부른다. 취소하는 함수를 돌려준다.
  after(ms: number, run: () => void): () => void;
  // 이 principal이 터미널에 칠 수 있다(`snapshot`의 input. 폰이 입력 칸을 그릴지 정한다).
  mayType(principal: string): boolean;
};

type Lease = { terminal: string; tail: number; expiresAt: number };

// 터미널마다 읽기의 박자. timer는 다음 읽기 하나이고, inflight가 있는 동안 온 읽기 요청은 again으로 모아 끝난 뒤 한 번 더 읽는다.
type Pace = {
  timer: (() => void) | null;
  due: number;
  inflight: Promise<Result<void>> | null;
  again: boolean;
  // 이 시각 전에는 출력이 나도 읽지 않는다(큰 변화 뒤 250ms).
  readyAt: number;
};

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
  // 화면을 읽는 박자. lease가 있는 터미널만 있다.
  const paces = new Map<string, Pace>();
  const known = (terminal: string) => terminals.runtime(terminal) !== null;

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

  // 지금 화면을 읽어 바뀌었으면 두고 알린다. 다음 읽기까지의 간격(`gap`은 출력으로 앞당길 수 있는 가장 이른 때, `idle`은 아무 일 없을 때)을 돌려준다.
  async function read(
    terminal: string,
  ): Promise<Result<{ gap: number; idle: number }>> {
    const quiet = { gap: 0, idle: SCREEN_MS };
    const tail = wanted(terminal);
    if (tail === null) return ok(quiet);
    const prev = screens.get(terminal);
    const known =
      prev === undefined
        ? undefined
        : {
            afterSeq: prev.seq,
            generation: prev.generation,
            columns: prev.columns,
            rows: prev.rows,
            ...(prev.scrollback_key === undefined
              ? {}
              : { scrollbackKey: prev.scrollback_key }),
          };
    const done = await terminals.screen(terminal, tail, known);
    if (!done.ok) return done;
    if (done.value === null) return ok(quiet);
    if (wanted(terminal) === null) return ok(quiet);
    const before = screens.get(terminal);
    screens.set(terminal, done.value);
    if (
      before !== undefined &&
      before.seq === done.value.seq &&
      before.generation === done.value.generation &&
      before.columns === done.value.columns &&
      before.rows === done.value.rows
    ) {
      return ok(quiet);
    }
    const diffed = diffScreen(before, done.value);
    deps.publish({
      type: "TerminalScreenChanged",
      subject: `terminal:${terminal}`,
      at: deps.clock.now(),
      payload: {
        terminal,
        seq: done.value.seq,
        ...(diffed === null ? {} : { diff: diffed.diff }),
      },
    } as BusEvent);
    // 처음 읽은 화면은 쏟음의 표지가 아니라 diff 없이도 작게 본다.
    const small =
      before === undefined ||
      (diffed !== null && diffed.chars <= SMALL_DIFF_CHARS);
    const next = small ? FAST_MS : SCREEN_MS;
    return ok({ gap: next, idle: next });
  }

  // 건 timer를 거두고 이미 불린 timer가 읽지 않게 한다.
  function stopPace(pace: Pace | undefined): void {
    pace?.timer?.();
    if (pace !== undefined) pace.timer = null;
  }

  function paceOf(terminal: string): Pace {
    let pace = paces.get(terminal);
    if (pace === undefined) {
      pace = {
        timer: null,
        due: 0,
        inflight: null,
        again: false,
        readyAt: 0,
      };
      paces.set(terminal, pace);
    }
    return pace;
  }

  // ms 뒤에 읽는다. 이미 더 이른 timer가 있으면 그대로 둔다(`replace`면 바꾼다).
  function arm(terminal: string, ms: number, replace: boolean): void {
    const pace = paceOf(terminal);
    const due = deps.clock.nowMs() + ms;
    if (pace.timer !== null) {
      if (!replace && pace.due <= due) return;
      pace.timer();
    }
    pace.due = due;
    const cancel = deps.after(ms, () => {
      if (pace.timer !== cancel) return;
      pace.timer = null;
      void pull(terminal);
    });
    pace.timer = cancel;
  }

  // 화면을 읽고 다음 읽기를 건다. 읽는 중에 또 부르면 그 읽기가 끝난 뒤 한 번만 더 읽는다.
  function pull(terminal: string): Promise<Result<void>> {
    if (wanted(terminal) === null) return Promise.resolve(ok(undefined));
    const pace = paceOf(terminal);
    if (pace.inflight !== null) {
      pace.again = true;
      return pace.inflight;
    }
    const run = (async (): Promise<Result<void>> => {
      const done = await read(terminal);
      pace.inflight = null;
      if (wanted(terminal) === null) return ok(undefined);
      const now = deps.clock.nowMs();
      if (done.ok) pace.readyAt = now + done.value.gap;
      const wait = Math.max(ECHO_MS, pace.readyAt - now);
      if (pace.again) {
        pace.again = false;
        arm(terminal, wait, true);
      } else {
        arm(terminal, done.ok ? done.value.idle : SCREEN_MS, true);
      }
      return done.ok ? ok(undefined) : done;
    })();
    pace.inflight = run;
    return run;
  }

  // 출력이 났다. echo가 화면에 들어갈 만큼 뒤에 읽되 큰 변화 뒤의 간격은 지킨다.
  function poke(terminal: string): void {
    if (wanted(terminal) === null) return;
    const pace = paces.get(terminal);
    if (pace === undefined) return;
    if (pace.inflight !== null) {
      pace.again = true;
      return;
    }
    arm(terminal, Math.max(ECHO_MS, pace.readyAt - deps.clock.nowMs()), false);
  }

  const offOutput = terminals.onOutput((output) => {
    for (const terminal of new Set(output.map((one) => one.terminal_ref))) {
      poke(terminal);
    }
  });

  // 그 터미널의 lease가 다 끝났다. 읽기를 멈추고 폰이 잡은 크기를 놓는다(크기는 그대로, 표지만 놓는다).
  function quiet(terminal: string): void {
    if (wanted(terminal) !== null) return;
    stopPace(paces.get(terminal));
    paces.delete(terminal);
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
      const { scrollback_key: _key, ...publicScreen } = screen;
      return ok({ terminal, ...publicScreen, input: deps.mayType(principal) });
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
      const done = await pull(terminal);
      if (done.ok) return ok({});
      if (done.error.code === "not_found") drop(terminal);
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

    // 터미널이 바뀌었다. 없어진 터미널의 화면과 lease를 지운다.
    pruned(): void {
      const all = new Set([
        ...screens.keys(),
        ...paces.keys(),
        ...[...leases.values()].map((lease) => lease.terminal),
      ]);
      for (const terminal of all) {
        if (!known(terminal)) drop(terminal);
      }
    },

    stop(): void {
      offOutput();
      for (const pace of paces.values()) stopPace(pace);
      paces.clear();
    },
  };
}

export type TerminalView = ReturnType<typeof createTerminalView>;
