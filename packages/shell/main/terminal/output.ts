import {
  TERMINAL_OUTPUT_CHANNEL,
  TERMINAL_STATE_CHANNEL,
  type TerminalOutput,
  type TerminalRuntime,
} from "../../ipc/terminal.ts";

/** 출력을 읽은 shell 창에만 이어 보낸다. 숨은 terminal도 구독은 유지하고, 창·탭을 떠나면 놓는다. */
export class TerminalOutputs {
  readonly #readers = new Map<string, Set<number>>();
  readonly #send: (contentsId: number, channel: string, value: unknown) => void;

  constructor(
    send: (contentsId: number, channel: string, value: unknown) => void,
  ) {
    this.#send = send;
  }

  watch(contentsId: number, terminalRef: string, enabled: boolean): void {
    if (enabled) {
      let readers = this.#readers.get(terminalRef);
      if (!readers) this.#readers.set(terminalRef, (readers = new Set()));
      readers.add(contentsId);
    } else {
      const readers = this.#readers.get(terminalRef);
      readers?.delete(contentsId);
      if (readers?.size === 0) this.#readers.delete(terminalRef);
    }
  }

  output(chunks: readonly TerminalOutput[]): void {
    const deliveries = new Map<number, TerminalOutput[]>();
    for (const chunk of chunks) {
      for (const reader of this.#readers.get(chunk.terminal_ref) ?? []) {
        let batch = deliveries.get(reader);
        if (!batch) deliveries.set(reader, (batch = []));
        batch.push(chunk);
      }
    }
    for (const [reader, batch] of deliveries) {
      this.#send(reader, TERMINAL_OUTPUT_CHANNEL, batch);
    }
  }

  runtime(runtime: TerminalRuntime): void {
    for (const reader of this.#readers.get(runtime.terminal_ref) ?? []) {
      this.#send(reader, TERMINAL_STATE_CHANNEL, runtime);
    }
  }

  watching(contentsId: number, terminalRef: string): boolean {
    return this.#readers.get(terminalRef)?.has(contentsId) ?? false;
  }

  forget(contentsId: number): void {
    for (const ref of this.#readers.keys()) this.watch(contentsId, ref, false);
  }
}
