import assert from "node:assert/strict";
import { test } from "node:test";
import { createProductRedactor } from "../../../base/redaction/mod.ts";
import { SHELL_TOOLS } from "./bundles/shell.ts";
import { toolCallDisplay } from "./display.ts";

const SECRET = "known-secret-value-0123456789";
const CREDENTIAL = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";

function known(secret: string, ready: boolean) {
  return {
    ready,
    match(text: string) {
      const index = text.indexOf(secret);
      return index < 0 ? undefined : { index, length: secret.length };
    },
  };
}

function redactorOf(secret: string, ready: boolean) {
  const redactor = createProductRedactor(known(secret, ready));
  return (text: string) =>
    redactor(
      { concern: "lophn-agent/tools", revision: "1", scope: "tool-title" },
      "text/plain",
      text,
    );
}

test("tool 제목에는 지금의 redaction이 가리는 secret이 나오지 않는다", async () => {
  const definition = SHELL_TOOLS[0]!;
  const redact = redactorOf(SECRET, true);
  const cases = [
    {
      name: "명령의 알려진 secret",
      input: { command: `curl -H "x-api-key: ${SECRET}" https://example.com` },
      hidden: SECRET,
    },
    {
      name: "description의 알려진 secret",
      input: {
        command: "curl https://example.com",
        description: `Send the ${SECRET} header`,
      },
      hidden: SECRET,
    },
    {
      // `curl ` 뒤 105자가 앞 110자가 되어 secret이 120자 경계에 걸친다. 자르기 전에 redaction하는지 본다.
      name: "120자 경계에 걸친 secret",
      input: {
        command: `curl ${"a".repeat(105)}${SECRET} https://example.com`,
      },
      hidden: SECRET,
      prefix: SECRET.slice(0, 8),
    },
    {
      name: "pattern으로 잡히는 credential",
      input: {
        command: `curl -H "x-api-key: ${CREDENTIAL}" https://example.com`,
      },
      hidden: CREDENTIAL,
    },
  ];
  for (const item of cases) {
    const display = await toolCallDisplay(
      definition,
      "shell.run",
      item.input,
      redact,
    );
    assert.ok(!display.title.includes(item.hidden), item.name);
    if (item.prefix !== undefined) {
      assert.ok(!display.title.includes(item.prefix), item.name);
    }
  }

  // 알려진 값을 아직 다 모르는 redactor는 원문을 내보내지 않고 tool 이름으로 답한다.
  assert.deepStrictEqual(
    await toolCallDisplay(
      definition,
      "shell.run",
      { command: `curl ${SECRET} https://example.com` },
      redactorOf(SECRET, false),
    ),
    { category: "other", title: "shell.run" },
  );
});
