import { assertEquals } from "@std/assert";
import { createFakeExternal, type FakeExternal } from "./server.ts";

const ORIGIN = "https://127.0.0.1:38917";

function request(
  fake: FakeExternal,
  method: string,
  path: string,
): Promise<Response> {
  return Promise.resolve(
    fake.fetch(new Request(`${ORIGIN}${path}`, { method })),
  );
}

Deno.test("apps/blueprint#R5: fake 외부 캘린더의 GET은 목록만 돌려주고 일정을 바꾸지 않는다", async () => {
  const fake = createFakeExternal([
    { id: "ext-1", title: "A", starts_at: "2026-02-01T09:00:00.000Z" },
  ]);
  const before = structuredClone(fake.events);
  const response = await request(fake, "GET", "/events");
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { events: before });
  assertEquals(fake.events, before);
});

Deno.test("apps/blueprint#R5: fake 외부 캘린더의 POST는 일정을 만들고 틀린 값과 모르는 경로·method는 거절한다", async () => {
  const fake = createFakeExternal();
  const created = await request(
    fake,
    "POST",
    "/events?title=Lunch&starts_at=2026-02-01T12:00:00Z",
  );
  assertEquals(created.status, 201);
  assertEquals(await created.json(), {
    event: {
      id: "ext-1",
      title: "Lunch",
      starts_at: "2026-02-01T12:00:00.000Z",
    },
  });
  assertEquals(fake.events.length, 1);
  for (
    const [method, path, status] of [
      ["POST", "/events?title=&starts_at=2026-02-01T12:00:00Z", 400],
      ["POST", "/events?title=Lunch&starts_at=later", 400],
      ["GET", "/elsewhere", 404],
      ["DELETE", "/events", 405],
    ] as const
  ) {
    assertEquals((await request(fake, method, path)).status, status, path);
  }
  assertEquals(fake.events.length, 1);
});

Deno.test("apps/blueprint#R5: fake 외부 캘린더는 받은 요청과 인증 header를 남기고 failNext는 다음 요청 하나만 거절한다", async () => {
  const fake = createFakeExternal();
  fake.failNext(503);
  assertEquals((await request(fake, "GET", "/events")).status, 503);
  assertEquals((await request(fake, "GET", "/events")).status, 200);
  assertEquals(fake.seen, [
    { method: "GET", path: "/events", authorization: null },
    { method: "GET", path: "/events", authorization: null },
  ]);
});
