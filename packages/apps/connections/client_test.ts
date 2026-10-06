// 앱 프로세스 쪽 통로(apps/connections#R4, apps/sdk#R40). 준비 요청만 broker로 가고 SDK는 이
// 통로를 통해서만 다른 앱에 닿는다. import만으로는 통로가 없고 앱 runtime이 시작할 때 설치한다.
import { assertEquals } from "@std/assert";
import { BROKER_SOCKET_PATHS, SOCKET_HOST } from "../../contracts/apps/mod.ts";
import {
  APP_CONNECT_PATH,
  createPairPort,
  installPairPort,
  PAIR_PORT,
  PAIR_SOCKET_HOST,
  unixPairDirect,
} from "./mod.ts";

Deno.test("apps/connections#R4: 통로의 경로·host·심볼은 contracts와 SDK가 쓰는 값과 같다", () => {
  assertEquals(APP_CONNECT_PATH, BROKER_SOCKET_PATHS.appsConnect);
  assertEquals(PAIR_SOCKET_HOST, SOCKET_HOST);
  assertEquals(PAIR_PORT, Symbol.for("lophn.cap-apps"));
});

Deno.test("apps/connections#R4: 연결되지 않은 socket은 보내지 못한 요청(NotSent)으로 구별된다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lop-pair-" });
  try {
    const failure = await unixPairDirect(`${dir}/none.sock`, {
      method: "GET",
      path: "/_lophn/commands/status",
      authorization: "x",
    }).catch((error: Error) => error.name);
    assertEquals(failure, "NotSent");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("apps/sdk#R40: 통로를 설치하기 전에는 아무것도 열려 있지 않다", () => {
  delete (globalThis as Record<symbol, unknown>)[PAIR_PORT];
  assertEquals((globalThis as Record<symbol, unknown>)[PAIR_PORT], undefined);
  const port = installPairPort(createPairPort({
    postConnect: () => Promise.resolve({ status: 503, body: null }),
    direct: () => Promise.resolve({ status: 503, body: null }),
  }));
  assertEquals((globalThis as Record<symbol, unknown>)[PAIR_PORT], port);
  delete (globalThis as Record<symbol, unknown>)[PAIR_PORT];
});
