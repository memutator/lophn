// `lophn terminal read|snapshot|act|wait|resize`의 core 실행기.
// 소유권·take control 검증, 라이브 모드 기반 순수 입력 인코딩, 베이스라인 선캡처 + 이벤트 구동 wait,
// known-value redaction을 한 곳에서 수행한다. 창이 없어도 동작한다.
import { type Clock, err, ok, type Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { TerminalRuntime } from "../../protocol/coding-agent/terminals.ts";
import {
  TERMINAL_PERSON_CONTROLLING_MESSAGE,
  TUI_IDLE_DEFAULT_MS,
  TUI_WAIT_DEFAULT_MS,
  type TuiActOutput,
  type TuiHighlight,
  type TuiReadOutput,
  type TuiSnapshot,
  type TuiWaitResult,
} from "../../protocol/lophn-agent/terminal-use.ts";
import type { TuiScreenSnapshot } from "../terminals/host/screen.ts";
import {
  encodeMouse,
  encodePaste,
  encodePress,
  encodeType,
} from "../terminals/input-encoder.ts";
import type { Terminals } from "../terminals/ports.ts";
import type { HostQueueService, TabOwner } from "./queue.ts";

const REDACT_FAILED = "the terminal result could not be checked for secrets";
const NOT_RUNNING =
  "Terminal process is not running; inspect the screen with `lophn terminal snapshot` or open a new tab.";

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export type TerminalUseDeps = {
  queue: Pick<HostQueueService, "terminalTab">;
  terminals: Pick<
    Terminals,
    | "tuiState"
    | "tuiSnapshot"
    | "write"
    | "resize"
    | "runtime"
    | "onOutput"
    | "onRuntime"
  >;
  clock: Clock;
  redact(text: string): string | null;
  sleep?(ms: number): Promise<void>;
};

export type TerminalActInput = {
  tab: Id<"tab">;
  type: "type" | "paste" | "press" | "mouse";
  text?: string;
  keys?: string[];
  delay_ms?: number;
  action?: "click" | "down" | "up" | "move" | "scroll_up" | "scroll_down";
  col?: number;
  row?: number;
  button?: "left" | "middle" | "right";
  modifiers?: ("shift" | "alt" | "ctrl")[];
  force?: boolean;
  wait_idle?: number;
  wait_text?: string;
  timeout_ms?: number;
};

export type TerminalWaitInput = {
  tab: Id<"tab">;
  text?: string;
  regex?: string;
  idle_ms?: number;
  await_change?: boolean;
  exit?: boolean;
  timeout_ms?: number;
};

function assembleSnapshot(
  tab: Id<"tab">,
  runtime: TerminalRuntime,
  raw: TuiScreenSnapshot,
  personControlling: boolean,
): TuiSnapshot {
  return {
    tab,
    generation: runtime.generation,
    seq: raw.seq,
    state: runtime.state,
    exit_code: runtime.exit_code,
    exit_signal: runtime.exit_signal ?? null,
    columns: raw.columns,
    rows: raw.rows,
    title: raw.title,
    cursor: raw.cursor,
    modes: raw.modes,
    screen: raw.screen,
    ...(raw.scrollback === undefined ? {} : { scrollback: raw.scrollback }),
    highlights: raw.highlights,
    truncated: raw.truncated,
    person_controlling: personControlling,
  };
}

function redactSnapshot(
  snapshot: TuiSnapshot,
  redact: (text: string) => string | null,
): Result<TuiSnapshot> {
  const title = redact(snapshot.title);
  const screen = redact(snapshot.screen);
  const scrollback =
    snapshot.scrollback === undefined ? undefined : redact(snapshot.scrollback);
  if (
    title === null ||
    screen === null ||
    (snapshot.scrollback !== undefined && scrollback === null)
  ) {
    return err({ code: "unavailable", message: REDACT_FAILED });
  }
  const highlights: TuiHighlight[] = [];
  for (const item of snapshot.highlights) {
    const text = redact(item.text);
    if (text === null) {
      return err({ code: "unavailable", message: REDACT_FAILED });
    }
    highlights.push({ ...item, text });
  }
  return ok({
    ...snapshot,
    title,
    screen,
    ...(scrollback === undefined || scrollback === null ? {} : { scrollback }),
    highlights,
  });
}

type WaitBaseline = {
  visualHash: string;
  subscribe(): {
    onChange(cb: () => void): void;
    dispose(): void;
  };
};

export function createTerminalUseDriver(deps: TerminalUseDeps) {
  const { queue, terminals, clock, redact } = deps;
  const sleep = deps.sleep ?? defaultSleep;

  function subscribeTerminal(terminalRef: string) {
    let listener: (() => void) | null = null;
    let dirty = false;
    const notify = () => {
      if (listener !== null) listener();
      else dirty = true;
    };
    const offOutput = terminals.onOutput((chunks) => {
      if (chunks.some((chunk) => chunk.terminal_ref === terminalRef)) {
        notify();
      }
    });
    const offRuntime = terminals.onRuntime((runtime) => {
      if (
        runtime.terminal_ref === terminalRef &&
        (runtime.state === "exited" || runtime.state === "unknown")
      ) {
        notify();
      }
    });
    return {
      onChange(cb: () => void) {
        listener = cb;
        if (dirty) {
          dirty = false;
          cb();
        }
      },
      dispose() {
        listener = null;
        offOutput();
        offRuntime();
      },
    };
  }

  async function waitInternal(
    tab: Id<"tab">,
    caller: TabOwner,
    terminalRef: string,
    input: Omit<TerminalWaitInput, "tab">,
    baseline?: WaitBaseline,
  ): Promise<Result<TuiWaitResult>> {
    if (
      input.text === undefined &&
      input.regex === undefined &&
      input.idle_ms === undefined &&
      input.await_change !== true &&
      input.exit !== true
    ) {
      return err({
        code: "invalid_input",
        message:
          "give at least one of --text, --regex, --idle-ms, --await-change or --exit",
      });
    }
    let compiledRegex: RegExp | null = null;
    if (input.regex !== undefined) {
      try {
        compiledRegex = new RegExp(input.regex);
      } catch (thrown) {
        return err({
          code: "invalid_input",
          message: `invalid regex: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
        });
      }
    }

    const startedAt = clock.nowMs();
    const timeoutMs = input.timeout_ms ?? TUI_WAIT_DEFAULT_MS;
    const idleMs =
      input.idle_ms ??
      (input.await_change === true ? TUI_IDLE_DEFAULT_MS : undefined);
    const hasPattern = input.text !== undefined || compiledRegex !== null;
    const matchesPattern = (screen: string) =>
      (input.text === undefined || screen.includes(input.text)) &&
      (compiledRegex === null || compiledRegex.test(screen));

    const currentControlling = () => {
      const checked = queue.terminalTab(tab, caller);
      return checked.ok ? checked.value.personControlling : false;
    };

    // 이벤트를 먼저 구독해야 첫 스냅샷과 다음 출력 사이의 변화를 놓치지 않는다.
    const sub = baseline
      ? baseline.subscribe()
      : subscribeTerminal(terminalRef);

    const firstRead = await terminals.tuiSnapshot(terminalRef);
    if (!firstRead.ok) {
      sub.dispose();
      return firstRead;
    }

    let lastHash = baseline?.visualHash ?? firstRead.value.snapshot.visual_hash;
    let changed =
      baseline !== undefined &&
      firstRead.value.snapshot.visual_hash !== baseline.visualHash;
    let latest: { runtime: TerminalRuntime; snapshot: TuiScreenSnapshot } =
      firstRead.value;

    return await new Promise<Result<TuiWaitResult>>((resolve) => {
      let settled = false;
      let checking = false;
      let pendingCheck = false;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

      const clearIdle = () => {
        if (idleTimer !== null) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
      };

      const finish = (
        matched: boolean,
        reason: TuiWaitResult["reason"],
        snap: { runtime: TerminalRuntime; snapshot: TuiScreenSnapshot },
      ) => {
        if (settled) return;
        settled = true;
        clearIdle();
        if (timeoutTimer !== null) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        sub.dispose();
        const raw = assembleSnapshot(
          tab,
          snap.runtime,
          snap.snapshot,
          currentControlling(),
        );
        const safe = redactSnapshot(raw, redact);
        if (!safe.ok) {
          resolve(safe);
          return;
        }
        resolve(
          ok({
            matched,
            reason,
            elapsed_ms: Math.max(0, clock.nowMs() - startedAt),
            snapshot: safe.value,
          }),
        );
      };

      const evaluate = (current: {
        runtime: TerminalRuntime;
        snapshot: TuiScreenSnapshot;
      }) => {
        if (settled) return;
        latest = current;
        const hash = current.snapshot.visual_hash;
        if (hash !== lastHash) {
          lastHash = hash;
          changed = true;
          // 화면이 실제로 바뀔 때만 idle 타이머를 리셋한다(동일 화면 리페인트·OSC 제목 변화는 리셋하지 않는다).
          clearIdle();
        }

        const exited =
          current.runtime.state === "exited" ||
          current.runtime.state === "unknown";
        if (exited) {
          if (input.exit === true) {
            finish(true, "exited", current);
            return;
          }
          if (hasPattern && matchesPattern(current.snapshot.screen)) {
            finish(true, "matched", current);
            return;
          }
          finish(false, "exited", current);
          return;
        }

        if (input.exit === true) {
          return;
        }

        const patternOk =
          !hasPattern || matchesPattern(current.snapshot.screen);
        const changeOk = input.await_change !== true || changed;

        if (idleMs === undefined) {
          if (patternOk && changeOk) {
            finish(true, "matched", current);
          }
          return;
        }

        if (patternOk && changeOk) {
          if (idleTimer === null) {
            idleTimer = setTimeout(() => {
              idleTimer = null;
              void onIdleFired();
            }, idleMs);
          }
        } else {
          clearIdle();
        }
      };

      const onIdleFired = async () => {
        if (settled) return;
        const fresh = await terminals.tuiSnapshot(terminalRef);
        if (settled) return;
        if (!fresh.ok) {
          finish(false, "exited", latest);
          return;
        }
        latest = fresh.value;
        if (fresh.value.snapshot.visual_hash !== lastHash) {
          evaluate(fresh.value);
          return;
        }
        const exited =
          fresh.value.runtime.state === "exited" ||
          fresh.value.runtime.state === "unknown";
        if (exited) {
          evaluate(fresh.value);
          return;
        }
        const patternOk =
          !hasPattern || matchesPattern(fresh.value.snapshot.screen);
        const changeOk = input.await_change !== true || changed;
        if (patternOk && changeOk) {
          finish(true, hasPattern ? "matched" : "idle", fresh.value);
        }
      };

      const runCheck = async () => {
        if (settled) return;
        if (checking) {
          pendingCheck = true;
          return;
        }
        checking = true;
        try {
          do {
            pendingCheck = false;
            const fresh = await terminals.tuiSnapshot(terminalRef);
            if (settled) return;
            if (!fresh.ok) {
              finish(false, "exited", latest);
              return;
            }
            evaluate(fresh.value);
          } while (pendingCheck && !settled);
        } finally {
          checking = false;
        }
      };

      timeoutTimer = setTimeout(() => {
        timeoutTimer = null;
        void (async () => {
          if (settled) return;
          const fresh = await terminals.tuiSnapshot(terminalRef);
          if (settled) return;
          finish(false, "timeout", fresh.ok ? fresh.value : latest);
        })();
      }, timeoutMs);

      sub.onChange(() => {
        void runCheck();
      });
      evaluate(firstRead.value);
    });
  }

  return {
    async read(
      tab: Id<"tab">,
      caller: TabOwner,
    ): Promise<Result<TuiReadOutput>> {
      const found = queue.terminalTab(tab, caller);
      if (!found.ok) return found;
      const read = await terminals.tuiState(found.value.ref);
      if (!read.ok) return read;
      const title = redact(read.value.state.title);
      if (title === null) {
        return err({ code: "unavailable", message: REDACT_FAILED });
      }
      return ok({
        tab,
        generation: read.value.runtime.generation,
        seq: read.value.state.seq,
        state: read.value.runtime.state,
        exit_code: read.value.runtime.exit_code,
        exit_signal: read.value.runtime.exit_signal ?? null,
        columns: read.value.state.columns,
        rows: read.value.state.rows,
        title,
        cursor: read.value.state.cursor,
        modes: read.value.state.modes,
        person_controlling: found.value.personControlling,
      });
    },

    async snapshot(
      tab: Id<"tab">,
      caller: TabOwner,
      options?: { scrollback?: number; ansi?: boolean },
    ): Promise<Result<TuiSnapshot>> {
      const found = queue.terminalTab(tab, caller);
      if (!found.ok) return found;
      const read = await terminals.tuiSnapshot(found.value.ref, options);
      if (!read.ok) return read;
      const raw = assembleSnapshot(
        tab,
        read.value.runtime,
        read.value.snapshot,
        found.value.personControlling,
      );
      return redactSnapshot(raw, redact);
    },

    async act(
      caller: TabOwner,
      input: TerminalActInput,
    ): Promise<Result<TuiActOutput>> {
      const found = queue.terminalTab(input.tab, caller);
      if (!found.ok) return found;
      if (found.value.personControlling) {
        return err({
          code: "conflict",
          message: TERMINAL_PERSON_CONTROLLING_MESSAGE,
        });
      }
      const live = await terminals.tuiState(found.value.ref);
      if (!live.ok) return live;
      const { runtime, state } = live.value;
      if (runtime.state !== "running") {
        return err({ code: "conflict", message: NOT_RUNNING });
      }

      let chunks: string[];
      if (input.type === "type") {
        if (input.text === undefined) {
          return err({
            code: "invalid_input",
            message: "type requires --text",
          });
        }
        const encoded = encodeType(input.text);
        if (!encoded.ok) return encoded;
        chunks = [encoded.value];
      } else if (input.type === "paste") {
        if (input.text === undefined) {
          return err({
            code: "invalid_input",
            message: "paste requires --text",
          });
        }
        const encoded = encodePaste(input.text, state.modes);
        if (!encoded.ok) return encoded;
        chunks = [encoded.value];
      } else if (input.type === "press") {
        if (input.keys === undefined || input.keys.length === 0) {
          return err({
            code: "invalid_input",
            message: "press requires at least one key",
          });
        }
        const encoded = encodePress(input.keys, state.modes);
        if (!encoded.ok) return encoded;
        chunks =
          (input.delay_ms ?? 0) > 0 ? encoded.value : [encoded.value.join("")];
      } else {
        if (
          input.action === undefined ||
          input.col === undefined ||
          input.row === undefined
        ) {
          return err({
            code: "invalid_input",
            message: "mouse requires --action, --col and --row",
          });
        }
        const encoded = encodeMouse(
          {
            action: input.action,
            col: input.col,
            row: input.row,
            ...(input.button === undefined ? {} : { button: input.button }),
            ...(input.modifiers === undefined
              ? {}
              : { modifiers: input.modifiers }),
            ...(input.force === undefined ? {} : { force: input.force }),
          },
          { columns: state.columns, rows: state.rows },
          state.modes,
        );
        if (!encoded.ok) return encoded;
        chunks = [encoded.value];
      }

      const wantsWait =
        input.wait_idle !== undefined || input.wait_text !== undefined;
      // 보내기 직전 베이스라인을 선캡처하고 이벤트를 구독해야 write 직후 온 출력을 놓치지 않는다.
      const preSub = wantsWait ? subscribeTerminal(found.value.ref) : null;

      try {
        for (let i = 0; i < chunks.length; i++) {
          if (i > 0 && (input.delay_ms ?? 0) > 0) {
            await sleep(input.delay_ms!);
            const recheck = queue.terminalTab(input.tab, caller);
            if (!recheck.ok) {
              preSub?.dispose();
              return recheck;
            }
            if (recheck.value.personControlling) {
              preSub?.dispose();
              return err({
                code: "conflict",
                message: TERMINAL_PERSON_CONTROLLING_MESSAGE,
              });
            }
          }
          const written = await terminals.write(found.value.ref, chunks[i]!, {
            generation: runtime.generation,
            human: false,
          });
          if (!written.ok) {
            preSub?.dispose();
            return written;
          }
        }
      } catch (thrown) {
        preSub?.dispose();
        throw thrown;
      }

      if (wantsWait && preSub !== null) {
        const waited = await waitInternal(
          input.tab,
          caller,
          found.value.ref,
          {
            ...(input.wait_idle === undefined
              ? {}
              : { idle_ms: input.wait_idle }),
            ...(input.wait_text === undefined ? {} : { text: input.wait_text }),
            ...(input.timeout_ms === undefined
              ? {}
              : { timeout_ms: input.timeout_ms }),
          },
          {
            visualHash: state.visual_hash,
            subscribe: () => preSub,
          },
        );
        if (!waited.ok) return waited;
        return ok({
          snapshot: waited.value.snapshot,
          wait: {
            matched: waited.value.matched,
            reason: waited.value.reason,
            elapsed_ms: waited.value.elapsed_ms,
          },
        });
      }

      const snap = await terminals.tuiSnapshot(found.value.ref);
      if (!snap.ok) return snap;
      const recheck = queue.terminalTab(input.tab, caller);
      const raw = assembleSnapshot(
        input.tab,
        snap.value.runtime,
        snap.value.snapshot,
        recheck.ok ? recheck.value.personControlling : false,
      );
      const safe = redactSnapshot(raw, redact);
      return safe.ok ? ok({ snapshot: safe.value }) : safe;
    },

    async wait(
      caller: TabOwner,
      input: TerminalWaitInput,
    ): Promise<Result<TuiWaitResult>> {
      const found = queue.terminalTab(input.tab, caller);
      if (!found.ok) return found;
      return await waitInternal(input.tab, caller, found.value.ref, input);
    },

    async resize(
      tab: Id<"tab">,
      caller: TabOwner,
      size: { columns: number; rows: number },
    ): Promise<
      Result<{
        tab: Id<"tab">;
        generation: number;
        columns: number;
        rows: number;
      }>
    > {
      const found = queue.terminalTab(tab, caller);
      if (!found.ok) return found;
      if (found.value.personControlling) {
        return err({
          code: "conflict",
          message: TERMINAL_PERSON_CONTROLLING_MESSAGE,
        });
      }
      const runtime = terminals.runtime(found.value.ref);
      if (runtime === null) {
        return err({ code: "not_found", message: "terminal is not open" });
      }
      if (runtime.state !== "running") {
        return err({ code: "conflict", message: NOT_RUNNING });
      }
      const resized = await terminals.resize(
        found.value.ref,
        runtime.generation,
        size,
        { remote: false },
      );
      if (!resized.ok) return resized;
      return ok({
        tab,
        generation: resized.value.generation,
        columns: resized.value.columns,
        rows: resized.value.rows,
      });
    },
  };
}

export type TerminalUseDriver = ReturnType<typeof createTerminalUseDriver>;
