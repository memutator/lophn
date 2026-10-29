import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  claudeCodeProfile,
  firstUserText,
  sealBody,
  versionSuffix,
} from "./claude-code.ts";

// 조사 명세의 synthetic vector다. compact JSON 674 byte, 사용자 글에도 `cch=00000`이 있다.
const USER_TEXT = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ cch=00000";
const BILLING =
  "x-anthropic-billing-header: cc_version=2.1.280.56c; cc_entrypoint=cli; cch=00000;";
const PLACEHOLDER = `{"model":"fixture-claude","messages":[{"role":"user","content":"${USER_TEXT}"}],"system":[{"type":"text","text":"${BILLING}"},{"type":"text","text":"You are Claude Code, Anthropic's official CLI for Claude.","cache_control":{"type":"ephemeral"}},{"type":"text","text":"Reply with one short sentence."}],"tools":[],"metadata":{"user_id":"{\\"device_id\\":\\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\",\\"session_id\\":\\"33333333-3333-4333-8333-333333333333\\",\\"account_uuid\\":\\"11111111-1111-4111-8111-111111111111\\"}"},"max_tokens":128,"stream":true}`;

test("cch는 host가 만든 billing slot 다섯 byte만 바꾸고 사용자 글의 같은 글자는 그대로 둔다", () => {
  assert.equal(new TextEncoder().encode(PLACEHOLDER).byteLength, 674);
  assert.equal(versionSuffix(USER_TEXT, "2.1.280"), "56c");
  const sealed = sealBody(PLACEHOLDER, BILLING);
  assert.ok(sealed !== null);
  assert.equal(
    createHash("sha256").update(sealed).digest("hex"),
    "1c2a6df4306ff0b3563e12b0f9ec833a2819a12f9456b9b01d094bfd3a1c7b6e",
  );
  assert.ok(sealed.includes(`"content":"${USER_TEXT}"`));
});

test("profile은 billing·identity를 system 앞에 두고 custom tool 이름에 `_`를 붙여 보낸 뒤 원래 이름으로 되돌린다", () => {
  const shape = claudeCodeProfile({
    provider: "pvd_00000000000000000000000001",
    account: {
      id: "11111111-1111-4111-8111-111111111111",
      email: null,
      organization_id: null,
      organization_name: null,
      project_id: null,
    },
    host: { os: "Linux", arch: "x64" },
    betas: "advanced-tool-use-2025-11-20",
  });
  const shaped = shape({
    endpoint: "https://api.anthropic.com/v1",
    session: "ses_01",
    body: {
      model: "claude-x",
      max_tokens: 1000,
      messages: [
        { role: "user", content: [{ type: "text", text: "hello there" }] },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "_local", input: {} }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
        },
      ],
      system: [{ type: "text", text: "harness prompt" }],
      tools: [
        { name: "_local", input_schema: { type: "object" } },
        { name: "read_file", input_schema: { type: "object" } },
      ],
      thinking: { type: "adaptive" },
    },
  });
  assert.ok(shaped !== null);
  const body = JSON.parse(shaped.body);
  const user = JSON.parse(body.metadata.user_id);
  assert.deepStrictEqual(
    {
      url: shaped.url,
      keys: Object.keys(body),
      system: body.system.map((block: { text: string }) => block.text),
      tools: body.tools.map((tool: { name: string }) => tool.name),
      used: body.messages[1].content[0].name,
      back: [shaped.toolName("__local"), shaped.toolName("_read_file")],
      session: user.session_id === shaped.headers["x-claude-code-session-id"],
      account: user.account_uuid,
      betas: shaped.headers["anthropic-beta"],
    },
    {
      url: "https://api.anthropic.com/v1/messages?beta=true",
      keys: [
        "model",
        "messages",
        "system",
        "tools",
        "metadata",
        "max_tokens",
        "thinking",
        "stream",
      ],
      system: [
        body.system[0].text,
        "You are Claude Code, Anthropic's official CLI for Claude.",
        "harness prompt",
      ],
      tools: ["__local", "_read_file"],
      used: "__local",
      back: ["_local", "read_file"],
      session: true,
      account: "11111111-1111-4111-8111-111111111111",
      betas:
        "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,advanced-tool-use-2025-11-20",
    },
  );
  assert.match(
    body.system[0].text,
    new RegExp(
      `^x-anthropic-billing-header: cc_version=2\\.1\\.280\\.${versionSuffix(firstUserText(body.messages), "2.1.280")}; cc_entrypoint=cli; cch=[0-9a-f]{5};$`,
    ),
  );
});
