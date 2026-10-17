// fake server 자기 점검. 세 질문의 답:
// - contract: boundary `models`(provider에 보내는 요청과 받는 stream 모양). fake가 실제 모양과 어긋나면 core E2E가 헛걸음이다.
// - 현실적 회귀: fake가 adapter가 읽는 event와 어긋나 E2E가 애매하게 실패하는 것, journal이 비어 "model 요청이 안 갔다"를 못 잡는 것.
// - 왜 지금 test로 못 잡나: 쓰이는 fake가 없다. 이 server가 생긴 뒤에야 adapter parser로 견줄 수 있다.

import { assertEquals } from "@std/assert";
import {
  applyFrames,
  createStreamResult,
  judge,
} from "../../../packages/core/lophn-agent/providers/adapters/messages.ts";
import { createSseParser } from "../../../packages/core/lophn-agent/providers/adapters/stream.ts";
import { createFakeHandler, type Reply } from "./mod.ts";

async function ask(reply: Reply | null) {
  const fake = createFakeHandler();
  fake.script(reply === null ? [] : [{ reply }]);
  const response = await fake.handle(
    new Request("http://fake/messages", {
      method: "POST",
      body: JSON.stringify({ stream: true }),
    }),
  );
  return { fake, response };
}

// 제품과 같은 parser로 stream을 끝까지 읽는다.
async function read(response: Response) {
  const parser = createSseParser();
  const out = createStreamResult();
  for await (const chunk of response.body!) {
    const pushed = parser.push(chunk);
    if (pushed.ok) applyFrames(out, pushed.frames);
  }
  return { verdict: judge(out).kind, text: out.text, tools: out.toolCalls };
}

Deno.test("fake server 응답을 adapter parser가 제 모양대로 판정한다", async () => {
  const text = await read((await ask({ kind: "text", text: "안녕" })).response);
  const args = '{"path":"a.txt"}';
  const tool = await read(
    (await ask({
      kind: "tool",
      calls: [{ id: "toolu_1", name: "read", arguments: args }],
    })).response,
  );
  const cut = await read(
    (await ask({ kind: "cut", partial: { text: "안" } })).response,
  );
  const empty = await ask(null);

  assertEquals(
    [text.verdict, text.text, tool.verdict, tool.tools[0]?.args],
    ["complete", "안녕", "complete", args],
  );
  assertEquals(
    [cut.verdict, empty.response.status, empty.fake.journal()[0]?.mismatch],
    ["partial", 400, "no scripted reply left for request 1"],
  );
});
