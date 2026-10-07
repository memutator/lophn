import { err, ok, type Result } from "../../../base/mod.ts";
import {
  providerDefinitions,
  type ProviderDefinition,
} from "../../../contracts/lophn-agent/mod.ts";
import type { ApiReadDefinition } from "../../../contracts/platform/mod.ts";
import { providerDefinitionSchema } from "../../../contracts/lophn-agent/mod.ts";

// lophn이 알아두는 연결 가능 provider의 내장 정의(provider#R1). ledger row가
// 아니라 product catalog 값이라 module 동봉 JSON으로 둔다. core graph의 동기
// file API는 platform/responsiveness#R1 검사가 막으므로 module import로 읽는다.
import definitionsJson from "./definitions.json" with { type: "json" };

const definitions: ProviderDefinition[] = (definitionsJson as unknown[])
  .map((entry) => providerDefinitionSchema.safeParse(entry))
  .filter((parsed) => parsed.success)
  .map((parsed) => parsed.data);

export function builtinProviderDefinitions(): ProviderDefinition[] {
  return definitions;
}

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
