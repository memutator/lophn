// 캘린더 fixture 앱의 테스트용 외부 캘린더다(apps#T24). 실제 외부 캘린더 service에는 나가지 않고
// 메모리의 일정 목록만 가진다. 앱의 blueprint가 이 host·port 하나를 net.fetch로 선언한다.
//
// - GET  /events                     → 200 { events }
// - POST /events?title=&starts_at=   → 201 { event }, 값이 틀리면 400
// 그 밖의 경로는 404다. `fetch`는 network 없이 요청을 처리하고, `serveFakeExternal`이 같은 처리를 local
// HTTP server로 낸다. 앱 시험(network 권한 없음)은 앞의 것을, 실제 broker 전송은 뒤의 것을 쓴다.

export const FAKE_EXTERNAL_HOST = "127.0.0.1";
export const FAKE_EXTERNAL_PORT = 38917;

export type FakeEvent = { id: string; title: string; starts_at: string };

export type SeenRequest = {
  method: string;
  path: string;
  authorization: string | null;
};

export type FakeExternal = {
  events: FakeEvent[];
  seen: SeenRequest[];
  // 다음 요청 하나를 이 status로 거절한다(일시 장애).
  failNext(status: number): void;
  fetch(request: Request): Response;
};

export function createFakeExternal(seed: FakeEvent[] = []): FakeExternal {
  const failures: number[] = [];
  let counter = seed.length;
  const fake: FakeExternal = {
    events: [...seed],
    seen: [],
    failNext(status) {
      failures.push(status);
    },
    fetch(request) {
      const url = new URL(request.url);
      fake.seen.push({
        method: request.method,
        path: url.pathname + url.search,
        authorization: request.headers.get("authorization"),
      });
      const failure = failures.shift();
      if (failure !== undefined) {
        return Response.json({ error: "unavailable" }, { status: failure });
      }
      if (url.pathname !== "/events") {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      if (request.method === "GET") {
        return Response.json({ events: fake.events });
      }
      if (request.method === "POST") {
        const title = url.searchParams.get("title")?.trim() ?? "";
        const startsAt = url.searchParams.get("starts_at") ?? "";
        if (title === "" || Number.isNaN(Date.parse(startsAt))) {
          return Response.json({ error: "invalid event" }, { status: 400 });
        }
        counter += 1;
        const event = {
          id: `ext-${counter}`,
          title,
          starts_at: new Date(startsAt).toISOString(),
        };
        fake.events.push(event);
        return Response.json({ event }, { status: 201 });
      }
      return Response.json({ error: "method not allowed" }, { status: 405 });
    },
  };
  return fake;
}

export type ServedFakeExternal = {
  fake: FakeExternal;
  port: number;
  stop(): Promise<void>;
};

// local HTTP server. port는 기본이 blueprint가 선언한 값이다.
export function serveFakeExternal(
  options: { port?: number; seed?: FakeEvent[] } = {},
): ServedFakeExternal {
  const fake = createFakeExternal(options.seed);
  const server = Deno.serve(
    {
      hostname: FAKE_EXTERNAL_HOST,
      port: options.port ?? FAKE_EXTERNAL_PORT,
      onListen: () => {},
    },
    (request) => fake.fetch(request),
  );
  return {
    fake,
    port: server.addr.port,
    stop: () => server.shutdown(),
  };
}
