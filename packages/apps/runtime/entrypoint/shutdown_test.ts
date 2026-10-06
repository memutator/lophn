// control/shutdown: 새 호출을 닫고 진행 중인 호출이 끝나는 대로 프로세스가 스스로 끝난다(R15).
import { assert, assertEquals } from "@std/assert";
import { startRuntime } from "./startup.ts";
import { startDirectServer } from "./direct-server.ts";
import {
  blueprint,
  clockAt,
  connection,
  shaKey,
  sign,
  startLine,
} from "./testing.ts";

async function shutdownCall(socket: string, actor: string, grace = 10_000) {
  const client = Deno.createHttpClient({
    proxy: { transport: "unix", path: socket },
  });
  try {
    const response = await fetch(
      "http://lophn.invalid/_lophn/control/shutdown",
      {
        client,
        method: "POST",
        headers: {
          authorization: await sign(connection({ actor })),
          "content-type": "application/json",
        },
        body: JSON.stringify({ process_nonce: "nonce-1", grace_ms: grace }),
      },
    );
    await response.body?.cancel();
    return response.status;
  } finally {
    client.close();
  }
}

async function until(read: () => boolean, ms = 3_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (read()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

function boot(dir: string, exits: number[]) {
  const socket = `${dir}/a.sock`;
  const started = startRuntime({
    line: startLine({ direct_socket: socket, broker_socket: `${dir}/b.sock` }),
    blueprint: blueprint(),
    key: shaKey(),
    clock: clockAt(),
    ids: { newId: () => "inv_01h455vb4pex5v6nkc6gd5fdw9" },
    broker: () => Promise.resolve({ status: 200, body: { accepted: true } }),
    dataSchema: 0,
  });
  const server = startDirectServer(started.state, {
    exit: (code) => void exits.push(code),
  });
  return { socket, state: started.state, server };
}

Deno.test("apps/runtime#R15: shutdown 요청은 진행 중인 호출이 없으면 응답 뒤 바로 프로세스를 끝낸다", async () => {
  const dir = await Deno.makeTempDir();
  const exits: number[] = [];
  const { socket, state, server } = boot(dir, exits);
  try {
    // platform machine 연결이 아니면 받지 않고 끝내지도 않는다.
    assertEquals(await shutdownCall(socket, "user"), 403);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assertEquals(exits, []);
    assertEquals(await shutdownCall(socket, "machine"), 200);
    assert(await until(() => exits.length === 1));
    assertEquals(exits, [0]);
    // 새 호출은 닫혀 있다.
    assertEquals(state.closed, true);
    // 같은 요청을 다시 받아도 두 번 끝내지 않는다.
    await shutdownCall(socket, "machine");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assertEquals(exits, [0]);
  } finally {
    await server.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("apps/runtime#R15: 진행 중인 호출은 끝나기를 기다리고 유예가 지나면 기다리지 않는다", async () => {
  const dir = await Deno.makeTempDir();
  const exits: number[] = [];
  const { socket, state, server } = boot(dir, exits);
  try {
    state.invocations.set("inv_01h455vb4pex5v6nkc6gd5fdw8", {
      id: "inv_01h455vb4pex5v6nkc6gd5fdw8",
      requestKey: "k",
      command: "usage.save",
      effect: "write",
      caller: { kind: "direct" },
      progress: "running",
      recorded: false,
    });
    assertEquals(await shutdownCall(socket, "machine"), 200);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assertEquals(exits, [], "a running call is not cut short");
    // 호출이 끝나면 곧 끝난다.
    state.invocations.get("inv_01h455vb4pex5v6nkc6gd5fdw8")!.progress =
      "succeeded";
    assert(await until(() => exits.length === 1));
  } finally {
    await server.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("apps/runtime#R15: 유예가 지나도 끝나지 않는 호출이 있으면 그 호출을 두고 끝낸다", async () => {
  const dir = await Deno.makeTempDir();
  const exits: number[] = [];
  const { socket, state, server } = boot(dir, exits);
  try {
    state.invocations.set("inv_01h455vb4pex5v6nkc6gd5fdw8", {
      id: "inv_01h455vb4pex5v6nkc6gd5fdw8",
      requestKey: "k",
      command: "usage.save",
      effect: "write",
      caller: { kind: "direct" },
      progress: "running",
      recorded: false,
    });
    // grace_ms는 10000만 받는다. 시험은 시계 대신 호출을 끝내지 않고 유예 한도를 줄여 본다.
    const original = Date.now;
    let offset = 0;
    Date.now = () => original() + offset;
    try {
      assertEquals(await shutdownCall(socket, "machine"), 200);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assertEquals(exits, []);
      offset = 10_001;
      assert(await until(() => exits.length === 1));
    } finally {
      Date.now = original;
    }
  } finally {
    await server.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});
