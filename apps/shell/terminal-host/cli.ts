// 묶인 host의 시작점. 테스트가 main.ts를 import해도 stdin을 잡지 않는다.
// 줄마다 JSON 요청을 읽고 같은 줄로 답한다.
import { existsSync, statSync } from "node:fs";
import { createInterface } from "node:readline";

import { procTree } from "./child-watch.ts";
import { createCodingHost } from "./launch-plan.ts";
import type { HostRequest } from "./main.ts";
import { hostFromNodePty } from "./main.ts";

const host = hostFromNodePty({
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
  coding: createCodingHost({
    platform: process.platform,
    now: () => new Date().toISOString(),
    timer: (ms, fire) => {
      const timer = setTimeout(fire, ms);
      return () => clearTimeout(timer);
    },
    // TUI 아래 MCP·CLI process는 /proc을 훑어 본다. 등록은 main이 core에 한다.
    watch: {
      tree: procTree(),
      every: (ms, fire) => {
        const timer = setInterval(fire, ms);
        return () => clearInterval(timer);
      },
    },
    // 관측은 요청의 답이 아니라 host가 먼저 보내는 줄이다. id가 없다.
    emit: (event) => process.stdout.write(JSON.stringify(event) + "\n"),
  }),
});

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
