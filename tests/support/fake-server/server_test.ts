// fake server 자기 점검. 세 질문의 답:
// - contract: boundary `models`(provider에 보내는 요청과 받는 stream 모양). fake가 실제 모양과 어긋나면 core E2E가 헛걸음이다.
// - 현실적 회귀: fake가 adapter가 읽는 event와 어긋나 E2E가 애매하게 실패하는 것, journal이 비어 "model 요청이 안 갔다"를 못 잡는 것.
// - 왜 지금 test로 못 잡나: 쓰이는 fake가 없다. 이 server가 생긴 뒤에야 adapter parser로 견줄 수 있다.
//
// 함수 대답과 줄 (reply-fn):
// - contract: boundary `models`. 함수 대답이 앞 tool 결과의 id를 이어 쓰고 줄이 agent별 대답을 가려야 core E2E가 헛걸음하지 않는다.
// - 현실적 회귀: 함수가 던져 server가 죽거나 test가 hang하는 것, 줄 구분이 흔들려 한 agent가 다른 agent의 대답을 받는 것, 줄 추가가 기본 줄 동작을 바꾸는 것.
// - 왜 지금 test로 못 잡나: 위 첫 test는 값 대답과 queue 하나만 본다.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyFrames,
  createStreamResult,
  judge,
} from "../../../packages/core/lophn-agent/providers/adapters/messages.ts";
import { createSseParser } from "../../../packages/core/lophn-agent/providers/adapters/stream.ts";
import { createFakeHandler, type Reply } from "./mod.ts";
import { idIn, lastToolResult, toolNames } from "./probe.ts";

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

test("fake server 응답을 adapter parser가 제 모양대로 판정한다", async () => {
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

  assert.deepStrictEqual(
    [text.verdict, text.text, tool.verdict, tool.tools[0]?.args],
    ["complete", "안녕", "complete", args],
  );
  assert.deepStrictEqual(
    [cut.verdict, empty.response.status, empty.fake.journal()[0]?.mismatch],
    ["partial", 400, "no scripted reply left for request 1"],
  );
});

function post(
  fake: ReturnType<typeof createFakeHandler>,
  body: Record<string, unknown>,
) {
  return fake.handle(
    new Request("http://fake/messages", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

test("함수 대답은 앞 tool 결과의 id를 잇고, 줄은 대답을 가르고, 던진 함수는 400이다", async () => {
  const ticket = "tkt_0123456789abcdefghjkmnpqrs";
  const fake = createFakeHandler();
  fake.script([{
    reply: (request) => {
      const id = idIn(lastToolResult(request) ?? "", "tkt");
      return {
        kind: "tool",
        calls: [{
          id: "toolu_2",
          name: "ticket_get",
          arguments: JSON.stringify({ id }),
        }],
      };
    },
  }]);
  fake.script([{ reply: { kind: "text", text: "pm" } }], {
    name: "pm",
    match: (request) => toolNames(request).includes("operator_create"),
  });
  fake.script([{ reply: { kind: "text", text: "engineer" } }], {
    name: "engineer",
    match: (request) => toolNames(request).includes("ticket_create"),
  });
  const result = (content: string) => ({
    messages: [{
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content }],
    }],
  });

  // 요청 순서가 줄 등록 순서와 달라도 각 줄의 대답을 받는다.
  await post(fake, { tools: [{ name: "ticket_create" }] });
  await post(fake, { tools: [{ name: "operator_create" }] });
  const chained = await read(await post(fake, result(`created ${ticket}`)));

  fake.script([{
    reply: () => {
      throw new Error("boom");
    },
  }]);
  const threw = await post(fake, {});

  assert.deepStrictEqual(
    [
      fake.journal().slice(0, 3).map((e) => [e.lane, e.step]),
      chained.tools[0]?.args,
      threw.status,
      fake.journal()[3]?.mismatch,
    ],
    [
      [["engineer", 0], ["pm", 0], [null, 0]],
      JSON.stringify({ id: ticket }),
      400,
      "reply function threw: boom",
    ],
  );
});
