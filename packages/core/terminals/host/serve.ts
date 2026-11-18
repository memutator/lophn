// PTY host의 줄 loop. 요청 줄을 읽어 host에 넘기고 답·출력·runtime·foreground를 한 줄씩 쓴다. 입력이 끝나면(core가 사라졌거나
// stdin을 닫았다) 모든 PTY를 정리하고 끝난다. process의 stdin·stdout·신호는 cli.ts가 꽂는다.
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

import type { TerminalOutput } from "../../../protocol/coding-agent/terminals.ts";
import { type HostDeps, hostFromNodePty } from "./main.ts";
import type { PtyAdapter } from "./pty.ts";
import type { HostLine, HostRequest } from "./wire.ts";

// 어느 harness TUI가 도는지는 foreground process가 바뀔 때만 알린다. 새 process가 뜨는 것을 받는 event가 없어 훑는다.
// GUI ↔ TUI toggle이 TUI가 끝난 것을 이 훑기로 알아 간격만큼 기다린다. 한 번에 /proc 두 줄이라 짧게 훑는다.
const FOREGROUND_POLL_MS = 250;

// 작은 PTY write마다 pipe를 깨우지 않고, 큰 출력을 한 JSON 줄에 무제한 쌓지도 않는다.
function batchOutput(send: (output: readonly TerminalOutput[]) => void) {
  let output: TerminalOutput[] = [];
  let chars = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function flush(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (output.length === 0) return;
    send(output);
    output = [];
    chars = 0;
  }
  return {
    flush,
    write(chunk: TerminalOutput) {
      if (chars + chunk.chunk.length > 64 * 1024) flush();
      output.push(chunk);
      chars += chunk.chunk.length;
      timer ??= setTimeout(flush, 16);
    },
  };
}

export function serveHost(options: {
  deps: Omit<HostDeps, "onRuntime" | "onOutput" | "pty"> & { pty?: PtyAdapter };
  input: Readable;
  write(line: HostLine): void;
  // PTY를 다 정리한 뒤 부른다. process를 끝내는 것은 부르는 쪽이다.
  exit(code: number): void;
}): { exit(reason: string, code: number): void } {
  const send = (line: HostLine) => options.write(line);
  const output = batchOutput((chunks) => send({ output: [...chunks] }));
  const host = hostFromNodePty({
    ...options.deps,
    // 끝난 process의 runtime을 요청의 답이 아니라 id 없는 줄로 먼저 알린다.
    onRuntime(runtime) {
      output.flush();
      send({ runtime });
    },
    onOutput: (chunk) => output.write(chunk),
  });

  const poll = setInterval(() => {
    for (const foreground of host.foregroundChanges()) send({ foreground });
  }, FOREGROUND_POLL_MS);
  poll.unref();

  // 끝내는 길은 하나다. PTY 자식을 SIGHUP, SIGKILL까지 정리한 뒤 끝난다.
  let exiting = false;
  function exit(reason: string, code: number): void {
    if (exiting) return;
    exiting = true;
    clearInterval(poll);
    console.error(`terminal host exiting: ${reason}`);
    host.shutdown().then(
      () => options.exit(code),
      () => options.exit(1),
    );
  }

  const lines = createInterface({ input: options.input });
  // core가 사라지거나 stdin을 닫으면 EOF가 된다. 살아 있는 PTY가 event loop를 붙잡아 고아가 되지 않게 끝낸다.
  lines.on("close", () => exit("stdin closed", 0));
  lines.on("line", async (line) => {
    const text = line.trim();
    if (text.length === 0) return;
    let request: HostRequest & { id?: string };
    try {
      request = JSON.parse(text) as HostRequest & { id?: string };
    } catch {
      return;
    }
    // close·restart는 child 종료 확인을 기다린다. 다른 요청은 그 사이에도 답한다.
    const reply = await host.handle(request);
    // runtime을 함께 보내야 supervisor가 host가 사라졌을 때 unknown을 표시할 자료를 가진다.
    const runtime = reply.ok ? reply.runtime : undefined;
    send({ id: request.id, reply, runtime });
  });
  return { exit };
}
