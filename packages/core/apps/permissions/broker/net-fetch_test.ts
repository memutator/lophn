import { assert, assertEquals } from "@std/assert";
import { createNetFetchService } from "./net-fetch.ts";
import {
  child,
  createAccessFixture,
  requirement,
  serveLocal,
  withChild,
} from "../testing/broker.ts";

function body(port: number, over: Record<string, unknown> = {}) {
  return withChild({
    invocation: null,
    command: "sync",
    host: "127.0.0.1",
    port,
    method: "GET",
    path: "/items",
    ...over,
  });
}

function service(
  access: ReturnType<typeof createAccessFixture>,
  platformPorts: number[] = [],
  over: { maxBytes?: number } = {},
) {
  return createNetFetchService({
    access,
    scheme: "http",
    platformPorts,
    ...over,
  });
}

function declared(...ports: number[]) {
  const access = createAccessFixture({
    permissions: ports.map((port) =>
      requirement("net.fetch", { host: "127.0.0.1", port })
    ),
  });
  return access;
}

Deno.test("apps/permissions#R2: 선언한 host·port도 grant가 있어야 연결하고 회수하면 다음 요청부터 거절한다", async () => {
  const target = serveLocal(() =>
    Response.json({ items: [1, 2] }, { status: 200 })
  );
  try {
    const access = declared(target.port);
    const net = service(access);
    const declaredOnly = await net.request(child(), body(target.port));
    assert(!declaredOnly.ok);
    assertEquals(declaredOnly.error.code, "forbidden");
    assertEquals(declaredOnly.error.details, {
      permission: "net.fetch",
      scope: { host: "127.0.0.1", port: target.port },
    });
    assertEquals(target.seen.length, 0);

    const grant = access.grant({
      kind: "net.fetch",
      host: "127.0.0.1",
      port: target.port,
    });
    const fetched = await net.request(child(), body(target.port));
    assert(fetched.ok);
    assertEquals(fetched.value, { status: 200, body: { items: [1, 2] } });
    assertEquals(target.seen.length, 1);
    // 앱이 보낸 신원·자격 주장은 요청 헤더에 실리지 않는다.
    assertEquals(target.seen[0]?.headers.get("authorization"), null);

    access.revoke(grant);
    const after = await net.request(child(), body(target.port));
    assert(!after.ok);
    assertEquals(after.error.code, "forbidden");
    assertEquals(target.seen.length, 1);
  } finally {
    await target.stop();
  }
});

Deno.test("apps/permissions#R2: grant는 있지만 현재 선언에 없는 host·port는 거절한다", async () => {
  const target = serveLocal(() => new Response("ok"));
  try {
    const access = declared();
    access.grant({ kind: "net.fetch", host: "127.0.0.1", port: target.port });
    const refused = await service(access).request(child(), body(target.port));
    assert(!refused.ok);
    assertEquals(refused.error.code, "forbidden");
    assertEquals(target.seen.length, 0);
  } finally {
    await target.stop();
  }
});

Deno.test("apps/permissions#R8: 허락한 정확한 host·port만 연결하고 wildcard·port 0·다른 port는 거절한다", async () => {
  const target = serveLocal(() => new Response("ok"));
  try {
    const access = declared(target.port);
    access.grant({ kind: "net.fetch", host: "127.0.0.1", port: target.port });
    const net = service(access);
    for (
      const over of [
        { host: "*.example.com" },
        { host: "127.0.0.1:80" },
        { host: "" },
        { port: 0 },
        { port: 65536 },
        { host: "[::1]" },
      ]
    ) {
      const refused = await net.request(child(), body(target.port, over));
      assert(!refused.ok, JSON.stringify(over));
      assert(
        ["invalid_input", "forbidden"].includes(refused.error.code),
        JSON.stringify(over),
      );
    }
    const otherPort = await net.request(child(), body(target.port + 1));
    assert(!otherPort.ok);
    assertEquals(otherPort.error.code, "forbidden");
    assertEquals(target.seen.length, 0);
    const exact = await net.request(child(), body(target.port));
    assert(exact.ok);
    assertEquals(exact.value.body, "ok");
  } finally {
    await target.stop();
  }
});

Deno.test("apps/permissions#R11: 플랫폼 port는 grant가 있어도 loopback 어느 표기에서나 막는다", async () => {
  const target = serveLocal(() => new Response("platform"));
  try {
    for (const host of ["localhost", "127.0.0.1", "127.1.2.3", "0.0.0.0"]) {
      const access = createAccessFixture({
        permissions: [requirement("net.fetch", { host, port: target.port })],
      });
      access.grant({ kind: "net.fetch", host, port: target.port });
      const refused = await service(access, [target.port]).request(
        child(),
        body(target.port, { host }),
      );
      assert(!refused.ok, host);
      assertEquals(refused.error.code, "forbidden");
    }
    assertEquals(target.seen.length, 0);
  } finally {
    await target.stop();
  }
});

Deno.test("apps/permissions#R8: redirect는 한 단계마다 다시 검사한다", async () => {
  const landing = serveLocal(() => new Response("landed"));
  const granted = serveLocal(() => new Response("granted"));
  const hop = serveLocal((_request) => {
    const url = new URL(_request.url);
    const next = url.pathname === "/to-granted" ? granted.port : landing.port;
    return new Response(null, {
      status: 302,
      headers: { location: `http://127.0.0.1:${next}/final` },
    });
  });
  try {
    const access = declared(hop.port, granted.port);
    access.grant({ kind: "net.fetch", host: "127.0.0.1", port: hop.port });
    access.grant({ kind: "net.fetch", host: "127.0.0.1", port: granted.port });
    const net = service(access);
    const followed = await net.request(
      child(),
      body(hop.port, { path: "/to-granted" }),
    );
    assert(followed.ok);
    assertEquals(followed.value.body, "granted");
    const blocked = await net.request(
      child(),
      body(hop.port, { path: "/to-landing" }),
    );
    assert(!blocked.ok);
    assertEquals(blocked.error.code, "forbidden");
    assertEquals(landing.seen.length, 0);
  } finally {
    await hop.stop();
    await granted.stop();
    await landing.stop();
  }
});

Deno.test("apps/permissions#R8: 경로로 목적지를 바꾸는 우회와 live가 아닌 자식은 거절한다", async () => {
  const target = serveLocal(() => new Response("ok"));
  try {
    const access = declared(target.port);
    access.grant({ kind: "net.fetch", host: "127.0.0.1", port: target.port });
    const net = service(access);
    for (const path of ["//evil.example/x", "/\\evil.example/x", "items"]) {
      const refused = await net.request(child(), body(target.port, { path }));
      assert(!refused.ok, path);
      assertEquals(refused.error.code, "invalid_input");
    }
    for (const mode of ["preview", "test"] as const) {
      const who = child({ mode, release: null });
      const refused = await net.request(
        who,
        withChild({
          invocation: null,
          command: "sync",
          host: "127.0.0.1",
          port: target.port,
          method: "GET",
          path: "/items",
        }, who),
      );
      assert(!refused.ok);
      assertEquals(refused.error.code, "forbidden");
    }
    assertEquals(target.seen.length, 0);
  } finally {
    await target.stop();
  }
});

Deno.test("apps/permissions#R2: 선언 command가 아니거나 release가 바뀐 옛 자식은 연결하지 못한다", async () => {
  const target = serveLocal(() => new Response("ok"));
  try {
    const access = declared(target.port);
    access.grant({ kind: "net.fetch", host: "127.0.0.1", port: target.port });
    const net = service(access);
    const unknown = await net.request(
      child(),
      body(target.port, { command: "undeclared" }),
    );
    assert(!unknown.ok);
    // 새 release가 활성화되면 옛 release로 시작한 자식은 새 선언으로 접근을 얻지 못한다.
    const older = await net.request(
      child({ release: "rel_01h455vb4pex5v6nkc6gd5fdw2" }),
      body(target.port),
    );
    assert(!older.ok);
    assertEquals(older.error.code, "forbidden");
    assertEquals(target.seen.length, 0);
  } finally {
    await target.stop();
  }
});

Deno.test("apps/permissions#R8: 응답이 한도를 넘으면 본문을 돌려주지 않는다", async () => {
  const target = serveLocal(() => new Response("x".repeat(2048)));
  try {
    const access = declared(target.port);
    access.grant({ kind: "net.fetch", host: "127.0.0.1", port: target.port });
    const result = await service(access, [], { maxBytes: 1024 }).request(
      child(),
      body(target.port),
    );
    assert(!result.ok);
    assertEquals(result.error.code, "unavailable");
  } finally {
    await target.stop();
  }
});
