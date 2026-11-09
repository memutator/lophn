import type {
  TerminalApi,
  TerminalOutput,
  TerminalRuntime,
  TerminalTraceEvent,
} from "../../ipc/terminal.ts";
import { acceptOutput, phaseOfRuntime, splitInput } from "./model.ts";
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
  loading: boolean;
  pending: TerminalOutput[];
  restore: boolean;
  off: (() => void)[];
  active: boolean;
};
type OutputBridge = Pick<
  TerminalApi,
  "snapshot" | "onOutput" | "onRuntime" | "respond" | "input" | "trace"
>;

/** 개수로 묶어 남기는 잦은 일(mouse 이동, wheel, PTY로 보낸 입력). 다른 일이 오면 그 앞에 내보내 순서를 지킨다. */
const COUNTED = new Set(["sent", "wheel"]);
const TRACE_FLUSH_MS = 500;
// main이 꺼져 있다고 답하면 이만큼 모으지 않다가 다시 묻는다. 설정에서 trace를 켜면 이 안에 이어진다.
const TRACE_RECHECK_MS = 5000;

/** React의 tab mount와 terminal의 수명을 분리해 화면을 옮길 때도 이미 파싱한 출력을 유지한다. */
export class TerminalDisplays {
  readonly #kept = new Map<string, Kept>();
  readonly #store: TerminalStore;
  readonly #bridge: OutputBridge | null;
  readonly #now: () => number;
  // 진단 기록. main이 꺼져 있다고 답한 때(ms). 그 뒤 잠깐 모으지 않는다.
  #traceOffAt = Number.NEGATIVE_INFINITY;
  #traced: TerminalTraceEvent[] = [];
  readonly #counted = new Map<string, TerminalTraceEvent>();
  #flushing: ReturnType<typeof setTimeout> | null = null;

  constructor(
    store: TerminalStore,
    bridge: OutputBridge | null,
    now: () => number = Date.now,
  ) {
    this.#store = store;
    this.#bridge = bridge;
    this.#now = now;
    store.subscribe(() => {
      for (const [key, kept] of this.#kept) {
        if (store.get(key)) this.#sync(key, kept);
        else this.release(key);
      }
    });
    bridge?.onOutput((chunks) => {
      for (const kept of this.#kept.values()) {
        const output = chunks.filter(
          (chunk) =>
            chunk.terminal_ref === kept.ref &&
            (kept.loading || chunk.generation === kept.generation),
        );
        if (kept.loading) kept.pending.push(...output);
        else this.#write(kept, output, false);
      }
    });
    bridge?.onRuntime((runtime) => {
      for (const [key, kept] of this.#kept) {
        if (runtime.terminal_ref !== kept.ref) continue;
        this.#runtime(key, runtime);
      }
    });
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
      this.#trace(key, display, { e: "acquire", restore: display.restore });
      // 숨거나 focus가 없는 terminal도 새 질의에 답해야 harness가 멎지 않는다.
      let replies = Promise.resolve<unknown>(undefined);
      display.off.push(
        display.view.onData((text) => {
          if (!display.ref) return;
          const current = this.#store.get(key);
          if (current?.phase.kind !== "live") return;
          const ref = {
            terminal_ref: display.ref,
            generation: display.generation,
          };
          const human = display.active;
          for (const part of splitInput(text))
            replies = replies
              .then(() =>
                human
                  ? this.#bridge?.input({ ...ref, text: part })
                  : this.#bridge?.respond({ ...ref, text: part }),
              )
              .then((reply) => {
                // main이 거절한 입력(focus 표에 없음, 구독 안 함)은 PTY에 닿지 않는다.
                const refused = !reply?.ok
                  ? (reply?.error.code ?? "no bridge")
                  : reply.value.ok
                    ? null
                    : reply.value.reason;
                if (refused !== null)
                  this.#trace(key, display, {
                    e: "input_refused",
                    human,
                    reason: refused,
                  });
              });
        }),
      );
      display.off.push(
        display.view.onTitle((title) => {
          if (display.ref) this.#store.noteTitle(display.ref, title);
        }),
      );
      this.#sync(key, kept);
    }
    return kept;
  }

  #sync(key: string, kept: Kept): void {
    const current = this.#store.get(key);
    if (!this.#bridge || !current?.terminalRef) return;
    if (
      kept.ref === current.terminalRef &&
      kept.generation === current.generation
    )
      return;
    const replay = kept.restore;
    kept.restore = false;
    if (kept.ref && kept.ref !== current.terminalRef) this.#unwatch(kept.ref);
    if (kept.ref !== null) kept.view.reset();
    kept.ref = current.terminalRef;
    kept.generation = current.generation;
    kept.lastSeq = 0;
    kept.pending = [];
    kept.loading = true;
    const ref = kept.ref;
    const generation = kept.generation;
    void this.#bridge
      .snapshot({ terminal_ref: ref, after_seq: 0, watch: true })
      .then((reply) => {
        if (
          this.#kept.get(key) !== kept ||
          kept.ref !== ref ||
          kept.generation !== generation
        )
          return;
        if (!reply.ok || !reply.value.ok) {
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

  #unwatch(ref: string): void {
    void this.#bridge?.snapshot({
      terminal_ref: ref,
      after_seq: Number.MAX_SAFE_INTEGER,
      watch: false,
    });
  }

  release(key: string): void {
    const kept = this.#kept.get(key);
    if (!kept) return;
    this.#trace(key, kept, { e: "release" });
    this.#kept.delete(key);
    if (kept.ref) this.#unwatch(kept.ref);
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
