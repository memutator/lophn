// 묶인 host의 시작점. 테스트가 main.ts를 import해도 stdin을 잡지 않는다.
// 줄마다 JSON 요청을 읽고 같은 줄로 답한다.
import { existsSync, statSync } from "node:fs";
import { createInterface } from "node:readline";

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
});

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const text = line.trim();
  if (text.length === 0) return;
  let request: HostRequest & { id?: string };
  try {
    request = JSON.parse(text) as HostRequest & { id?: string };
  } catch {
    return;
  }
  const reply = host.handle(request);
  // runtime을 함께 보내야 supervisor가 종료·host-lost 때 unknown을 표시할
  // 자료를 가진다. reply에 runtime이 이미 있으면 한 번만 싣는다.
  const runtime = reply.ok && "runtime" in reply ? reply.runtime : undefined;
  process.stdout.write(
    JSON.stringify({ id: request.id, reply, runtime }) + "\n",
  );
});
