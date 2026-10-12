// lophn-agent/harness/provider#R1, R2: 내장 provider 정의. ledger가 없어도
// product catalog 값으로 답한다(core api read 길이).
import { assert, assertEquals } from "@std/assert";
import {
  providerDefinitions,
  providerDefinitionSchema,
} from "../../../contracts/lophn-agent/mod.ts";
import {
  builtinProviderDefinition,
  builtinProviderDefinitions,
  createProviderDefinitionsRead,
} from "./mod.ts";

const API_KEYS = [
  "anthropic",
  "openrouter",
  "groq",
  "deepseek",
  "google-gemini",
];

Deno.test("lophn-agent/harness/provider#R1: 내장 정의는 지원 대상 전체를 담고 schema로 검증된다", () => {
  const definitions = builtinProviderDefinitions();
  assertEquals(definitions.length, 7);
  for (const definition of definitions) {
    assert(providerDefinitionSchema.safeParse(definition).success);
  }
  assertEquals(definitions.map((definition) => definition.key), [
    "anthropic",
    "openai",
    "xai",
    "openrouter",
    "groq",
    "deepseek",
    "google-gemini",
  ]);
  assertEquals(
    definitions.map((definition) => definition.revision),
    Array
      .from({ length: 7 }, () => "2026-10"),
  );
});

Deno.test("lophn-agent/harness/provider#R1: R1 첫 판의 인증 방식과 OAuth 검증 상태를 그대로 담는다", () => {
  const definitions = builtinProviderDefinitions();
  const byKey = new Map(definitions.map((d) => [d.key, d]));
  // API key provider들.
  for (const key of API_KEYS) {
    assert(byKey.has(key));
    assertEquals(byKey.get(key)!.auth_kinds, ["api_key"]);
    assertEquals(byKey.get(key)!.oauth, null);
  }
  // OAuth는 검증되지 않은 경로다(R1). lophn 이름의 실제 사용이 확인되기 전까지
  // 비활성화한다는 표시는 verified_for_lophn false로 남는다.
  const openai = byKey.get("openai")!;
  assertEquals(openai.auth_kinds, ["api_key", "oauth"]);
  assertEquals(openai.oauth!.product, "chatgpt");
  assertEquals(openai.oauth!.verified_for_lophn, false);
  const xai = byKey.get("xai")!;
  assertEquals(xai.auth_kinds, ["api_key", "oauth"]);
  assertEquals(xai.oauth!.product, "supergrok");
  assertEquals(xai.oauth!.verified_for_lophn, false);
  // 내장 정의에는 로컬 서버도 인증 없음도 없다. 로컬은 custom provider의 loopback으로만 연결한다(R1, R5).
  for (const key of ["ollama", "lm-studio", "llama-cpp"]) {
    assert(!byKey.has(key), key);
    assertEquals(builtinProviderDefinition(key).ok, false, key);
  }
  for (const definition of definitions) {
    assert(!definition.auth_kinds.includes("none"), definition.key);
  }
});

Deno.test("lophn-agent/harness/provider#R2: 정의는 호출 형식(R3)과 인증 방식을 담는다", () => {
  const byKey = new Map(
    builtinProviderDefinitions().map(
      (definition) => [definition.key, definition],
    ),
  );
  // Anthropic Messages 하나뿐(R3).
  assertEquals(byKey.get("anthropic")!.protocols, ["anthropic-messages"]);
  // Google Gemini는 네이티브 형식 없이 Chat Completions 호환 연결이다(R3).
  assertEquals(byKey.get("google-gemini")!.protocols, [
    "openai-chat-completions",
  ]);
  // OpenAI는 Responses와 Chat Completions 모두다.
  const openai = byKey.get("openai")!;
  assert(openai.protocols.includes("openai-responses"));
  assert(openai.protocols.includes("openai-chat-completions"));
  // OpenAPI 원격 provider는 model 목록 조회 목적지를 정의한다(R2).
  for (const key of API_KEYS) {
    assert(byKey.get(key)!.models_endpoint !== null);
  }
});

Deno.test("lophn-agent/harness/provider#R2: read handler는 ledger 없이 정의 목록으로 답한다", async () => {
  const handler = createProviderDefinitionsRead();
  assertEquals(handler.route, providerDefinitions);
  const answered = await handler.handle({} as never, {});
  assert(answered.ok, answered.ok ? undefined : answered.error.code);
  assertEquals(answered.value.definitions.length, 7);
});

Deno.test("lophn-agent/harness/provider#R2: 모르는 내장 정의 key는 invalid_input이다", () => {
  const result = builtinProviderDefinition("not-a-provider");
  assert(!result.ok);
  assertEquals(result.error.code, "invalid_input");
});
