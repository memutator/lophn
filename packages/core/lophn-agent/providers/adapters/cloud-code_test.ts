import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyCloudCodeFrames,
  buildCloudCodeRequest,
  cloudCodeShape,
  createCloudCodeStreamResult,
  judgeCloudCode,
} from "./cloud-code.ts";
import { createSseParser } from "./stream.ts";

// 조사 명세의 synthetic stream이다: thinking, 서명만 있는 조각, 두 functionCall, finish와 usage.
const STREAM = `: synthetic heartbeat

data: {"response":{"responseId":"fixture-response-1","candidates":[{"content":{"role":"model","parts":[{"text":"I will read two files.","thought":true}]}}]}}

data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"","thoughtSignature":"c3ludGhldGljLXNpZ25hdHVyZQ=="}]}}]}}

data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"read_file","args":{"path":"a.txt"},"id":"call-a"},"thoughtSignature":"c3ludGhldGljLXNpZ25hdHVyZQ=="},{"functionCall":{"name":"read_file","args":{"path":"b.txt"},"id":"call-b"}}]}}]}}

data: {"response":{"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":3,"thoughtsTokenCount":2,"cachedContentTokenCount":4,"totalTokenCount":17}}}

`;

function collect(text: string, split: number) {
  const bytes = new TextEncoder().encode(text);
  const parser = createSseParser();
  const out = createCloudCodeStreamResult();
  // TCP chunk 경계는 event 경계와 같지 않다.
  for (let at = 0; at < bytes.length; at += split) {
    const pushed = parser.push(bytes.subarray(at, at + split));
    assert.ok(pushed.ok);
    applyCloudCodeFrames(out, pushed.frames);
  }
  return { out, verdict: judgeCloudCode(out) };
}

test("stream은 잘린 chunk에서도 thinking·두 tool call·usage를 한 번씩 모으고 finishReason 없이 끝나면 완성이 아니다", () => {
  const { out, verdict } = collect(STREAM, 7);
  assert.deepStrictEqual(
    {
      kind: verdict.kind,
      reasoning: out.reasoning,
      text: out.text,
      calls: out.toolCalls,
      usage: [
        out.usage?.input,
        out.usage?.output,
        out.usage?.cache_read,
        out.usage?.reasoning,
      ],
    },
    {
      kind: "complete",
      reasoning: "I will read two files.",
      text: "",
      calls: [
        {
          id: "call-a",
          name: "read_file",
          args: '{"path":"a.txt"}',
          signature: "c3ludGhldGljLXNpZ25hdHVyZQ==",
        },
        { id: "call-b", name: "read_file", args: '{"path":"b.txt"}' },
      ],
      usage: [8, 5, 4, 2],
    },
  );
  const cut = STREAM.slice(
    0,
    STREAM.indexOf('data: {"response":{"candidates":[{"finishReason"'),
  );
  assert.equal(collect(cut, 64).verdict.kind, "partial");
});

test("병렬 tool 결과는 역순으로 와도 call 순서대로 한 user turn에 모이고 envelope는 정한 자리에 값을 둔다", () => {
  const body = buildCloudCodeRequest({
    model: "gemini-fixture",
    system: "Answer concisely.",
    images: false,
    tools: [
      {
        name: "read_file",
        description: "Read one file",
        input_schema: {
          type: "object",
          properties: { path: { type: ["string", "null"] } },
          required: ["path"],
          additionalProperties: false,
        },
      },
    ],
    messages: [
      { role: "user", parts: [{ kind: "text", text: "Read a.txt and b.txt" }] },
      {
        role: "assistant",
        parts: [
          {
            kind: "tool_use",
            id: "call-a",
            name: "read_file",
            input: { path: "a.txt" },
            signature: "c2lnLWE=",
          },
          {
            kind: "tool_use",
            id: "call-b",
            name: "read_file",
            input: { path: "b.txt" },
          },
        ],
      },
      {
        role: "user",
        parts: [
          { kind: "tool_result", id: "call-b", text: "beta" },
          { kind: "tool_result", id: "call-a", text: "alpha" },
        ],
      },
    ],
  });
  const shaped = cloudCodeShape({
    project: "fixture-project",
    model: "gemini-fixture",
    userAgent: "antigravity/hub/test",
    nowMs: () => 1_793_232_000_000,
  })({
    endpoint: "https://daily-cloudcode-pa.googleapis.com",
    session: "ses_01",
    body,
  });
  const sent = JSON.parse(shaped.body);
  const [user, model, results] = sent.request.contents;
  assert.deepStrictEqual(
    {
      url: shaped.url,
      top: Object.keys(sent),
      inner: Object.keys(sent.request),
      user,
      signatures: model.parts.map(
        (part: { thoughtSignature?: string }) => part.thoughtSignature ?? null,
      ),
      results: results.parts,
      parameters: sent.request.tools[0].functionDeclarations[0].parameters,
      gemini: [
        sent.request.labels.used_claude,
        sent.request.labels.used_non_gemini_model,
      ],
    },
    {
      url: "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse",
      top: ["project", "requestId", "request", "model", "userAgent"],
      inner: [
        "contents",
        "systemInstruction",
        "tools",
        "toolConfig",
        "labels",
        "sessionId",
      ],
      user: { role: "user", parts: [{ text: "Read a.txt and b.txt" }] },
      // 받은 서명은 그대로 돌려보내고, 서명 없는 뒤 call에는 아무것도 달지 않는다.
      signatures: ["c2lnLWE=", null],
      results: [
        {
          functionResponse: {
            name: "read_file",
            response: { output: "alpha" },
            id: "call-a",
          },
        },
        {
          functionResponse: {
            name: "read_file",
            response: { output: "beta" },
            id: "call-b",
          },
        },
      ],
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      gemini: ["false", "false"],
    },
  );
  assert.match(
    sent.requestId,
    /^agent\/[0-9a-f-]{36}\/1793232000000\/[0-9a-f-]{36}\/3$/,
  );
  assert.match(sent.request.sessionId, /^-\d+$/);
});
