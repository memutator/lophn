import { assert, assertEquals } from "@std/assert";
import { mainHelloSchema } from "../../packages/contracts/platform/mod.ts";
import { readFrames } from "../../packages/platform/responsiveness/mod.ts";

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

    // user token의 scope는 status·health다. command는 인증을 통과한 뒤 scope로 거절한다.
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

    // commands/result는 scope 밖이다. 인증이 된 요청이 403으로 거절되면 read 경로가 살아 있는 것이다.
    const result = await fetch(`${base}/v1/commands/result`, {
      method: "POST",
      headers,
      body: JSON.stringify({ idempotency_key: "parent-1" }),
    });
    assertEquals(result.status, 403);

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
