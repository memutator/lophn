import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../base/mod.ts";
import {
  REDACTION_REPLACEMENT,
  type RedactionInput,
  redactionResultSchema,
} from "../../protocol/platform/mod.ts";
import { createRedactionEngine } from "./mod.ts";
import { patternRevision } from "./patterns.ts";
import { createKnownSecretRegistry } from "./registry.ts";

const PEM = [
  "-----BEGIN PRIVATE KEY-----",
  "MIIBVwIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEA",
  "-----END PRIVATE KEY-----",
].join("\n");

const FIXTURES = {
  openai: "sk-openaiKeyValue1234567890abcd",
  anthropic: "sk-ant-anthropicKeyValue1234567890",
  github: "ghp_githubKeyValue1234567890abcd",
  aws: "AKIAIOSFODNN7EXAMPLE",
  slack: "xoxb-slackKeyValue1234567890",
  jwt:
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
  pem: PEM,
};

function input(scope: string, media = "text/plain"): RedactionInput {
  return {
    source: { concern: "lophn-agent/conversation", revision: "1", scope },
    media_type: media,
    audience: "model",
    safe_fields: [],
    private_fields: [],
  };
}

function body(
  result: { content: { kind: string; value?: string } | null },
): string {
  assert(result.content?.kind === "inline");
  return result.content.value ?? "";
}

Deno.test("R1 1자·2자·겹치는 값·65개 이상을 긴 값부터 정확히 지우고 재등록 전 메모리는 비운다", async () => {
  const registry = createKnownSecretRegistry();
  const engine = createRedactionEngine({ registry });
  const short = ["a", "ab", "secret-value", "secret"];
  const many = Array.from({ length: 65 }, (_, index) => `known-${index}-token`);
  registry.register([...short, ...many]);
  assertEquals(registry.count, short.length + many.length);

  const text = `prefix a ab secret-value ${many[3]} ${many[64]} secret tail`;
  const result = await engine.redact(input("tool_result"), text);
  const value = body(result);
  assert(!value.includes("secret-value"));
  assert(!value.includes(many[3]));
  assert(!value.includes(many[64]));
  assertEquals(value.includes(REDACTION_REPLACEMENT), true);
  // 긴 값이 먼저 지워진 뒤 남은 짧은 값도 남기지 않는다.
  assert(!value.includes("secret"));
  assert(value.includes("prefix"));
  assert(value.includes("tail"));

  registry.clear();
  assertEquals(registry.count, 0);
  const afterRestart = await engine.redact(
    input("tool_result"),
    "secret-value",
  );
  assert(body(afterRestart).includes("secret-value"));
  registry.register(["secret-value"]);
  const reregistered = await engine.redact(
    input("tool_result"),
    "secret-value",
  );
  assert(!body(reregistered).includes("secret-value"));
});

Deno.test("R1 회수한 값은 그 순간부터 알려진 값이 아니고 남은 값은 그대로 지운다", async () => {
  const registry = createKnownSecretRegistry();
  const engine = createRedactionEngine({ registry });
  registry.register(["old-secret-value-longer", "other-known-value"]);
  assertEquals(registry.maxLength, "old-secret-value-longer".length);
  registry.revoke(["old-secret-value-longer", "never-registered"]);
  assertEquals(registry.count, 1);
  assertEquals(registry.maxLength, "other-known-value".length);
  assertEquals(registry.match("x old-secret-value-longer y"), undefined);
  const result = await engine.redact(
    input("tool_result"),
    "old-secret-value-longer and other-known-value",
  );
  const value = body(result);
  assert(value.includes("old-secret-value-longer"));
  assert(!value.includes("other-known-value"));
  // 회수한 뒤 다시 등록하면 다시 알려진 값이다.
  registry.register(["old-secret-value-longer"]);
  assertEquals(registry.count, 2);
  assert(registry.match("x old-secret-value-longer y") !== undefined);
});

Deno.test("R2 OpenAI·Anthropic·GitHub·AWS·Slack key·JWT·PEM은 입력과 출력이 같은 규칙 hash로 검출한다", async () => {
  const registry = createKnownSecretRegistry();
  const engine = createRedactionEngine({ registry });
  const revision = await patternRevision();
  assertEquals(revision.length, 64);

  for (const secret of Object.values(FIXTURES)) {
    const inbound = await engine.redact(
      input("session_input"),
      `note ${secret} end`,
    );
    const outbound = await engine.redact(
      input("tool_result"),
      `note ${secret} end`,
    );
    assertEquals(inbound.rule_revision, revision);
    assertEquals(outbound.rule_revision, revision);
    assertEquals(inbound.status, "omitted");
    assertEquals(inbound.content, null);
    assert(!JSON.stringify(inbound).includes(secret));
    assert(inbound.omissions[0]?.message.includes("protected secret input"));
    assert(!body(outbound).includes(secret));
    assert(body(outbound).includes(REDACTION_REPLACEMENT));
  }
});

Deno.test("R3 R6 Authorization·Cookie·URL 인증·JSON secret token password credential은 중첩과 오류에서도 * 하나로 지운다", async () => {
  const registry = createKnownSecretRegistry();
  const engine = createRedactionEngine({ registry });
  const payload = {
    headers:
      "Authorization: Bearer random-token-value\nCookie: session=random-cookie",
    url:
      "https://user:random-password@example.test/path?token=random-query&ok=1",
    nested: [{
      secret: "not-a-known-value",
      items: [{ token: "another", password: "pw", credential: "cred" }],
    }],
    error: { message: "failed Authorization: raw-error-secret" },
    keep: "visible",
  };
  const result = await engine.redact(
    input("tool_result", "application/json"),
    JSON.stringify(payload),
  );
  const value = body(result);
  for (
    const leaked of [
      "random-token-value",
      "random-cookie",
      "random-password",
      "random-query",
      "not-a-known-value",
      "another",
      "raw-error-secret",
      '"pw"',
      '"cred"',
    ]
  ) {
    assert(!value.includes(leaked), leaked);
  }
  assert(value.includes("visible"));
  assert(value.includes('"secret":"*"'));
  assert(value.includes('"token":"*"'));
  assert(value.includes('"password":"*"'));
  assert(value.includes('"credential":"*"'));
  assert(!value.includes("**"));
  assertEquals(
    result.redacted_items.every((item) => !("length" in item)),
    true,
  );
});

Deno.test("R4 세션 입력과 질문 답에서 secret이면 전체 제출을 막고 보호 입력 안내만 남긴다", async () => {
  const registry = createKnownSecretRegistry();
  registry.register(["session-secret"]);
  const engine = createRedactionEngine({ registry });
  for (const scope of ["session_input", "question_answer"]) {
    const result = await engine.redact(
      input(scope),
      "please store session-secret at the end",
    );
    assertEquals(result.status, "omitted");
    assertEquals(result.content, null);
    assert(redactionResultSchema.safeParse(result).success);
    const guidance = result.omissions[0]?.message ?? "";
    assert(guidance.includes("protected secret input"));
    assertEquals(result.omissions[0]?.reason, "secret_detected");
    assert(!JSON.stringify(result).includes("session-secret"));
  }
  const stored = await engine.redact(
    input("tool_result"),
    "please store session-secret",
  );
  assert(body(stored).includes("please store"));
  assert(!body(stored).includes("session-secret"));
});

Deno.test("R14 1MiB·깊이 16·4096 항목·5초를 넘거나 불확실하면 원문 없이 omission만 남긴다", async () => {
  const registry = createKnownSecretRegistry();
  const clock = manualClock(0);
  const engine = createRedactionEngine({
    registry,
    clock,
    limits: { maxBytes: 8, maxDepth: 1, maxItems: 2, timeoutMs: 5 },
  });
  const big = await engine.redact(input("tool_result"), "0123456789");
  assertEquals(big.status, "omitted");
  assertEquals(big.content, null);
  assertEquals(big.omissions[0]?.reason, "limit_exceeded");
  assert(!JSON.stringify(big).includes("0123456789"));

  const deep = await createRedactionEngine({
    registry,
    limits: { maxDepth: 1 },
  }).redact(
    input("tool_result", "application/json"),
    JSON.stringify({ a: { b: 1 } }),
  );
  assertEquals(deep.content, null);
  assertEquals(deep.omissions[0]?.reason, "limit_exceeded");

  const wide = await createRedactionEngine({
    registry,
    limits: { maxItems: 2 },
  }).redact(
    input("tool_result", "application/json"),
    JSON.stringify({ a: 1, b: 2, c: 3 }),
  );
  assertEquals(wide.content, null);

  let calls = 0;
  const slow = createRedactionEngine({
    registry,
    clock: {
      now: () => clock.now(),
      nowMs: () => calls++ === 0 ? 0 : 10_000,
    },
    limits: { timeoutMs: 5 },
  });
  const timed = await slow.redact(input("tool_result"), "plain text");
  assertEquals(timed.content, null);
  assertEquals(timed.omissions[0]?.reason, "redaction_failed");
  assert(!JSON.stringify(timed).includes("plain text"));

  const broken = await createRedactionEngine({ registry }).redact(
    input("tool_result", "application/json"),
    "{not json",
  );
  assertEquals(broken.content, null);
  assertEquals(broken.omissions[0]?.reason, "uncertain");
  assert(!JSON.stringify(broken).includes("not json"));
});

Deno.test("R16 저장 때 redaction한 자료도 반환 전 현재 규칙으로 다시 검사한다", async () => {
  const registry = createKnownSecretRegistry();
  const engine = createRedactionEngine({ registry });
  const stored = await engine.redact(input("storage"), "older text");
  assert(body(stored).includes("older text"));

  registry.register(["older"]);
  const again = await engine.recheck(input("model"), body(stored));
  assertEquals(again.rule_revision, stored.rule_revision);
  assert(!body(again).includes("older"));
  assert(body(again).includes("text"));
});

Deno.test("R17 삭제·차단 감사에 값·hash·일부를 남기지 않는다", () => {
  const registry = createKnownSecretRegistry();
  const engine = createRedactionEngine({ registry });
  const secret = "audit-secret-value";
  const omission = engine.auditBlock("blob");
  const encoded = JSON.stringify(omission);
  assert(!encoded.includes(secret));
  assert(!encoded.includes("audit-secret"));
  assert(!encoded.includes("sha256"));
  assertEquals(omission.reason, "secret_detected");
  assert(!("value" in omission));
  assert(!("hash" in omission));
});
