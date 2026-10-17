// 세 질문
// - contract: boundary `models`. adapter가 낸 판정이 loop에 닿는 ModelOutcome과 실패 분류(PROVIDER_FAILURES).
// - 현실적 회귀: provider 응답 형식이 바뀌어 complete를 partial로 보거나 잘린 tool 인자를 실행 대상으로 내는 수정,
//   오류 분류 표를 손봐 retry할 것이 안 되고 안 할 것이 되는 수정.
// - 지금 못 잡는 이유: providers/의 adapter와 failures.ts에 test가 없다.

import { assert, assertEquals, assertObjectMatch } from "@std/assert";
import {
  callWire,
  loadFixture,
  replayFetch,
  wireBinding,
  type WireProtocol,
} from "../../support/wire/mod.ts";

type Row = {
  fixture: string;
  kind: "complete" | "partial" | "failed";
  code?: string;
  finish_reason?: string;
  tools?: 1;
  // 받은 글. true면 비어 있지 않다.
  text?: string | true;
  usage?: true;
};

const TABLE: Record<WireProtocol, { path: string; rows: Row[] }> = {
  "anthropic-messages": {
    path: "/messages",
    rows: [
      {
        fixture: "anthropic/text-end_turn",
        kind: "complete",
        text: true,
        usage: true,
      },
      {
        fixture: "anthropic/tool-use",
        kind: "complete",
        tools: 1,
        usage: true,
      },
      {
        fixture: "anthropic/max-tokens",
        kind: "partial",
        finish_reason: "max_tokens",
      },
      {
        fixture: "anthropic/cut-no-stop",
        kind: "partial",
        text: "Partial answer",
      },
      { fixture: "anthropic/tool-args-cut", kind: "partial" },
      { fixture: "anthropic/tool-args-not-json", kind: "partial" },
      { fixture: "anthropic/refusal", kind: "failed", code: "refused" },
      {
        fixture: "anthropic/error-overloaded",
        kind: "failed",
        code: "temporary",
      },
      // reset을 모르는 rate limit은 retry_at 없는 temporary다(loop 기본 대기).
      {
        fixture: "anthropic/error-rate-limit",
        kind: "failed",
        code: "temporary",
      },
      {
        fixture: "anthropic/error-authentication",
        kind: "failed",
        code: "credential_unavailable",
      },
    ],
  },
  "openai-responses": {
    path: "/responses",
    rows: [
      {
        fixture: "openai/responses-text",
        kind: "complete",
        text: true,
        usage: true,
      },
      {
        fixture: "openai/responses-tool",
        kind: "complete",
        tools: 1,
        usage: true,
      },
      { fixture: "openai/responses-incomplete-max-output", kind: "partial" },
      {
        fixture: "openai/responses-incomplete-content-filter",
        kind: "failed",
        code: "refused",
      },
      { fixture: "openai/responses-cut", kind: "partial" },
      { fixture: "openai/responses-tool-args-not-json", kind: "partial" },
      {
        fixture: "openai/responses-failed-overloaded",
        kind: "failed",
        code: "temporary",
      },
      {
        fixture: "openai/responses-failed-invalid-prompt",
        kind: "failed",
        code: "invalid_request",
      },
    ],
  },
  "openai-chat-completions": {
    path: "/chat/completions",
    rows: [
      {
        fixture: "openai/chat-text",
        kind: "complete",
        text: true,
        usage: true,
      },
      { fixture: "openai/chat-tool", kind: "complete", tools: 1, usage: true },
      { fixture: "openai/chat-length", kind: "partial" },
      {
        fixture: "openai/chat-content-filter",
        kind: "failed",
        code: "refused",
      },
      { fixture: "openai/chat-cut", kind: "partial" },
      { fixture: "openai/chat-tool-args-not-json", kind: "partial" },
    ],
  },
};

Deno.test("잘린 응답과 틀린 tool 인자는 실행 대상이 아니고 오류는 retry할 것과 안 할 것으로 갈린다", async (t) => {
  for (const [protocol, { path, rows }] of Object.entries(TABLE)) {
    const replay = replayFetch(...rows.map((row) => loadFixture(row.fixture)));
    const binding = await wireBinding(protocol as WireProtocol, replay.fetch);
    for (const row of rows) {
      await t.step(row.fixture, async () => {
        const out = await callWire(binding);
        assertObjectMatch(out.outcome, {
          kind: row.kind,
          code: row.code ?? null,
          ...(row.finish_reason === undefined
            ? {}
            : { finish_reason: row.finish_reason }),
          ...(row.code === "temporary" ? { retry_at: null } : {}),
        });
        // 완성이 아니면 tool은 실행 대상으로 나오지 않는다.
        assertEquals(out.toolCalls.length, row.tools ?? 0);
        if (row.tools === 1) {
          const args = JSON.parse(out.toolCalls[0].args);
          assert(typeof args === "object" && !Array.isArray(args));
        }
        if (row.text === true) assert(out.text.length > 0);
        else if (row.text !== undefined) assertEquals(out.text, row.text);
        if (row.usage) {
          assertEquals(typeof out.usage?.input, "number");
          assertEquals(typeof out.usage?.output, "number");
        }
      });
    }
    await t.step(`${protocol} 요청 모양`, () => {
      const request = replay.requests[0];
      assertEquals(new URL(request.url).pathname, path);
      assertEquals((request.body as { stream: unknown }).stream, true);
      assertEquals(
        Object.keys(request.headers).filter((name) =>
          name === "authorization" || name === "x-api-key"
        ),
        [],
      );
    });
  }
});
