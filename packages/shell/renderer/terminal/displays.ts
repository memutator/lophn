import type {
  TerminalApi,
  TerminalOutput,
  TerminalRuntime,
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
  "snapshot" | "onOutput" | "onRuntime" | "respond" | "input"
>;

/** React의 tab mount와 terminal의 수명을 분리해 화면을 옮길 때도 이미 파싱한 출력을 유지한다. */
export class TerminalDisplays {
  readonly #kept = new Map<string, Kept>();
  readonly #store: TerminalStore;
  readonly #bridge: OutputBridge | null;

  constructor(store: TerminalStore, bridge: OutputBridge | null) {
    this.#store = store;
    this.#bridge = bridge;
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
            replies = replies.then(() =>
              human
                ? this.#bridge?.input({ ...ref, text: part })
                : this.#bridge?.respond({ ...ref, text: part }),
            );
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
        this.#write(kept, output, replay && runtime.generation === generation);
        kept.loading = false;
        this.#write(kept, kept.pending, false);
        kept.pending = [];
        this.#runtime(key, runtime);
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
    if (kept) kept.active = active;
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
