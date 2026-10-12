import type { LedgerTestRegistration } from "../../../../apps/core/testing/ledger.ts";
import type { Tx } from "../../../protocol/platform/mod.ts";
import {
  createProviderCommands,
  createProviderReads,
  providerSchemaSteps,
} from "../providers/mod.ts";
import {
  createModelCommands,
  createModelReads,
  type ModelCommandDeps,
  modelSchemaSteps,
} from "./mod.ts";
import { CATALOG_OPTIONS } from "../../../protocol/lophn-agent/testing/mod.ts";

// model 기본값·즐겨찾기 ledger 테스트 등록. provider 표와 같은 wire에 명령·읽기를 붙인다.
// 목록과 catalog는 contracts/lophn-agent/testing의 model만 안다. 이름 하나는 목록을 확인하지 못한 경우(null),
// 하나는 목록에는 있지만 catalog 항목이 없는 경우다.
const LISTED_WITHOUT_CATALOG = "listed-without-catalog";
const LIST_UNCONFIRMED = "list-unconfirmed";

function modelDeps(tx: Tx): ModelCommandDeps {
  return {
    definitionKey(provider) {
      const row = tx.sql.get(
        "select definition_key from providers where id = ?",
        [provider],
      );
      return row === undefined ? undefined : String(row["definition_key"]);
    },
    modelListed(definition, modelName) {
      if (modelName === LIST_UNCONFIRMED) return null;
      if (modelName === LISTED_WITHOUT_CATALOG) return true;
      return CATALOG_OPTIONS.some((entry) =>
        entry.provider_definition === definition &&
        entry.model_name === modelName
      );
    },
    catalogEntry(definition, modelName) {
      return CATALOG_OPTIONS.find((entry) =>
        entry.provider_definition === definition &&
        entry.model_name === modelName
      );
    },
  };
}

export function createLedgerTestRegistration(): LedgerTestRegistration {
  const providerCommands = createProviderCommands();
  const providerReads = createProviderReads();
  const modelCommands = createModelCommands(modelDeps);
  const modelReads = createModelReads();
  return {
    schemaSteps: [...providerSchemaSteps, ...modelSchemaSteps],
    commands: [
      providerCommands.register,
      providerCommands.disconnect,
      modelCommands.changeDefaults,
      modelCommands.changeFavorites,
    ],
    reads: [
      providerReads.read,
      modelReads.defaults,
      modelReads.favorites,
    ],
  };
}
