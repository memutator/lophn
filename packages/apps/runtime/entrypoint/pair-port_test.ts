// 앱 runtime이 시작할 때 SDK가 읽는 앱 쌍 통로를 설치한다(apps/sdk#R40, apps/connections#R4).
import { assert, assertEquals } from "@std/assert";
import { PAIR_PORT, type PairPort } from "../../connections/mod.ts";
import { startRuntime } from "./startup.ts";
import { blueprint, clockAt, shaKey, startLine } from "./testing.ts";

Deno.test("apps/sdk#R40: 앱 runtime이 설치한 통로만 준비 요청을 broker로 보내고 자식 신원은 broker client가 붙인다", async () => {
  delete (globalThis as Record<symbol, unknown>)[PAIR_PORT];
  const sent: { path: string; body: Record<string, unknown> }[] = [];
  startRuntime({
    line: startLine(),
    blueprint: blueprint(),
    key: shaKey(),
    clock: clockAt(),
    ids: { newId: () => "inv_01h455vb4pex5v6nkc6gd5fdw1" },
    broker: (request) => {
      sent.push({
        path: request.path,
        body: request.body as Record<string, unknown>,
      });
      return Promise.resolve({ status: 200, body: null });
    },
    dataSchema: 0,
    pairDirect: () => Promise.resolve({ status: 200, body: { via: "direct" } }),
  });
  const port = (globalThis as Record<symbol, unknown>)[PAIR_PORT] as PairPort;
  assert(port !== undefined);
  await port.connect({
    app: "app_01h455vb4pex5v6nkc6gd5fdw2",
    commands: ["usage.read"],
    parent_invocation: null,
  });
  assertEquals(sent.length, 1);
  assertEquals(sent[0].path, "/_lophn/broker/apps/connect");
  // 본문의 신원은 broker client가 이 자식 연결에서 붙인다.
  assertEquals(sent[0].body["process_nonce"], "nonce-1");
  assertEquals(sent[0].body["mode"], "live");
  // 연결 뒤 요청은 broker를 지나지 않고 direct 전송으로 간다.
  const reply = await port.direct("/x.sock", {
    method: "GET",
    path: "/_lophn/commands/status",
    authorization: "x",
  });
  assertEquals(reply.body, { via: "direct" });
  assertEquals(sent.length, 1);
  delete (globalThis as Record<symbol, unknown>)[PAIR_PORT];
});
