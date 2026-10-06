// documents/versions#R13: 실제 core가 `document.set_source`를 서빙한다. 데이터 root는 harness가
// 만든 temp dir다. 사람 데이터 root는 열지 않는다. 판 원문 blob이 필요한 시나리오는 이 시험이
// 만들지 않는다(없는 blob의 hash를 꾸미지 않는다): command의 규칙은 versions leaf 시험이 본다.
import { assert, assertEquals } from "@std/assert";
import { createLedgerRegistration } from "./documents.ts";
import type { TeamModule } from "./registration.ts";
import { type CoreHarness, createCoreHarness } from "./testing/core.ts";

const teams: TeamModule[] = [{ createLedgerRegistration }];
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";

async function open(
  actor: "user" | "machine",
): Promise<{ harness: CoreHarness; token: string }> {
  const opened = await createCoreHarness({
    teams,
    teamModules: [new URL("./documents.ts", import.meta.url).href],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const issued = await opened.value.credential({
    actor,
    principal: "principal-1",
    scope: { operations: ["document.set_source"], targets: {} },
    conditions: {},
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  return { harness: opened.value, token: issued.value.token };
}

function post(harness: CoreHarness, token: string, body: unknown) {
  return fetch(`http://127.0.0.1:${harness.port}/v1/documents/set_source`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

const request = {
  input: { document: DOC, file_source: null },
  idempotency_key: "set-source-1",
  compare: { base_revision: "1" },
  prepared: [],
};

Deno.test("documents/versions#R13: core 등록에 document.set_source가 user command로 들어 있다", () => {
  const commands = (createLedgerRegistration().commands ?? []) as {
    route: { name: string; actors: readonly string[] };
  }[];
  const found = commands.filter((command) =>
    command.route.name === "document.set_source"
  );
  assertEquals(found.length, 1);
  assertEquals(found[0]!.route.actors, ["user"]);
});

Deno.test("documents/versions#R13: 실제 core에서 user의 없는 문서 연결 변경은 404 not_found다", async () => {
  const { harness, token } = await open("user");
  try {
    const response = await post(harness, token, request);
    const body = await response.text();
    assertEquals(response.status, 404, body);
  } finally {
    await harness.close();
  }
});

Deno.test("documents/versions#R13: 실제 core에서 user가 아닌 자격의 연결 변경은 거절된다", async () => {
  const { harness, token } = await open("machine");
  try {
    const response = await post(harness, token, request);
    const body = await response.text();
    assert(response.status === 403 || response.status === 401, body);
  } finally {
    await harness.close();
  }
});
