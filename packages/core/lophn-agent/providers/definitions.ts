import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type ProviderDefinition,
  providerDefinitions,
} from "../../../protocol/lophn-agent/mod.ts";
import type { ApiReadDefinition } from "../../../protocol/server/mod.ts";
import { providerDefinitionSchema } from "../../../protocol/lophn-agent/mod.ts";

// lophn이 알아두는 연결 가능 provider의 내장 정의. ledger row가
// 아니라 product catalog 값이라 module 동봉 JSON으로 둔다. core graph의 동기
// file API는 platform/responsiveness 검사가 막으므로 module import로 읽는다.
import definitionsJson from "./definitions.json" with { type: "json" };

const definitions: ProviderDefinition[] = (definitionsJson as unknown[])
  .map((entry) => providerDefinitionSchema.safeParse(entry))
  .filter((parsed) => parsed.success)
  .map((parsed) => parsed.data);

export function createProviderDefinitionsRead(): ApiReadDefinition<
  typeof providerDefinitions
> {
  return {
    route: providerDefinitions,
    handle() {
      return ok({ definitions: definitions });
    },
  };
}

export function builtinProviderDefinition(
  key: string,
): Result<ProviderDefinition> {
  const found = definitions.find((definition) => definition.key === key);
  if (found === undefined) {
    return err({
      code: "invalid_input",
      message: `unknown built-in provider definition: ${key}`,
    });
  }
  return ok(found);
}

// defer_loading과 tool_reference를 받는 model이다(Anthropic 문서 Tool search tool의 Model compatibility):
// Haiku·Sonnet·Opus 4.5 이상, 5 세대, Fable, Mythos. built-in anthropic 정의에서만 켠다: custom provider는 protocol이
// anthropic-messages여도 proxy가 이 칸을 모를 수 있어 key가 달라 꺼진다. ProviderDefinition은 strict 계약이라 칸을
// 더하지 않고 여기에 둔다.
const CLAUDE_VERSIONED =
  /^claude-(?:haiku|sonnet|opus)-(\d+)(?:[-.](\d{1,2}))?(?:-\d{8})?$/;
const CLAUDE_NAMED = /^claude-(?:fable|mythos)(?:-|$)/;

export function supportsDeferredTools(
  definitionKey: string,
  modelName: string,
): boolean {
  if (definitionKey !== "anthropic") return false;
  if (CLAUDE_NAMED.test(modelName)) return true;
  const match = CLAUDE_VERSIONED.exec(modelName);
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return major >= 5 || (major === 4 && minor >= 5);
}
