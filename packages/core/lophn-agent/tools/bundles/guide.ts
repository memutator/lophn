import { z } from "zod";
import { err, ok } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import {
  settingsDefinitions,
  settingsGet,
} from "../../../../protocol/config/mod.ts";
import { protectedSetting } from "../questions/mod.ts";
import { fitJson } from "../result.ts";
import type { ToolDefinition } from "../registry.ts";
import type { RunCredential, ToolHandler } from "../work.ts";
import {
  type ContractCall,
  defineBuiltin,
  type DefineOptions,
  READ,
} from "./common.ts";
import { bodyOf } from "./paging.ts";

// 제품 안내 묶음(concern harness/tools). 동봉 안내와 공개 설정 정의·현재 적용값·출처를
// 읽기로만 준다. 설정을 바꾸는 tool과 secret 값을 읽거나 받는 입력은 없다. 설정 변경은
// lophn-agent/questions의 option action으로만 적용된다(사람이 선택한 뒤 machine이 적용).

export const GUIDE_TOOL_REVISION = "2026-10-06";

function define(
  name: string,
  description: string,
  input: z.ZodType,
  contract: string,
  options: DefineOptions,
): ToolDefinition {
  return defineBuiltin(
    GUIDE_TOOL_REVISION,
    name,
    description,
    input,
    contract,
    options,
  );
}

const nonblank = z.string().regex(/\S/);

const settingInput = z.strictObject({
  keys: z.array(nonblank).max(50).optional(),
});

export const settingReadTool = define(
  "setting.read",
  "Read public setting definitions, current values, where each value comes from, and when a change applies. Secret values are never shown. This changes nothing.",
  settingInput,
  settingsGet.name,
  { ...READ, scopeCheck: "public settings" },
);

export const GUIDE_TOOL_NAMES: readonly string[] = [settingReadTool.name];

export const GUIDE_TOOLS: readonly ToolDefinition[] = [settingReadTool];

export type GuideToolPorts = ContractCall;

type DefinitionEntry = {
  key: string;
  owner: string;
  description: string;
  display_name_key: string;
  value_meaning_key: string;
  default_meaning_key: string;
  affected_features: string[];
  risk_key: string;
  revert_key: string;
  constraints: unknown;
  required: boolean;
  value_type: unknown;
  default_present: boolean;
  default?: unknown;
  apply_at: string;
  apply_at_key: string;
};

type EffectiveEntry = {
  key: string;
  resolved: boolean;
  value: unknown;
  source_layer: string | null;
  revision: number;
};

function fitted(
  summary: string,
  value: Record<string, unknown>,
  arrayKeys: readonly string[],
  next: string | null = null,
): ToolResult {
  const limited = fitJson(value, arrayKeys);
  return {
    status: "success",
    summary,
    content: limited.content as ToolResult["content"],
    complete: limited.complete && next === null,
    source: null,
    continuation: next === null ? null : { has_more: true, read_next: next },
    pending: [],
  };
}

export function createGuideToolHandlers(
  ports: GuideToolPorts,
): ReadonlyMap<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  handlers.set(
    settingReadTool.name,
    async (input, credential: RunCredential) => {
      const value = input as z.infer<typeof settingInput>;
      const keys = value.keys === undefined ? {} : { keys: value.keys };
      const definitions = await ports.call(
        settingsDefinitions.name,
        keys,
        credential.run,
      );
      if (!definitions.ok) return definitions;
      const current = await ports.call(
        settingsGet.name,
        keys,
        credential.run,
      );
      if (!current.ok) return current;
      const defined =
        (bodyOf(definitions.value)["definitions"] ?? []) as DefinitionEntry[];
      const effective = new Map(
        ((bodyOf(current.value)["settings"] ?? []) as EffectiveEntry[]).map((
          setting,
        ) => [setting.key, setting]),
      );
      // 요청한 key가 하나라도 등록되어 있지 않으면 없는 항목을 만들어 말하지 않는다.
      if (value.keys !== undefined && defined.length !== value.keys.length) {
        return err({ code: "not_found", message: "setting not found" });
      }
      const settings = defined.map((definition) => {
        const setting = effective.get(definition.key);
        const hidden = protectedSetting(definition.key)?.kind === "secret";
        return {
          key: definition.key,
          owner: definition.owner,
          description: definition.description,
          display_name_key: definition.display_name_key,
          value_meaning_key: definition.value_meaning_key,
          default_meaning_key: definition.default_meaning_key,
          affected_features: definition.affected_features,
          risk_key: definition.risk_key,
          revert_key: definition.revert_key,
          constraints: definition.constraints,
          required: definition.required,
          value_type: definition.value_type,
          default_present: definition.default_present,
          ...(definition.default_present && !hidden
            ? { default: definition.default }
            : {}),
          apply_at: definition.apply_at,
          apply_at_key: definition.apply_at_key,
          // secret 값은 읽지 않는다. 정의와 적용 시점만 보인다.
          value_hidden: hidden,
          ...(hidden || setting === undefined ? {} : {
            resolved: setting.resolved,
            value: setting.value,
            source_layer: setting.source_layer,
            revision: setting.revision,
          }),
        };
      });
      return ok(fitted("settings read", {
        defaults_revision: bodyOf(definitions.value)["defaults_revision"] ??
          null,
        revision: bodyOf(current.value)["revision"] ?? null,
        settings,
      }, ["settings"]));
    },
  );
  return handlers;
}
