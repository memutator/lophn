// 묶인 host의 시작점. 테스트가 main.ts를 import해도 stdin을 잡지 않는다.
// 줄마다 JSON 요청을 읽고 같은 줄로 답한다.
import { existsSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { createIdSource } from "../../base/id.ts";
import { systemClock } from "../../base/clock.ts";
import { cryptoRandom } from "../../base/random.ts";

import type { HostRequest } from "./main.ts";
import { hostFromNodePty } from "./main.ts";
import type { TerminalOutput } from "../ipc/terminal.ts";

// 작은 PTY write마다 pipe·IPC를 깨우지 않고, 큰 출력을 한 JSON 줄에 무제한 쌓지도 않는다.
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
const output = batchOutput((chunks) =>
  process.stdout.write(JSON.stringify({ output: chunks }) + "\n"),
);

const host = hostFromNodePty({
  ids: createIdSource({ clock: systemClock, random: cryptoRandom }),
  env: process.env,
  platform: process.platform,
  exists: (file) => existsSync(file),
  checkFolder: (path) => {
    try {
      const stat = statSync(path);
      if (!stat.isDirectory()) return { ok: false, reason: "not_directory" };
      return { ok: true, path };
    } catch {
      return { ok: false, reason: "unreadable" };
    }
  },
  schedule: (done) => setImmediate(done),
  // 끝난 process의 runtime을 요청의 답이 아니라 id 없는 줄로 먼저 알린다.
  onRuntime(runtime) {
    output.flush();
    process.stdout.write(JSON.stringify({ runtime }) + "\n");
  },
  onOutput: (chunk) => output.write(chunk),
});

// 어느 harness TUI가 도는지는 foreground process가 바뀔 때만 알린다. 새 process가 뜨는 것을 받는 event가 없어 훑는다.
// GUI ↔ TUI toggle이 TUI가 끝난 것을 이 훑기로 알아 간격만큼 기다린다. 한 번에 /proc 두 줄이라 짧게 훑는다.
const FOREGROUND_POLL_MS = 250;
setInterval(() => {
  for (const foreground of host.foregroundChanges()) {
    process.stdout.write(JSON.stringify({ foreground }) + "\n");
  }
}, FOREGROUND_POLL_MS).unref();

const lines = createInterface({ input: process.stdin });
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
  // runtime을 함께 보내야 supervisor가 종료·host-lost 때 unknown을 표시할
  // 자료를 가진다. reply에 runtime이 이미 있으면 한 번만 싣는다.
  const runtime = reply.ok && "runtime" in reply ? reply.runtime : undefined;
  process.stdout.write(
    JSON.stringify({ id: request.id, reply, runtime }) + "\n",
  );
});
