import { z } from "zod";
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  guideList,
  guideRead,
  readCursorSchema,
} from "../../../../contracts/documents/mod.ts";
import type { ToolResult } from "../../../../contracts/lophn-agent/mod.ts";
import {
  settingsDefinitions,
  settingsGet,
} from "../../../../contracts/platform/mod.ts";
import { protectedSetting } from "../../../questions/mod.ts";
import { fitJson } from "../result.ts";
import type { ToolDefinition } from "../registry.ts";
import type { RunCredential, ToolHandler } from "../work.ts";
import {
  type ContractCall,
  defineBuiltin,
  type DefineOptions,
  READ,
} from "./common.ts";
import { bodyOf, resume, scopeOf, wrap } from "./paging.ts";

// 제품 안내 묶음(concern harness/tools R20). 동봉 안내와 공개 설정 정의·현재 적용값·출처를
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

const guideInput = z.strictObject({
  feature: nonblank.optional(),
  section: nonblank.optional(),
  cursor: readCursorSchema.optional(),
});
const settingInput = z.strictObject({
  keys: z.array(nonblank).max(50).optional(),
});

export const lophnGuideTool = define(
  "lophn.guide",
  "Read the bundled product guide of this lophn version. Without a feature it lists the guides. This changes nothing.",
  guideInput,
  guideRead.name,
  { ...READ, scopeCheck: "bundled product guides" },
);
export const settingReadTool = define(
  "setting.read",
  "Read public setting definitions, current values, where each value comes from, and when a change applies. Secret values are never shown. This changes nothing.",
  settingInput,
  settingsGet.name,
  { ...READ, scopeCheck: "public settings" },
);

export const GUIDE_TOOL_NAMES: readonly string[] = [
  lophnGuideTool.name,
  settingReadTool.name,
];

export const GUIDE_TOOLS: readonly ToolDefinition[] = [
  lophnGuideTool,
  settingReadTool,
];

export type GuideToolPorts = ContractCall;

// 목록에서 이 tool이 쓰는 모양. 소유 contract(documents/guides)의 출력을 그대로 읽는다.
type GuideEntry = {
  lophn_version: string;
  title: string;
  content_hash: string;
  files: { path: string; primary: boolean }[];
};

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

function missing(): Result<never> {
  return err({ code: "not_found", message: "guide not found" });
}

export const GUIDE_READ_CODEPOINTS = 6000;

export function createGuideToolHandlers(
  ports: GuideToolPorts,
): ReadonlyMap<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  async function allGuides(
    run: string,
  ): Promise<Result<{ version: string; guides: GuideEntry[] }>> {
    const guides: GuideEntry[] = [];
    let version = "";
    let cursor: string | undefined;
    // 안내는 몇 개 안 되지만 소유 contract의 page를 끝까지 따라가 하나도 잃지 않는다.
    for (let page = 0; page < 20; page += 1) {
      const read = await ports.call(
        guideList.name,
        cursor === undefined ? {} : { cursor },
        run,
      );
      if (!read.ok) return read;
      const body = bodyOf(read.value);
      version = String(body["lophn_version"] ?? version);
      guides.push(...((body["guides"] ?? []) as GuideEntry[]));
      const next = body.next_cursor;
      if (next === null || next === undefined) {
        return ok({ version, guides });
      }
      cursor = next;
    }
    return ok({ version, guides });
  }

  handlers.set(
    lophnGuideTool.name,
    async (input, credential: RunCredential) => {
      const value = input as z.infer<typeof guideInput>;
      const listed = await allGuides(credential.run);
      if (!listed.ok) return listed;
      const { version, guides } = listed.value;
      if (value.feature === undefined) {
        return ok(fitted("product guides listed", {
          lophn_version: version,
          guides: guides.map((guide) => ({
            title: guide.title,
            content_hash: guide.content_hash,
          })),
        }, ["guides"]));
      }
      const wanted = value.feature.trim().toLowerCase();
      const guide = guides.find((candidate) =>
        candidate.title.trim().toLowerCase() === wanted
      );
      const file = guide?.files.find((candidate) => candidate.primary);
      if (guide === undefined || file === undefined) return missing();
      const scope = scopeOf(lophnGuideTool.name, {
        title: guide.title,
        content_hash: guide.content_hash,
        section: value.section ?? null,
      });
      const resumed = resume(value.cursor, scope);
      if (!resumed.ok) return resumed;
      const inner = resumed.value?.inner ?? null;
      const read = await ports.call(guideRead.name, {
        reference: {
          lophn_version: guide.lophn_version,
          title: guide.title,
          content_hash: guide.content_hash,
        },
        path: file.path,
        section: value.section ?? null,
        max_codepoints: GUIDE_READ_CODEPOINTS,
        ...(inner === null ? {} : { cursor: inner }),
      }, credential.run);
      if (!read.ok) return read;
      const body = bodyOf(read.value);
      const next = body.next_cursor === null || body.next_cursor === undefined
        ? null
        : wrap(scope, body.next_cursor, 0);
      return ok(fitted(
        "product guide read",
        {
          lophn_version: guide.lophn_version,
          title: guide.title,
          section: body["section"] ?? null,
          section_status: body["section_status"] ?? null,
          text: body["text"] ?? null,
          failure_reason: body["failure_reason"] ?? null,
        },
        [],
        next,
      ));
    },
  );

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
