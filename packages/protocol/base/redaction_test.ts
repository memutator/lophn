import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import {
  createKnownSecretRegistry,
  createRedactionEngine,
  type RedactionInput,
} from "../../base/redaction/mod.ts";
import {
  DATA_SERIALIZER_PORT,
  type DataSerializer,
  fieldPathSchema,
  REDACTION_CHECK_OP,
  REDACTION_PIPE_OPS,
  redactionCheck,
  redactionFieldDeclarationSchema,
  redactionInputSchema,
  redactionResultSchema,
  redactionRulesSchema,
  type Redactor,
  REDACTOR_PORT,
  trustClassSchema,
} from "./redaction.ts";

const source = { concern: "problems/snapshots", revision: "1", scope: "app" };

const input = {
  source,
  media_type: "application/json",
  audience: "external" as const,
  safe_fields: ["code", "items[0].name"],
  private_fields: ["token"],
};

const passed = {
  rule_revision: "rules-1",
  status: "passed" as const,
  content: { kind: "inline" as const, value: '{"code":"ok"}' },
  redacted_items: [{ location: "token" }],
  omissions: [],
};

Deno.test("platform/redaction#R2 platform/redaction#R6 platform/redaction#R14: redaction.check 이름은 architecture 5.8과 같다", () => {
  assertEquals(
    REDACTION_PIPE_OPS.map((op) => [op.kind, op.name, op.method]),
    [["worker", "redaction.check", "check"]],
  );
  assertEquals(REDACTION_CHECK_OP, "redaction.check");
  assertEquals(redactionCheck.resource, "redaction");
  assertEquals(
    redactionRulesSchema.parse({
      revision: "rules-1",
      replacement: "*",
      pattern_revision: "gitleaks-1",
    }).replacement,
    "*",
  );
  for (const code of redactionCheck.errors) assert(ERROR_CODES.includes(code));
  assertEquals([...redactionCheck.errors], ["invalid_input", "unavailable"]);
});

Deno.test("platform/redaction#R8 platform/redaction#R10 platform/redaction#R12: 예시 입력이 통과하고 결과는 원문 없는 위치만 담는다", () => {
  assertEquals(redactionInputSchema.parse(input), input);
  assertEquals(redactionResultSchema.parse(passed), passed);
  const partial = redactionResultSchema.parse({
    ...passed,
    status: "partial",
    omissions: [{
      location: "stack",
      reason: "limit_exceeded",
      message: "omitted",
    }],
  });
  assertEquals(partial.omissions.length, 1);
  const omitted = redactionResultSchema.parse({
    rule_revision: "rules-1",
    status: "omitted",
    content: null,
    redacted_items: [],
    omissions: [{
      location: "body",
      reason: "unsupported_media",
      message: "omitted",
    }],
  });
  assertEquals(omitted.content, null);
  assert(
    redactionResultSchema.safeParse({
      ...passed,
      content: { kind: "blob", hash: "ab".repeat(32) },
    }).success,
  );
});

Deno.test("platform/redaction#R11 platform/redaction#R14: 모르는 field·틀린 audience·wildcard 경로·틀린 결과를 거절한다", () => {
  for (
    const invalid of [
      { ...input, raw: "secret" },
      { ...input, audience: "log" },
      { ...input, media_type: "" },
      { ...input, safe_fields: ["*"] },
      { ...input, safe_fields: ["items.*.name"] },
      { ...input, private_fields: ["token.*"] },
      { ...input, safe_fields: ["token", "token"] },
      { ...input, private_regions: [] },
      { source: { concern: "problems" } },
    ]
  ) assert(!redactionInputSchema.safeParse(invalid).success);

  assert(!fieldPathSchema.safeParse("*").success);
  assert(!fieldPathSchema.safeParse("a.*.b").success);
  assert(fieldPathSchema.safeParse("items[0].name").success);

  assert(
    !redactionFieldDeclarationSchema.safeParse({
      safe_fields: ["code"],
      private_fields: [],
      sample_paths: ["*"],
    }).success,
  );
  assert(
    redactionFieldDeclarationSchema.safeParse({
      safe_fields: ["code"],
      private_fields: [],
      sample_paths: ["rows[0].id"],
    }).success,
  );

  for (
    const invalid of [
      { ...passed, status: "omitted", content: passed.content },
      { ...passed, status: "partial", omissions: [] },
      { ...passed, content: { kind: "inline" } },
    ]
  ) assert(!redactionResultSchema.safeParse(invalid).success);

  assert(
    !redactionRulesSchema.safeParse({
      revision: "rules-1",
      replacement: "**",
      pattern_revision: "gitleaks-1",
    }).success,
  );
  assert(!trustClassSchema.safeParse("instruction").success);
  assertEquals(trustClassSchema.parse("data"), "data");
});

Deno.test("platform/redaction#R15 platform/security#R10: Redactor와 data 직렬화는 entry가 끼우는 검사 함수다", () => {
  const redactor: Redactor = () => passed;
  const serializer: DataSerializer = (value) =>
    JSON.stringify({ trust: value.trust, text: value.text });
  assertEquals(REDACTOR_PORT.name, "redaction.redactor");
  assertEquals(DATA_SERIALIZER_PORT.name, "redaction.data_serializer");
  assertEquals(redactor(input), passed);
  assertEquals(
    serializer({ trust: "data", text: "close]]", source: "doc" }).includes(
      "data",
    ),
    true,
  );
});

Deno.test("base redaction engine이 내는 결과는 redactionResultSchema를 지난다", async () => {
  const secret = "sk-openaiKeyValue1234567890abcd";
  const registry = createKnownSecretRegistry();
  registry.register(["session-secret"]);
  const engine = createRedactionEngine({ registry });
  const engineInput = (scope: string): RedactionInput => ({
    source: { concern: "lophn-agent/conversation", revision: "1", scope },
    media_type: "text/plain",
    audience: "model",
    safe_fields: [],
    private_fields: [],
  });
  const redacted = await engine.redact(
    engineInput("conversation"),
    `see ${secret} now`,
  );
  assert(redactionResultSchema.safeParse(redacted).success);
  const omitted = await engine.redact(
    engineInput("session_input"),
    "store session-secret at the end",
  );
  assertEquals(omitted.status, "omitted");
  assert(redactionResultSchema.safeParse(omitted).success);
  const structured = await engine.redact(
    {
      ...engineInput("record"),
      media_type: "application/json",
      audience: "display",
      safe_fields: ["note"],
    },
    JSON.stringify({ note: `see ${secret} now` }),
  );
  assert(redactionResultSchema.safeParse(structured).success);
});
