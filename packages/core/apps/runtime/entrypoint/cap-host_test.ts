// 앱 프로세스 entrypoint가 cap-net·cap-secret·cap-save·cap-store의 host port를 설치한다
// (apps/sdk#R22–R32). `post`는 broker 연결의 신원을 붙이고 `call()`은 실행 중인 command의 문맥을 낸다.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { canonicalInputHash } from "../../blueprint/mod.ts";
import { CAP_HOST, type CapHostPort } from "./cap-host.ts";
import { startRuntime } from "./startup.ts";
import { handleInvoke } from "./invoke.ts";
import {
  blueprint,
  clockAt,
  connection,
  installHandlers,
  REL,
  shaKey,
  startLine,
} from "./testing.ts";
import type { AppConnection } from "./wire.ts";

function host(): CapHostPort | undefined {
  return (globalThis as Record<symbol, unknown>)[CAP_HOST] as
    | CapHostPort
    | undefined;
}

function start(
  sent: { path: string; credential: string; body: Record<string, unknown> }[],
  mode: "live" | "preview" = "live",
) {
  delete (globalThis as Record<symbol, unknown>)[CAP_HOST];
  return startRuntime({
    line: startLine({ mode }),
    blueprint: blueprint(),
    key: shaKey(),
    clock: clockAt(),
    ids: { newId: () => "inv_01h455vb4pex5v6nkc6gd5fdw1" },
    broker: (request) => {
      sent.push({
        path: request.path,
        credential: request.credential,
        body: request.body as Record<string, unknown>,
      });
      return Promise.resolve({ status: 200, body: { used: true } });
    },
    dataSchema: 0,
  });
}

Deno.test("apps/sdk#R31: 시작하면 host port가 설치되고 post는 이 자식의 신원과 credential로만 broker에 간다", async () => {
  const sent: {
    path: string;
    credential: string;
    body: Record<string, unknown>;
  }[] = [];
  start(sent);
  const port = host();
  assert(port !== undefined);
  assertEquals(port.mode, "live");
  assertEquals(port.dataPath, "/tmp/data");
  // 본문이 다른 nonce·mode를 말해도 연결의 신원이 이긴다.
  const reply = await port.post("/_lophn/broker/secrets/use", {
    name: "token",
    process_nonce: "forged",
    mode: "preview",
  });
  assertEquals(reply, { status: 200, body: { used: true } });
  assertEquals(sent[0].path, "/_lophn/broker/secrets/use");
  assertEquals(sent[0].credential, "child-cred");
  assertEquals(sent[0].body["process_nonce"], "nonce-1");
  assertEquals(sent[0].body["mode"], "live");
  assertEquals(sent[0].body["name"], "token");
  // 앱 코드가 읽는 port에는 credential이나 nonce 자리가 없다.
  assertEquals(
    Object.keys(port).sort(),
    ["call", "dataPath", "mode", "post"],
  );
  delete (globalThis as Record<symbol, unknown>)[CAP_HOST];
});

Deno.test("apps/sdk#R31: 중단된 신호는 기다림을 끝내고 호출 밖의 call은 null이다", async () => {
  const sent: {
    path: string;
    credential: string;
    body: Record<string, unknown>;
  }[] = [];
  start(sent, "preview");
  const port = host()!;
  assertEquals(port.mode, "preview");
  assertEquals(port.call(), null);
  const controller = new AbortController();
  controller.abort();
  await assertRejects(
    () => port.post("/x", {}, { signal: controller.signal }),
  );
  assertEquals(sent, []);
  delete (globalThis as Record<symbol, unknown>)[CAP_HOST];
});

Deno.test("apps/sdk#R30: 실행 중인 command의 host 문맥에는 command·입력 hash·release·invocation이 있다", async () => {
  const sent: {
    path: string;
    credential: string;
    body: Record<string, unknown>;
  }[] = [];
  const seen: unknown[] = [];
  const started = start(sent);
  installHandlers([{
    command: "usage.read",
    handle: () => {
      seen.push(host()!.call());
      return { rows: [] };
    },
  }]);
  started.state.accepting = true;
  const reply = await handleInvoke(
    started.state,
    "/_lophn/commands/invoke",
    new TextEncoder().encode(
      JSON.stringify({
        request_key: "k-1",
        release: REL,
        command: "usage.read",
        // 생략한 limit은 선언 default로 채운 실제 입력이 hash된다.
        input: {},
      }),
    ),
    connection() as AppConnection,
  );
  assertEquals(reply.status, 200);
  const usage = blueprint().commands.find((c) => c.key === "usage.read")!;
  const expected = await canonicalInputHash(usage.input, { limit: 10 });
  assert(expected.ok);
  assertEquals(seen, [{
    command: "usage.read",
    inputHash: expected.value,
    release: REL,
    invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
  }]);
  // 호출이 끝나면 문맥도 없다.
  assertEquals(host()!.call(), null);
  delete (globalThis as Record<symbol, unknown>)[CAP_HOST];
});
