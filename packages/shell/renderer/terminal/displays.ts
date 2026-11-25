import type {
  TerminalOutput,
  TerminalRuntime,
} from "../../../protocol/coding-agent/terminals.ts";
import type { TerminalApi, TerminalTraceEvent } from "../../ipc/terminal.ts";
import type { TerminalCore } from "./core.ts";
import {
  acceptOutput,
  INPUT_LIMIT,
  phaseOfRuntime,
  splitInput,
} from "./model.ts";
import { diffText } from "./screen-copy.ts";
import type { TerminalStore } from "./store.ts";
import type { TerminalView } from "./xterm-view.ts";

export interface TerminalDisplay {
  readonly host: HTMLElement;
  readonly edge: HTMLCanvasElement;
  readonly view: TerminalView;
}

type Kept = TerminalDisplay & {
  project: string;
  ref: string | null;
  generation: number;
  lastSeq: number;
  /** 위로 scroll해 읽는 동안 미뤄 둔 다른 기계 화면 사본의 최신 seq. 맨 아래로 돌아오면 한 번 맞춘다. */
  deferredSeq: number;
  loading: boolean;
  pending: TerminalOutput[];
  restore: boolean;
  off: (() => void)[];
  active: boolean;
};
type TypedInput = {
  /** 같은 `onData` 호출(붙여넣기 하나)의 조각은 같은 번호다. */
  call: number;
  ref: { terminal: string; generation: number };
  human: boolean;
  text: string;
};
type OutputCore = Pick<TerminalCore, "snapshot" | "watch" | "subscribe">;
type InputBridge = Pick<TerminalApi, "respond" | "input" | "trace" | "shown">;

/** 개수로 묶어 남기는 잦은 일(mouse 이동, wheel, PTY로 보낸 입력). 다른 일이 오면 그 앞에 내보내 순서를 지킨다. */
const COUNTED = new Set(["sent", "wheel"]);
const TRACE_FLUSH_MS = 500;
// main이 꺼져 있다고 답하면 이만큼 모으지 않다가 다시 묻는다. 설정에서 trace를 켜면 이 안에 이어진다.
const TRACE_RECHECK_MS = 5000;
// core는 30초 안에 갱신이 없는 출력 lease를 거둔다. 보이는 터미널은 이 간격으로 다시 잡는다.
const LEASE_RENEW_MS = 10_000;

/**
 * React의 tab mount와 terminal의 수명을 분리해 화면을 옮길 때도 이미 파싱한 출력을 유지한다. 출력은 core의 lease를 잡은
 * 동안만 event로 온다: 잡고(`watch`) → snapshot을 읽고 → 그 seq보다 큰 event만 쓴다. seq가 건너뛰거나 연결이 다시 붙으면 마지막
 * seq로 snapshot을 다시 읽어 지금 화면으로 맞춘다. 다른 기계의 터미널은 날 출력 없이 화면이 바뀔 때마다 그 길로 맞춘다.
 */
export class TerminalDisplays {
  readonly #kept = new Map<string, Kept>();
  readonly #store: TerminalStore;
  readonly #core: OutputCore | null;
  readonly #bridge: InputBridge | null;
  readonly #now: () => number;
  // 진단 기록. main이 꺼져 있다고 답한 때(ms). 그 뒤 잠깐 모으지 않는다.
  #traceOffAt = Number.NEGATIVE_INFINITY;
  #traced: TerminalTraceEvent[] = [];
  readonly #counted = new Map<string, TerminalTraceEvent>();
  #flushing: ReturnType<typeof setTimeout> | null = null;

  constructor(
    store: TerminalStore,
    core: OutputCore | null,
    bridge: InputBridge | null,
    options: {
      now?: () => number;
      /** 주기 일. 해지는 없다(창과 같이 산다). */
      every?: (ms: number, run: () => void) => void;
    } = {},
  ) {
    this.#store = store;
    this.#core = core;
    this.#bridge = bridge;
    this.#now = options.now ?? Date.now;
    store.subscribe(() => {
      for (const [key, kept] of this.#kept) {
        if (store.get(key)) this.#sync(key, kept);
        else this.release(key);
      }
    });
    core?.subscribe((message) => {
      if (message.kind === "ready") {
        // Gateway가 다시 열렸다. lease가 core와 함께 사라졌을 수 있고 그 사이 출력을 놓쳤을 수 있다.
        for (const [key, kept] of this.#kept) {
          if (kept.ref === null || kept.loading) continue;
          void core.watch(kept.ref, true);
          this.#catchUp(key, kept);
        }
        return;
      }
      if (message.kind !== "event") return;
      const event = message.event;
      if (event.type === "TerminalOutputAppended") {
        this.#output(event.payload);
      } else if (event.type === "TerminalRuntimeChanged") {
        const runtime = event.payload.runtime;
        for (const [key, kept] of this.#kept) {
          if (runtime.terminal_ref === kept.ref) this.#runtime(key, runtime);
        }
      } else if (event.type === "TerminalScreenChanged") {
        // 다른 기계의 터미널은 화면 사본으로 온다(`screen-copy.ts`). 새 사본이면 지금 화면으로 다시 쓴다.
        // 사람이 위로 올려 읽는 동안은 사본을 다시 쓰지 않고 seq만 기억해 두었다가 맨 아래로 돌아오면 한 번 맞춘다.
        // 바로 앞 화면에서 바뀐 줄(diff)이 왔고 이 view가 그 화면을 쓴 상태면 그 줄만 덮어써 snapshot을 부르지 않는다.
        const { terminal, seq, diff } = event.payload;
        for (const [key, kept] of this.#kept) {
          if (terminal !== kept.ref || seq <= kept.lastSeq) continue;
          if (
            diff !== undefined &&
            !kept.loading &&
            kept.view.atBottom?.() !== false &&
            diff.generation === kept.generation &&
            diff.base_seq === kept.lastSeq
          ) {
            this.#write(
              kept,
              [
                {
                  terminal_ref: terminal,
                  generation: diff.generation,
                  seq,
                  chunk: diffText(diff),
                  dropped_output: false,
                },
              ],
              true,
            );
            continue;
          }
          if (kept.view.atBottom?.() === false) {
            kept.deferredSeq = Math.max(kept.deferredSeq, seq);
            continue;
          }
          if (kept.loading) {
            kept.deferredSeq = Math.max(kept.deferredSeq, seq);
            continue;
          }
          this.#catchUp(key, kept, { pauseWhenScrolled: true });
        }
      }
    });
    if (core !== null) {
      (options.every ?? ((ms, run) => void setInterval(run, ms)))(
        LEASE_RENEW_MS,
        () => {
          for (const [key, kept] of this.#kept) {
            if (kept.ref === null) continue;
            const ref = kept.ref;
            void core.watch(ref, true).then((reply) => {
              if (!reply.ok && reply.code === "not_found" && kept.ref === ref) {
                this.#gone(key);
              }
            });
          }
        },
      );
    }
  }

  #output(chunk: TerminalOutput): void {
    for (const [key, kept] of this.#kept) {
      if (chunk.terminal_ref !== kept.ref) continue;
      if (kept.loading) {
        kept.pending.push(chunk);
        continue;
      }
      if (chunk.generation !== kept.generation) continue;
      // 하나라도 놓쳤다(느려 끊겼거나 lease가 잠깐 없었다). 지금 화면으로 맞춘다.
      if (chunk.seq > kept.lastSeq + 1) {
        this.#catchUp(key, kept);
        continue;
      }
      this.#write(kept, [chunk], false);
    }
  }

  acquire(
    key: string,
    project: string,
    create: () => TerminalDisplay,
  ): TerminalDisplay {
    let kept = this.#kept.get(key);
    if (!kept) {
      kept = {
        ...create(),
        project,
        ref: null,
        generation: 0,
        lastSeq: 0,
        deferredSeq: 0,
        loading: false,
        pending: [],
        restore: this.#store.get(key)?.terminalRef != null,
        off: [],
        active: false,
      };
      this.#kept.set(key, kept);
      const display = kept;
      display.off.push(
        display.view.onTrace((event) => this.#trace(key, display, event)),
      );
      if (display.view.onScroll !== undefined) {
        display.off.push(
          display.view.onScroll((atBottom) => {
            if (
              atBottom &&
              !display.loading &&
              display.ref !== null &&
              display.deferredSeq > display.lastSeq
            ) {
              this.#catchUp(key, display, { pauseWhenScrolled: true });
            }
          }),
        );
      }
      this.#trace(key, display, { e: "acquire", restore: display.restore });
      // 숨거나 focus가 없는 terminal도 새 질의에 답해야 harness가 멎지 않는다.
      // 입력은 하나씩 보내고 reply를 기다린다(순서). 그 사이 친 글은 모아 한 번에 보낸다: 다른 기계의 터미널은 부를 때마다 기계 사이
      // 왕복이라 글자마다 기다리면 빨리 칠수록 밀린다.
      const queue: TypedInput[] = [];
      let sending = false;
      let calls = 0;
      const drain = async () => {
        if (sending) return;
        sending = true;
        try {
          while (queue.length > 0) {
            const head = queue.shift()!;
            let text = head.text;
            let last = head.call;
            for (
              let next = queue[0];
              next !== undefined &&
              next.human === head.human &&
              next.ref.terminal === head.ref.terminal &&
              next.ref.generation === head.ref.generation &&
              text.length + next.text.length <= INPUT_LIMIT;
              next = queue[0]
            ) {
              text += next.text;
              last = next.call;
              queue.shift();
            }
            const sent = { ...head.ref, text };
            const reply = await (head.human
              ? this.#bridge?.input(sent)
              : this.#bridge?.respond(sent)
            )?.catch(() => undefined);
            // main이나 core가 거절한 입력(focus 표에 없음, 지난 generation)은 PTY에 닿지 않는다.
            const refused = reply?.ok
              ? null
              : (reply?.error.code ?? "no bridge");
            if (refused === null) continue;
            // 조각 하나가 거절되면 그 paste의 나머지는 보내지 않는다. 닫는 ESC[201~ 없이 끝나거나 중간이 빠진 채 PTY에 들어가지 않게 한다.
            for (let at = queue.length - 1; at >= 0; at -= 1) {
              if (queue[at]!.call <= last) queue.splice(at, 1);
            }
            this.#trace(key, display, {
              e: "input_refused",
              human: head.human,
              reason: refused,
            });
          }
        } finally {
          sending = false;
        }
      };
      display.off.push(
        display.view.onData((text) => {
          if (!display.ref) return;
          const current = this.#store.get(key);
          if (current?.phase.kind !== "live") return;
          const ref = {
            terminal: display.ref,
            generation: display.generation,
          };
          const human = display.active;
          const call = (calls += 1);
          for (const part of splitInput(text))
            queue.push({ call, ref, human, text: part });
          void drain();
        }),
      );
      this.#sync(key, kept);
    }
    return kept;
  }

  #sync(key: string, kept: Kept): void {
    const current = this.#store.get(key);
    const core = this.#core;
    if (!core || !current?.terminalRef) return;
    if (
      kept.ref === current.terminalRef &&
      kept.generation === current.generation
    )
      return;
    // 이 탭이 막 연 터미널이 아니면(다시 붙음, 옮겨 옴, 폰이나 agent가 연 것) snapshot은 지난 출력이라 질의에 다시 답하지 않는다.
    const replay = kept.restore || current.phase.kind === "opening";
    kept.restore = false;
    if (kept.ref && kept.ref !== current.terminalRef) {
      if (!this.#stillWatching(kept.ref, key)) void core.watch(kept.ref, false);
      void this.#bridge?.shown({ terminal: kept.ref, shown: false });
    }
    if (kept.ref !== null) kept.view.reset();
    // main은 이 창이 보이는 터미널의 질의 응답만 core에 넘긴다.
    if (kept.ref !== current.terminalRef) {
      void this.#bridge?.shown({ terminal: current.terminalRef, shown: true });
    }
    kept.ref = current.terminalRef;
    kept.generation = current.generation;
    kept.lastSeq = 0;
    kept.deferredSeq = 0;
    kept.pending = [];
    kept.loading = true;
    const ref = kept.ref;
    const generation = kept.generation;
    // lease를 먼저 잡아야 snapshot 뒤의 출력이 event로 온다. 그 사이 온 event는 pending에 모았다가 seq로 겹침을 뺀다.
    void core
      .watch(ref, true)
      .then(() => core.snapshot(ref, 0))
      .then((reply) => {
        if (
          this.#kept.get(key) !== kept ||
          kept.ref !== ref ||
          kept.generation !== generation
        )
          return;
        if (!reply.ok) {
          kept.loading = false;
          kept.pending = [];
          this.#store.update(key, {
            phase: { kind: "ended", ending: "unknown", runtime: null },
          });
          return;
        }
        const { runtime, output } = reply.value;
        kept.generation = runtime.generation;
        this.#trace(key, kept, {
          e: "snapshot",
          replay,
          chunks: output.length,
          pty_cols: runtime.columns,
          pty_rows: runtime.rows,
        });
        // snapshot은 PTY 치수로 직렬화돼 있다. 새 view(80x24)나 다른 칸 크기로 쓰면 줄이 꺾여 화면이 엉키고, 그 뒤 칸에
        // 맞춰도 PTY 치수가 그대로면 TUI는 SIGWINCH를 못 받아 다시 그리지 않는다. PTY 치수로 쓰고, 칸에 다시 맞추는 일은
        // 탭에 알린다(`restored`). 여기서 맞추면 막 붙은 칸이 아직 배치 전이라 13x5 같은 치수로 PTY까지 줄였다.
        kept.view.resize(runtime.columns, runtime.rows);
        this.#write(kept, output, replay && runtime.generation === generation);
        kept.loading = false;
        this.#write(kept, kept.pending, false);
        kept.pending = [];
        this.#runtime(key, runtime);
        this.#store.update(key, {
          restored: (this.#store.get(key)?.restored ?? 0) + 1,
        });
        // 초기 snapshot을 읽는 사이 화면 사본이 더 앞서갔으면 바로 맞춰 다음 diff의 base_seq가 어긋나지 않게 한다.
        if (
          kept.deferredSeq > kept.lastSeq &&
          kept.view.atBottom?.() !== false
        ) {
          this.#catchUp(key, kept, { pauseWhenScrolled: true });
        }
      });
  }

  // 놓친 출력이 있다. 마지막 seq 뒤에 출력이 있으면 core가 지금 화면 하나를 주므로, view를 비우고 그 화면을 쓴다.
  #catchUp(
    key: string,
    kept: Kept,
    options: { pauseWhenScrolled?: boolean } = {},
  ): void {
    const core = this.#core;
    const ref = kept.ref;
    if (!core || ref === null) return;
    const generation = kept.generation;
    kept.loading = true;
    kept.deferredSeq = 0;
    kept.pending = [];
    void core.snapshot(ref, kept.lastSeq).then((reply) => {
      if (
        this.#kept.get(key) !== kept ||
        kept.ref !== ref ||
        kept.generation !== generation
      )
        return;
      kept.loading = false;
      if (!reply.ok && reply.code === "not_found") this.#gone(key);
      if (reply.ok && reply.value.runtime.generation === generation) {
        const screen = reply.value.output;
        if (screen.length > 0) {
          if (
            options.pauseWhenScrolled === true &&
            kept.view.atBottom?.() === false
          ) {
            kept.deferredSeq = Math.max(
              kept.deferredSeq,
              screen[screen.length - 1]!.seq,
            );
          } else {
            kept.view.reset();
            kept.view.resize(
              reply.value.runtime.columns,
              reply.value.runtime.rows,
            );
            this.#write(kept, screen, true);
          }
        }
        this.#trace(key, kept, { e: "catch_up", chunks: screen.length });
      }
      this.#write(kept, kept.pending, false);
      kept.pending = [];
      if (reply.ok) this.#runtime(key, reply.value.runtime);
      if (kept.deferredSeq > kept.lastSeq && kept.view.atBottom?.() !== false) {
        this.#catchUp(key, kept, { pauseWhenScrolled: true });
      }
    });
  }

  #stillWatching(ref: string, excludeKey?: string): boolean {
    for (const [otherKey, other] of this.#kept) {
      if (otherKey !== excludeKey && other.ref === ref) return true;
    }
    return false;
  }

  // 그 core에 이 터미널이 없다(그 기계의 core가 다시 떠 PTY가 사라졌다). 마지막 화면은 두고 끝난 터미널로 보인다: 다시 시작을 누르면
  // 탭이 같은 폴더에 새 터미널을 연다.
  #gone(key: string): void {
    const phase = this.#store.get(key)?.phase;
    if (phase?.kind !== "live") return;
    this.#store.update(key, {
      phase: { kind: "ended", ending: "exited", runtime: phase.runtime },
    });
  }

  #write(kept: Kept, output: readonly TerminalOutput[], replay: boolean): void {
    const step = acceptOutput(kept.lastSeq, kept.generation, output);
    for (const text of step.writes) {
      if (replay) kept.view.replay(text);
      else kept.view.write(text);
    }
    kept.lastSeq = step.lastSeq;
  }

  #runtime(key: string, runtime: TerminalRuntime): void {
    const current = this.#store.get(key);
    if (!current || current.generation > runtime.generation) return;
    // 폰이 잡은 크기면 view를 PTY 치수로 두고, 놓으면 탭이 칸에 다시 맞춘다(`remote`).
    const remote = runtime.remote_size === true;
    if (remote) this.#kept.get(key)?.view.resize(runtime.columns, runtime.rows);
    if ((current.remote ?? false) !== remote) {
      this.#store.update(key, { remote });
    }
    const phase = phaseOfRuntime(runtime);
    const previous = current.phase;
    const before =
      previous.kind === "live" || previous.kind === "ended"
        ? previous.runtime
        : null;
    if (
      current.generation === runtime.generation &&
      previous.kind === "ended" &&
      phase.kind === "live"
    )
      return;
    if (
      !(
        current.generation === runtime.generation &&
        previous.kind === phase.kind &&
        before?.state === runtime.state &&
        before.exit_code === runtime.exit_code
      )
    ) {
      this.#store.update(key, { generation: runtime.generation, phase });
    }
    this.#store.noteRuntime(runtime);
  }

  setActive(key: string, active: boolean): void {
    const kept = this.#kept.get(key);
    if (!kept || kept.active === active) return;
    kept.active = active;
    this.#trace(key, kept, { e: "active", on: active });
  }

  #trace(key: string, kept: Kept, event: TerminalTraceEvent): void {
    const now = this.#now();
    if (now - this.#traceOffAt < TRACE_RECHECK_MS || !this.#bridge) return;
    const where = { t: now, tab: key, ref: kept.ref };
    if (COUNTED.has(String(event.e))) {
      const id = `${key}\u0000${event.e}\u0000${event.kind ?? event.tui_mouse}`;
      const seen = this.#counted.get(id);
      if (seen) seen.n = Number(seen.n) + 1;
      else this.#counted.set(id, { ...where, ...event, n: 1 });
    } else {
      this.#traced.push(...this.#counted.values(), { ...where, ...event });
      this.#counted.clear();
    }
    this.#flushing ??= setTimeout(() => this.#flush(), TRACE_FLUSH_MS);
  }

  #flush(): void {
    this.#flushing = null;
    const events = [...this.#traced, ...this.#counted.values()];
    this.#traced = [];
    this.#counted.clear();
    if (events.length === 0 || !this.#bridge) return;
    for (let at = 0; at < events.length; at += 500) {
      void this.#bridge
        .trace({ events: events.slice(at, at + 500) })
        .then((reply) => {
          if (reply.ok && reply.value === false) {
            this.#traceOffAt = this.#now();
          }
        });
    }
  }

  release(key: string): void {
    const kept = this.#kept.get(key);
    if (!kept) return;
    this.#trace(key, kept, { e: "release" });
    this.#kept.delete(key);
    if (kept.ref) {
      if (!this.#stillWatching(kept.ref))
        void this.#core?.watch(kept.ref, false);
      void this.#bridge?.shown({ terminal: kept.ref, shown: false });
    }
    for (const off of kept.off) off();
    kept.view.dispose();
    kept.host.remove();
    kept.edge.remove();
  }

  retain(project: string, keys: ReadonlySet<string>): void {
    for (const [key, kept] of this.#kept) {
      if (kept.project === project && !keys.has(key)) this.release(key);
    }
  }
}
