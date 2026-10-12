// collector의 기존 문제 읽기 adapter 테스트. 이름은 요구 번호로 시작한다(dev/tasks.md).
import { assert, assertEquals } from "@std/assert";
import { coreProblemLookup } from "./core-problem.ts";
import { APP_A } from "../../grouping/testing/mod.ts";

const PROBLEM = "prb_01arz3ndektsv4rrffq69g5fav";

function call(
  respond: (
    url: string,
    init: { body: string; headers: Record<string, string> },
  ) => {
    status: number;
    body: unknown;
  },
) {
  const seen: { url: string; body: string; authorization: string }[] = [];
  return {
    seen,
    client: {
      baseUrl: "http://127.0.0.1:1234/",
      credential: "collector-token",
      fetch: (url: string, init: {
        method: string;
        headers: Record<string, string>;
        body: string;
      }) => {
        seen.push({
          url,
          body: init.body,
          authorization: init.headers["authorization"]!,
        });
        const answer = respond(url, init);
        return Promise.resolve({
          status: answer.status,
          bytes: new TextEncoder().encode(
            typeof answer.body === "string"
              ? answer.body
              : JSON.stringify(answer.body),
          ),
        });
      },
    },
  };
}

const found = {
  problem: {
    id: PROBLEM,
    app: APP_A,
    group_key: {
      kind: "declared" as const,
      code: "save_failed",
      discriminator: null,
    },
    status: "open",
    work: null,
    interpretation: null,
    closure: null,
    seq: "7",
  },
  text: "Something needs checking",
  report_count: 1,
  first_observed_at: "2026-10-04T12:00:00.000Z",
  last_observed_at: "2026-10-04T12:00:00.000Z",
  first_release: null,
  last_release: null,
  as_of_seq: "7",
  next_cursor: null,
};

Deno.test("problems/grouping#R6: 기존 문제를 core loopback GetProblem으로 읽어 앱과 group key를 돌려준다", async () => {
  const fake = call(() => ({ status: 200, body: found }));
  const result = await coreProblemLookup(fake.client)(PROBLEM);
  assert(result.ok);
  assertEquals(result.value, {
    id: PROBLEM,
    app: APP_A,
    group_key: found.problem.group_key,
  });
  assertEquals(fake.seen.length, 1);
  assertEquals(fake.seen[0].url, "http://127.0.0.1:1234/v1/problems/get");
  assertEquals(fake.seen[0].authorization, "Bearer collector-token");
  assertEquals(JSON.parse(fake.seen[0].body), { problem: PROBLEM });
});

Deno.test("problems/grouping#R6: 없는 문제와 범위 밖 문제는 같은 null이고 읽지 못한 것은 unavailable이다", async () => {
  for (const code of ["not_found", "forbidden"]) {
    const fake = call(() => ({
      status: code === "not_found" ? 404 : 403,
      body: { error: { code, message: "x" } },
    }));
    const result = await coreProblemLookup(fake.client)(PROBLEM);
    assert(result.ok);
    assertEquals(result.value, null);
  }
  const cases = [
    call(() => ({
      status: 500,
      body: { error: { code: "internal", message: "x" } },
    })),
    call(() => ({ status: 503, body: "not json" })),
    call(() => ({ status: 200, body: { problem: {} } })),
    {
      seen: [],
      client: {
        baseUrl: "http://127.0.0.1:1",
        credential: "t",
        fetch: () => Promise.reject(new Error("down")),
      },
    },
  ];
  for (const fake of cases) {
    const result = await coreProblemLookup(fake.client)(PROBLEM);
    assert(!result.ok);
    assertEquals(result.error.code, "unavailable");
  }
});
