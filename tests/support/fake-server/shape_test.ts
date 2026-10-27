// fake server 모양 점검. 세 질문의 답:
// - contract: boundary `models`(provider가 보내는 stream의 모양). fake와 실제의 일치가 E2E 판정의 전제다.
// - 현실적 회귀: fake server를 고치다가 adapter가 읽는 event를 빼먹어 complete가 partial로 판정되는 것.
// - 왜 지금 test로 못 잡나: server_test는 "adapter가 complete로 읽는다"까지만 본다. 실제 stream과 같은 종류인지는 fixture와 견주지 않으면 모른다.
// fixture는 손으로 만든 것이다. `test:live` 녹화본으로 같은 이름을 대체하면 진짜 값을 갖는다.

import assert from "node:assert/strict";
import { test } from "node:test";
import { loadFixture } from "../wire/mod.ts";
import { createFakeHandler, type Reply } from "./mod.ts";

async function serve(reply: Reply): Promise<string> {
  const fake = createFakeHandler();
  fake.script([{ reply }]);
  const response = await fake.handle(
    new Request("http://x/messages", { method: "POST", body: "{}" }),
  );
  return await response.text();
}

// `event:` 이름을 중복 없이 처음 나온 순서로, data.type 값을 집합(정렬)으로 뽑는다.
function shape(sse: string) {
  const names: string[] = [];
  const types = new Set<string>();
  for (const line of sse.split("\n")) {
    if (line.startsWith("event: ")) {
      const name = line.slice(7).trim();
      if (!names.includes(name)) names.push(name);
    } else if (line.startsWith("data: ")) {
      types.add(JSON.parse(line.slice(6)).type);
    }
  }
  return { names, types: [...types].sort() };
}

const rows: [string, string, Reply][] = [
  ["text", "anthropic/text-end_turn", { kind: "text", text: "Hello" }],
  ["tool", "anthropic/tool-use", {
    kind: "tool",
    text: "Reading.",
    calls: [{ id: "toolu_1", name: "read_file", arguments: '{"path":"a"}' }],
  }],
  ["cut", "anthropic/cut-no-stop", { kind: "cut", partial: { text: "Part" } }],
];

test("fake server가 내는 SSE의 event 종류가 fixture와 같다", async () => {
  for (const [label, name, reply] of rows) {
    const expected = shape(loadFixture(name).body);
    const actual = shape(await serve(reply));
    assert.deepStrictEqual(actual.names, expected.names, `${label} event 순서`);
    assert.deepStrictEqual(actual.types, expected.types, `${label} data.type`);
  }
});

test("raw로 fixture 본문을 그대로 낼 수 있다", async () => {
  const fixture = loadFixture("anthropic/max-tokens");
  const body = await serve({
    kind: "raw",
    status: fixture.status,
    headers: fixture.headers ?? {},
    chunks: [fixture.body],
  });
  assert.deepStrictEqual(body, fixture.body);
});
