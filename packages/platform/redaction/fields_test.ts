import { assert, assertEquals } from "@std/assert";
import {
  REDACTION_REPLACEMENT,
  REDACTION_SCREEN_STRING_MAX_CHARS,
  type RedactionInput,
  redactionResultSchema,
} from "../../protocol/platform/mod.ts";
import { createRedactionEngine } from "./engine.ts";
import {
  parseFieldDeclaration,
  pseudonym,
  PSEUDONYM_SCOPE,
  selectSafeFields,
} from "./fields.ts";
import { createKnownSecretRegistry } from "./registry.ts";
import { redactScreen, SCREEN_LONG_STRING } from "./screen.ts";

const EMAIL = "a@b.co";
const LONG = "x".repeat(REDACTION_SCREEN_STRING_MAX_CHARS);
const LONGER = "y".repeat(REDACTION_SCREEN_STRING_MAX_CHARS + 1);

function input(overrides: Partial<RedactionInput> = {}): RedactionInput {
  return {
    source: { concern: "problems/snapshots", revision: "1", scope: "app" },
    media_type: "application/json",
    audience: "external",
    safe_fields: ["code"],
    private_fields: ["token"],
    ...overrides,
  };
}

Deno.test("R7 결과와 표시 복사본에 가린 값의 type·길이·점 개수 필드가 없다", async () => {
  const engine = createRedactionEngine({
    registry: createKnownSecretRegistry(),
  });
  const secret = "sk-openaiKeyValue1234567890abcd";
  const result = await engine.redact(
    input({
      audience: "display",
      safe_fields: ["note"],
      private_fields: [],
    }),
    JSON.stringify({ note: `see ${secret} now` }),
  );
  assert(redactionResultSchema.safeParse(result).success);
  const encoded = JSON.stringify(result);
  assert(!encoded.includes(secret));
  assert(encoded.includes(REDACTION_REPLACEMENT));
  for (const item of result.redacted_items) {
    assertEquals(Object.keys(item), ["location"]);
    assert(!("type" in item));
    assert(!("length" in item));
    assert(!("dots" in item));
  }
  assert(!encoded.includes('"length"'));
  assert(!encoded.includes('"type"'));
  assert(!encoded.includes("..."));
});

Deno.test("R8 선언한 안전 필드만 남기고 미선언 값·이름·연락처·이메일·경로를 뺀다", async () => {
  const record = {
    code: "E_TIMEOUT",
    name: "Ada Lovelace",
    email: EMAIL,
    phone: "+1 202 555 0143",
    path: "/home/ada/notes.txt",
    nested: { note: "keep-me", extra: "drop-me" },
  };
  const selected = selectSafeFields(record, ["code", "nested.note"], ["email"]);
  assert(selected);
  assertEquals(selected.value, {
    code: "E_TIMEOUT",
    nested: { note: "keep-me" },
  });
  assertEquals(JSON.stringify(selected.value).includes(EMAIL), false);
  assertEquals(JSON.stringify(selected.value).includes("Ada"), false);
  assertEquals(JSON.stringify(selected.value).includes("/home/ada"), false);

  const engine = createRedactionEngine({
    registry: createKnownSecretRegistry(),
  });
  const result = await engine.redact(
    input({ safe_fields: ["code", "nested.note"], private_fields: ["email"] }),
    JSON.stringify(record),
  );
  assert(redactionResultSchema.safeParse(result).success);
  assert(result.content?.kind === "inline");
  const value = result.content.value;
  assert(value.includes("E_TIMEOUT"));
  assert(value.includes("keep-me"));
  assert(!value.includes(EMAIL));
  assert(!value.includes("Ada Lovelace"));
  assert(!value.includes("drop-me"));
  assert(!value.includes("/home/ada"));
});

Deno.test("R9 필드명 변경은 익명화가 아니고 가명 비교 범위는 같은 자료다", () => {
  const renamed = { user_alias: "Ada Lovelace", email: EMAIL };
  const selected = selectSafeFields(renamed, ["user_alias", "email"], []);
  assert(selected);
  const encoded = JSON.stringify(selected.value);
  // alias로 이름을 바꿔도 이름·이메일 키의 값은 남지 않는다.
  assert(!encoded.includes("Ada Lovelace"));
  assert(!encoded.includes(EMAIL));
  assertEquals(selected.value, {});

  const first = pseudonym(1);
  const second = pseudonym(2);
  assert(first !== second);
  assertEquals(PSEUDONYM_SCOPE, "record");
  assert(!first.includes("Ada"));
  assertEquals(first.length === second.length, true);

  const hidden = selectSafeFields(
    { person: { email: EMAIL, name: "Ada" } },
    ["code"],
    ["person"],
  );
  assert(hidden);
  assertEquals(hidden.value, {});
  assertEquals(JSON.stringify(hidden.value).includes("email"), false);

  const nested = selectSafeFields(
    { profile: { code: "ok", token: "tiny" } },
    ["profile"],
    ["profile.token"],
  );
  assert(nested);
  assertEquals(nested.value, {});
  assert(nested.dropped.includes("profile"));
});

Deno.test("R12 81자 문자열과 private 필드는 빼고 80자·짧은 이메일은 안전 검사에서 예외가 아니다", () => {
  const screen = {
    title: LONG,
    body: LONGER,
    email: "hidden-by-key",
    note: `ping ${EMAIL}`,
    token: "tiny",
  };
  const shaped = redactScreen(
    screen,
    ["title", "body", "email", "note", "token"],
    ["token"],
  );
  assert(shaped.ok);
  const value = shaped.value as Record<string, unknown>;
  assertEquals(value.title, LONG);
  // 81자는 원문 없이 안전 shape로 줄인다. 길이는 shape에 없다.
  assertEquals(value.body, SCREEN_LONG_STRING);
  assertEquals(JSON.stringify(value.body).includes("81"), false);
  assertEquals("email" in value, false);
  assertEquals("note" in value, false);
  assertEquals("token" in value, false);
  assert(shaped.omitted.includes("token"));
  assertEquals(shaped.omitted.includes("body"), false);
  assert(shaped.omitted.includes("note"));
  assert(!JSON.stringify(value).includes(EMAIL));
  assert(!JSON.stringify(value).includes(LONGER));
  assert(!JSON.stringify(value).includes("tiny"));
});

Deno.test("R11 단독·중간 wildcard 경로 선언은 거절하고 명시 경로만 받는다", () => {
  assertEquals(
    parseFieldDeclaration({
      safe_fields: ["*"],
      private_fields: [],
      sample_paths: ["code"],
    }),
    undefined,
  );
  assertEquals(
    parseFieldDeclaration({
      safe_fields: ["items.*.name"],
      private_fields: [],
      sample_paths: ["code"],
    }),
    undefined,
  );
  const parsed = parseFieldDeclaration({
    safe_fields: ["code"],
    private_fields: ["token"],
    sample_paths: ["rows[0].id"],
  });
  assert(parsed);
  assertEquals(parsed.sample_paths, ["rows[0].id"]);
  assertEquals(
    parseFieldDeclaration({
      safe_fields: ["token"],
      private_fields: ["token"],
      sample_paths: [],
    }),
    undefined,
  );
});
