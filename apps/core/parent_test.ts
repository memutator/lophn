import { assert, assertEquals } from "@std/assert";
import {
  encodeFrame,
  mainHelloSchema,
} from "../../packages/protocol/server/mod.ts";
import { readFrames } from "../../packages/core/supervision/responsiveness/mod.ts";
import {
  type ParentPipe,
  type ShellViewLifetime,
  shellViewLog,
  watchParent,
} from "./parent.ts";

const lifetime = {
  type: "diagnostic",
  kind: "shell_view_lifetime",
  payload: {
    component: "platform/shell-main",
    observed_at: "2026-10-06T00:00:00.000Z",
    view_id: "view-1",
    generation: 2,
    created: 1,
    hidden: 0,
    replaced: 1,
    disposed: 0,
    attached: 1,
  },
};

const controlFrame = (payload: unknown) =>
  encodeFrame({ kind: "json", channel: 0, payload });

Deno.test("shell/app-frame#R22, platform/diagnostics#R2: main의 view 수명 진단은 field만 core log에 쓰고 다른 종류·잘못된 진단은 무시하며 통로를 멈추지 않는다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-parent-diag-" });
  try {
    const seen: ShellViewLifetime[] = [];
    const log = shellViewLog(home);
    let stopped = 0;
    const parent: ParentPipe = {
      stdin: new ReadableStream({
        start(controller) {
          for (
            const payload of [
              lifetime,
              // 다른 종류의 진단은 이 통로에서 받지 않는다.
              {
                type: "diagnostic",
                kind: "unattributed_observation",
                payload: {
                  component: "platform/shell-main",
                  observed_at: "2026-10-06T00:00:00.000Z",
                  count: 1,
                },
              },
              // 정해진 field 밖(URL)은 schema가 거절한다.
              {
                ...lifetime,
                payload: {
                  ...lifetime.payload,
                  url: "lophn-app://app-x/main/index.html?token=secret",
                },
              },
              { type: "diagnostic", kind: "not_a_kind", payload: {} },
            ]
          ) {
            controller.enqueue(controlFrame(payload));
          }
          controller.enqueue(controlFrame({ type: "stop", grace_ms: 1 }));
          controller.close();
        },
      }),
      stdout: new WritableStream(),
    };
    await watchParent(
      parent,
      () => {
        stopped += 1;
        return Promise.resolve();
      },
      undefined,
      {
        async shellView(diagnostic) {
          seen.push(diagnostic);
          await log.shellView(diagnostic);
        },
      },
    );
    assertEquals(stopped, 1);
    assertEquals(seen.length, 1);
    const lines = (await Deno.readTextFile(`${home}/logs/shell-view.jsonl`))
      .trim().split("\n");
    assertEquals(lines.map((line) => JSON.parse(line)), [{
      at: "2026-10-06T00:00:00.000Z",
      component: "platform/shell-main",
      kind: "diagnostic",
      code: "shell_view_lifetime",
      view_id: "view-1",
      generation: 2,
      created: 1,
      hidden: 0,
      replaced: 1,
      disposed: 0,
      attached: 1,
    }]);
    assertEquals(lines.join("").includes("token"), false);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

// Node로 띄우지 않는다. core는 Deno 권한과 Worker가 필요하고, tools/check.ts의 node 단계는
// apps/shell/main의 npm 검사다. 부모는 별도 프로세스로 실제 main.ts를 띄운다.
Deno.test("platform/install-and-update#R12: 부모 프로세스가 hello, command, read, event, 구독까지 돈다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-parent-" });
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-all",
      new URL("./main.ts", import.meta.url).pathname,
      "--port=0",
    ],
    env: { LOPHN_HOME: home },
    cwd: new URL("../..", import.meta.url).pathname,
    stdin: "piped",
    stdout: "piped",
    stderr: "inherit",
  });
  const child = command.spawn();
  try {
    const hello = await firstHello(child.stdout);
    assert(hello.api_port > 0);
    assert(hello.core_epoch.length > 0);
    assert(hello.user_token.length > 0);

    const base = `http://127.0.0.1:${hello.api_port}`;
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${hello.user_token}`,
    };
    const status = await fetch(`${base}/v1/platform/status`, {
      method: "POST",
      headers,
      body: "{}",
    });
    assertEquals(status.status, 200);
    const statusBody = await status.json();
    const io = (statusBody as { components?: { component: string }[] })
      .components?.find((component) => component.component === "io");
    assert(io, "status에 io 구성 요소가 없다");

    // main의 view 수명 진단은 감독 pipe로 와서 core log에 남는다.
    const stdin = child.stdin.getWriter();
    await stdin.write(controlFrame(lifetime));
    stdin.releaseLock();
    let logged = "";
    for (let wait = 0; wait < 100 && logged === ""; wait++) {
      try {
        logged = await Deno.readTextFile(`${home}/logs/shell-view.jsonl`);
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assertEquals(JSON.parse(logged.trim()).view_id, "view-1");

    // user token의 scope는 user를 허용하는 route 전부다. machine 전용 command는 scope 밖이라 403이다.
    const commandResponse = await fetch(`${base}/v1/events/advance-cursor`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        input: { subscriber: "parent", scanned_through_seq: "0" },
        idempotency_key: "parent-1",
        compare: { processed_through_seq: "0" },
        prepared: [],
      }),
    });
    assertEquals(commandResponse.status, 403);

    // commands/result는 user를 허용하는 read라 scope 안이다. 거절된 command의 결과는 기록이 없다.
    const result = await fetch(`${base}/v1/commands/result`, {
      method: "POST",
      headers,
      body: JSON.stringify({ idempotency_key: "parent-1" }),
    });
    assertEquals(result.status, 200);

    const events = await fetch(`${base}/v1/events/list`, {
      method: "POST",
      headers,
      body: JSON.stringify({ after_seq: "0" }),
    });
    assertEquals(events.status, 200);

    const socket = new WebSocket(
      `${base.replace("http", "ws")}/v1/events/subscribe`,
      {
        headers: { authorization: `Bearer ${hello.user_token}` },
      },
    );
    const opened = await new Promise<boolean>((resolve) => {
      socket.onopen = () => resolve(true);
      socket.onerror = () => resolve(false);
    });
    assert(opened);
    socket.send(JSON.stringify({
      type: "subscribe",
      from_seq: "0",
      types: [],
      subjects: [],
    }));
    const frame = await new Promise<string>((resolve, reject) => {
      socket.onmessage = (event) => resolve(String(event.data));
      socket.onclose = () => reject(new Error("socket closed"));
    });
    const parsed = JSON.parse(frame) as { type?: string };
    assert(parsed.type === "events" || parsed.type === "unavailable");
    socket.close();
  } finally {
    try {
      child.kill("SIGTERM");
    } catch { /* 이미 끝남 */ }
    await child.status;
    await Deno.remove(home, { recursive: true });
  }
});

async function firstHello(
  stdout: ReadableStream<Uint8Array>,
): Promise<{ user_token: string; api_port: number; core_epoch: string }> {
  const reader = stdout.getReader();
  let pending: Uint8Array | undefined;
  const read = async (buffer: Uint8Array): Promise<number | null> => {
    while (!pending || pending.length === 0) {
      const next = await reader.read();
      if (next.done) return null;
      pending = next.value;
    }
    const take = Math.min(buffer.length, pending.length);
    buffer.set(pending.subarray(0, take));
    pending = pending.subarray(take);
    return take;
  };
  for await (const frame of readFrames({ read })) {
    if (frame.kind !== "json") continue;
    const parsed = mainHelloSchema.safeParse(frame.payload);
    if (parsed.success) return parsed.data;
  }
  throw new Error("hello frame이 없다");
}
