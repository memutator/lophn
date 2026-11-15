// 폰이 보는 터미널의 화면을 core에 밀어 올리고(`terminal_screen` frame), 폰이 친 글을 그 터미널에 친다.
// 화면은 row diff 없이 매번 전체다. core가 최신 화면 하나만 두므로 느린 쪽은 건너뛰고 replay가 없다.
// 보는 중인지는 core의 `terminal_stream`이 정한다(폰의 lease). 입력 허락은 core가 이미 봤다.
// PTY 크기는 바꾸지 않는다: 폰 하나가 desktop 창의 크기를 흔들면 안 된다.
import type {
  HostRequest,
  HostToolOutput,
} from "../../../protocol/lophn-agent/host-queue.ts";
import type {
  TerminalOutput,
  TerminalRuntime,
  TerminalScreenReply,
} from "../../ipc/terminal.ts";

// 출력이 이어지는 동안 화면을 보내는 간격(초당 4번). 화면 하나가 viewport와 scrollback tail 전체라 더 자주 보내지 않는다.
export const SCREEN_INTERVAL_MS = 250;

type Payload<K extends HostRequest["kind"]> = Extract<
  HostRequest,
  { kind: K }
>["payload"];

type Watch = {
  tail: number;
  /** 간격 timer를 끈다. 돌고 있지 않으면 null이다. */
  cancel: (() => void) | null;
  /** 간격 안에 출력이 더 왔다. 간격이 끝나면 한 번 더 보낸다. */
  dirty: boolean;
};

const OK: HostToolOutput = { content: [{ type: "text", text: "ok" }] };
const notFound = (message: string): HostToolOutput => ({
  error: { code: "not_found", message },
});

export type TerminalView = ReturnType<typeof createTerminalView>;

export function createTerminalView(deps: {
  screen(
    terminalRef: string,
    tail: number,
  ): Promise<TerminalScreenReply["screen"] | null>;
  /** `terminal_screen` frame을 보낸다. 연결이 받지 않으면 false다. */
  send(
    frame: {
      type: "terminal_screen";
      terminal_ref: string;
    } & TerminalScreenReply["screen"],
  ): boolean;
  connected(): boolean;
  runtime(terminalRef: string): TerminalRuntime | undefined;
  type(terminalRef: string, generation: number, text: string): Promise<void>;
  humanInput(terminalRef: string, text: string): void;
  /** run을 ms 뒤 부르고 취소 함수를 돌려준다. */
  schedule(run: () => void, ms: number): () => void;
}) {
  const watching = new Map<string, Watch>();

  async function push(ref: string, watch: Watch): Promise<void> {
    // 연결이 없으면 보내지도 쌓지도 않는다. 다시 붙으면 core가 `terminal_stream`으로 다시 켠다.
    if (!deps.connected()) return;
    const screen = await deps.screen(ref, watch.tail);
    // 읽는 사이 꺼졌으면 보내지 않는다.
    if (screen === null || watching.get(ref) !== watch) return;
    deps.send({ type: "terminal_screen", terminal_ref: ref, ...screen });
  }

  // 앞 출력은 바로 보내고, 간격 안에 온 출력은 간격 끝에 한 번으로 묶는다. 마지막 출력 뒤 한 번은 꼭 보낸다.
  function arm(ref: string, watch: Watch): void {
    watch.cancel = deps.schedule(() => {
      watch.cancel = null;
      if (!watch.dirty) return;
      watch.dirty = false;
      void push(ref, watch);
      arm(ref, watch);
    }, SCREEN_INTERVAL_MS);
  }

  function changed(ref: string): void {
    const watch = watching.get(ref);
    if (watch === undefined || !deps.connected()) return;
    if (watch.cancel !== null) {
      watch.dirty = true;
      return;
    }
    void push(ref, watch);
    arm(ref, watch);
  }

  function stop(ref: string): void {
    watching.get(ref)?.cancel?.();
    watching.delete(ref);
  }

  function reset(): void {
    for (const ref of [...watching.keys()]) stop(ref);
  }

  return {
    stream(payload: Payload<"terminal_stream">): HostToolOutput {
      const ref = payload.terminal_ref;
      if (!payload.on) {
        stop(ref);
        return OK;
      }
      if (deps.runtime(ref) === undefined) return notFound("no such terminal");
      const watch = watching.get(ref);
      if (watch === undefined) {
        const fresh: Watch = { tail: payload.tail, cancel: null, dirty: false };
        watching.set(ref, fresh);
        void push(ref, fresh);
      } else {
        // 다른 폰이 더 긴 tail로 켰다. 지금 화면을 그 tail로 다시 보낸다.
        watch.tail = payload.tail;
        void push(ref, watch);
      }
      return OK;
    },
    async input(payload: Payload<"terminal_input">): Promise<HostToolOutput> {
      const runtime = deps.runtime(payload.terminal_ref);
      if (runtime === undefined || runtime.state !== "running") {
        return notFound("no running terminal");
      }
      try {
        await deps.type(payload.terminal_ref, runtime.generation, payload.text);
      } catch (cause) {
        return { error: { code: "unavailable", message: String(cause) } };
      }
      // 사람이 desktop에서 친 것과 같다(끊기 key면 coding agent 상태를 모르게 둔다).
      deps.humanInput(payload.terminal_ref, payload.text);
      return OK;
    },
    output(chunks: readonly TerminalOutput[]): void {
      for (const ref of new Set(chunks.map((chunk) => chunk.terminal_ref))) {
        changed(ref);
      }
    },
    runtime(runtime: TerminalRuntime): void {
      if (runtime.state === "exited" || runtime.state === "unknown") {
        stop(runtime.terminal_ref);
      }
    },
    /**
     * 모두 멈춘다. 연결이 (다시) 열릴 때도 부른다: core가 살아 있는 lease마다 `terminal_stream`을 다시 보내 그때
     * 지금 화면을 보낸다. core가 다시 떠 lease가 없으면 아무도 보지 않으므로 보내지 않는다.
     */
    reset,
  };
}
