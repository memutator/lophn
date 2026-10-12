import { z } from "zod";
import { ok } from "../../base/mod.ts";
import {
  type JsonValue,
  type ReadDefinition,
  settingsDefinitions,
  settingsGet,
} from "../../protocol/server/mod.ts";
import type { EffectiveSetting } from "../../protocol/server/mod.ts";
import type { SettingRegistry } from "./registry.ts";
import { effectiveSetting } from "./model.ts";

// HTTP output의 소유 concern JSON Schema. zod 4의 toJSONSchema를 쓴다.
function toJSONSchemaSafe(valueType: unknown): Record<string, JsonValue> {
  try {
    return z.toJSONSchema(valueType as z.ZodType) as Record<string, JsonValue>;
  } catch {
    return {};
  }
}

function readChoices(
  snapshot: {
    sql: {
      all(sql: string, params: readonly unknown[]): Record<string, unknown>[];
    };
  },
): { layer: "common"; key: string; value: JsonValue }[] {
  return snapshot.sql.all(
    "select layer, key, value from setting_choices order by key",
    [],
  ).map((row) => ({
    layer: "common" as const,
    key: String(row["key"]),
    value: JSON.parse(String(row["value"])) as JsonValue,
  }));
}

function readState(
  snapshot: {
    sql: {
      get(
        sql: string,
        params: readonly unknown[],
      ): Record<string, unknown> | undefined;
    };
  },
): { revision: number; defaults_revision: string } {
  const row = snapshot.sql.get(
    "select revision, defaults_revision from settings_state where key = 1",
    [],
  );
  // 선택 없는 시작은 row가 없다. revision 0과 registry defaults_revision으로 본다.
  return row === undefined ? { revision: 0, defaults_revision: "pending" } : {
    revision: Number(row["revision"]),
    defaults_revision: String(row["defaults_revision"]),
  };
}

export function settingsDefinitionsRead(
  registry: SettingRegistry,
): ReadDefinition<typeof settingsDefinitions> {
  return {
    route: settingsDefinitions,
    handle(snapshot, _ctx, input) {
      const keys = input.keys;
      const definitions =
        (keys === undefined
          ? registry.definitions
          : registry.definitions.filter((definition) =>
            keys.includes(definition.key)
          )).map((definition) => ({
            key: definition.key,
            owner: definition.owner,
            display_name_key: definition.display_name_key,
            description: definition.description,
            value_meaning_key: definition.value_meaning_key,
            default_meaning_key: definition.default_meaning_key,
            affected_features: definition.affected_features,
            risk_key: definition.risk_key,
            revert_key: definition.revert_key,
            // HTTP output은 소유 concern의 JSON Schema를 공개한다(contract 주석).
            value_type: toJSONSchemaSafe(definition.value_type),
            default_present: definition.default_present,
            ...(definition.default_present
              ? { default: definition.default as JsonValue }
              : {}),
            required: definition.required,
            constraints: definition.constraints ?? {},
            layers: definition.layers,
            apply_at: definition.apply_at,
            apply_at_key: definition.apply_at_key,
            machine_local: definition.machine_local,
          }));
      readState(snapshot);
      return ok({
        definitions,
        defaults_revision: registry.defaultsRevision,
        as_of_seq: snapshot.as_of_seq,
        next_cursor: null,
      });
    },
  };
}

export function settingsGetRead(
  registry: SettingRegistry,
): ReadDefinition<typeof settingsGet> {
  return {
    route: settingsGet,
    handle(snapshot, _ctx, input) {
      const choices = readChoices(snapshot);
      const state = readState(snapshot);
      const keys = input.keys;
      const settings: EffectiveSetting[] = registry.definitions
        .filter((definition) =>
          keys === undefined || keys.includes(definition.key)
        )
        .map((definition) => {
          const choice = choices.find((candidate) =>
            candidate.key === definition.key
          );
          return effectiveSetting(definition, choice, state.revision);
        });
      return ok({
        settings,
        revision: state.revision,
        defaults_revision: registry.defaultsRevision,
        as_of_seq: snapshot.as_of_seq,
        next_cursor: null,
      });
    },
  };
}
