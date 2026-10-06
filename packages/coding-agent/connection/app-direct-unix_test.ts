// 앱 direct unix socket transport 시험이다(mcp#R29, cli#R31). 진짜 unix socket HTTP server를 temp dir에
// 세워 왕복과 NotSent·결과 불명 구별을 본다. 사람의 실제 data root·앱 socket은 열지 않는다.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { NOT_SENT } from "./app-direct.ts";
import { unixAppDirectTransport } from "./app-direct-unix.ts";

async function withSocket<T>(
  handler: (request: Request) => Response | Promise<Response>,
  run: (path: string) => Promise<T>,
): Promise<T> {
  const dir = await Deno.makeTempDir({ dir: "/tmp", prefix: "lophn-u-" });
  const path = `${dir}/a0.sock`;
  const server = Deno.serve({ path, onListen: () => {} }, handler);
  try {
    return await run(path);
  } finally {
    await server.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
}

const REQUEST = {
  method: "POST" as const,
  path: "/v1/commands/invoke",
  authorization: "signed",
  body: { command: "list" },
};

Deno.test("coding-agent/mcp-server#R29: unix socket로 가상 host·authorization·JSON 본문을 보내고 응답을 읽는다", async () => {
  let seen: { host: string; auth: string | null; body: unknown } | undefined;
  await withSocket(async (request) => {
    seen = {
      host: new URL(request.url).host,
      auth: request.headers.get("authorization"),
      body: await request.json(),
    };
    return Response.json({ ok: true });
  }, async (path) => {
    const response = await unixAppDirectTransport({ allowed: [path] })(
      path,
      REQUEST,
    );
    assertEquals(response, { status: 200, body: { ok: true } });
  });
  assertEquals(seen?.host, "lophn.invalid");
  assertEquals(seen?.auth, "signed");
  assertEquals(seen?.body, { command: "list" });
});

Deno.test("coding-agent/mcp-server#R29: 허용 목록 밖 endpoint와 열리지 않는 socket은 연결 없이 NotSent이고 요청은 나가지 않는다", async () => {
  let calls = 0;
  await withSocket(() => {
    calls += 1;
    return Response.json({});
  }, async (path) => {
    // 목록 밖 endpoint는 존재해도 연결하지 않는다(없는 것과 같은 NotSent).
    const outside = await assertRejects(() =>
      unixAppDirectTransport({ allowed: ["/tmp/lophn-other/a1.sock"] })(
        path,
        REQUEST,
      )
    );
    assertEquals((outside as Error).name, NOT_SENT);
    assertEquals(calls, 0);
    // 없는 socket도 NotSent다.
    const absent = await assertRejects(() =>
      unixAppDirectTransport()(`${path}.none`, REQUEST)
    );
    assertEquals((absent as Error).name, NOT_SENT);
  });
});

Deno.test("coding-agent/mcp-server#R29: 보낸 뒤 응답이 JSON이 아니면 NotSent가 아닌 오류라 결과 불명으로 다뤄진다", async () => {
  await withSocket(() => new Response("not json"), async (path) => {
    let caught: unknown;
    try {
      await unixAppDirectTransport()(path, REQUEST);
    } catch (thrown) {
      caught = thrown;
    }
    assert(caught instanceof Error);
    assert(caught.name !== NOT_SENT);
  });
});
