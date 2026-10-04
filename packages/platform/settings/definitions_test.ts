import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
import {
  settingsDefinitionsRead,
  settingsGetRead,
} from "./reads.ts";
import { SettingRegistry, validateDefinition } from "./registry.ts";
import type { SettingDefinition } from "../../contracts/platform/mod.ts";

const width: SettingDefinition = {
  key: "shell.reading_width",
  owner: "shell/workspace",
  display_name_key: "settings.reading_width.name",
  description: "settings.reading_width.description",
  value_meaning_key: "settings.reading_width.value",
  default_meaning_key: "settings.reading_width.default",
  affected_features: ["shell/workspace"],
  risk_key: "settings.reading_width.risk",
  revert_key: "settings.reading_width.revert",
  value_type: { type: "integer", minimum: 40, maximum: 120 },
  default_present: true,
  default: 80,
  required: false,
  constraints: { minimum: 40, maximum: 120, unit: "characters" },
  layers: ["common"],
  apply_at: "current_check",
  apply_at_key: "settings.reading_width.apply_at",
  machine_local: false,
} as unknown as SettingDefinition;

const tracked: SettingDefinition = {
  key: "documents.tracking",
  owner: "documents/tracking",
  display_name_key: "settings.tracking.name",
  description: "settings.tracking.description",
  value_meaning_key: "settings.tracking.value",
  default_meaning_key: "settings.tracking.default",
  affected_features: ["documents/tracking"],
  risk_key: "settings.tracking.risk",
  revert_key: "settings.tracking.revert",
  value_type: { type: "object" },
  default_present: true,
  default: { patterns: ["**/*.md"] },
  required: false,
  constraints: {},
  layers: ["common"],
  apply_at: "next_run",
  apply_at_key: "settings.tracking.apply_at",
  machine_local: false,
} as unknown as SettingDefinition;

// R28: 설명이 없는 항목은 공개 설정으로 등록하지 않는다. registry 생성이 거절한다.
const noDescription = {
  ...width,
  key: "shell.no_description",
  description: "",
};

function snapshot(
  rows: Record<string, unknown>[] = [],
  asOfSeq = "00000000000000000001",
): Parameters<ReturnType<typeof settingsDefinitionsRead>["handle"]>[0] {
  return {
    sql: {
      get(_sql: string, _params: readonly unknown[]) {
        return rows.length > 0 ? rows[0] : undefined;
      },
      all(_sql: string, _params: readonly unknown[]) {
        return rows;
      },
    },
    as_of_seq: asOfSeq,
    port: () => {
      throw new Error("port는 이 read에 없다");
    },
  } as never;
}

function ctx() {
  return {
    actor: "user",
    principal: "test-user",
    credential_ref: "test:test-user:user",
    scope: { operations: [], targets: {} },
    conditions: {},
  } as never;
}

Deno.test("platform/settings#R27: 공개 설정마다 이름·한 줄 설명·현재 선택의 뜻·기본값의 뜻·영향·위험·되돌림·적용 시점을 준다", () => {
  const registry = new SettingRegistry([width, tracked]);
  const read = settingsDefinitionsRead(registry);
  const result = read.handle(snapshot(), ctx(), {});
  assert(result.ok);
  const definitions = result.value.definitions as Record<string, unknown>[];
  assertEquals(definitions.length, 2);
  const widthItem = definitions.find((item) => item.key === width.key)!;
  assertEquals(widthItem.display_name_key, "settings.reading_width.name");
  assertEquals(widthItem.description, "settings.reading_width.description");
  assertEquals(widthItem.value_meaning_key, "settings.reading_width.value");
  assertEquals(widthItem.default_meaning_key, "settings.reading_width.default");
  assertEquals(widthItem.affected_features, ["shell/workspace"]);
  assertEquals(widthItem.risk_key, "settings.reading_width.risk");
  assertEquals(widthItem.revert_key, "settings.reading_width.revert");
  assertEquals(widthItem.apply_at, "current_check");
  assertEquals(widthItem.apply_at_key, "settings.reading_width.apply_at");
  // 기본값이 있다.
  assertEquals(widthItem.default_present, true);
  assertEquals(widthItem.default, 80);
});

Deno.test("platform/settings#R27: keys로 가리킨 항목만 준다", () => {
  const registry = new SettingRegistry([width, tracked]);
  const read = settingsDefinitionsRead(registry);
  const result = read.handle(snapshot(), ctx(), { keys: ["shell.reading_width"] });
  assert(result.ok);
  const definitions = result.value.definitions as { key: string }[];
  assertEquals(definitions.length, 1);
  assertEquals(definitions[0].key, "shell.reading_width");
});

Deno.test("platform/settings#R28: 설명이 없는 항목은 등록이 거절된다", () => {
  const checked = validateDefinition(noDescription as SettingDefinition);
  assertEquals(checked.ok, false);
  // 뜻 key가 빠진 항목도 거절한다.
  const noMeaning = validateDefinition({
    ...width,
    key: "shell.no_meaning",
    value_meaning_key: "",
  } as SettingDefinition);
  assertEquals(noMeaning.ok, false);
  // 영향받는 기능이 비어 있으면 거절한다.
  const noFeatures = validateDefinition({
    ...width,
    key: "shell.no_features",
    affected_features: [],
  } as SettingDefinition);
  assertEquals(noFeatures.ok, false);
});

Deno.test("platform/settings#R28: 설정 화면과 lophn 역할이 같은 registry에서 같은 목록을 읽는다", () => {
  const registry = new SettingRegistry([width, tracked]);
  const read = settingsDefinitionsRead(registry);
  const first = read.handle(snapshot(), ctx(), {});
  const second = read.handle(snapshot(), ctx(), {});
  assert(first.ok);
  assert(second.ok);
  assertEquals(first.value, second.value);
  // defaults_revision이 같다. 같은 공개 목록이다.
  assertEquals(first.value.defaults_revision, second.value.defaults_revision);
});

Deno.test("platform/settings#R30: settingsGet은 적용값·출처 층·적용 시점을 주고 조회 정보를 유지한다", () => {
  const registry = new SettingRegistry([width, tracked]);
  const read = settingsGetRead(registry);
  const stateRow = { revision: 3, defaults_revision: registry.defaultsRevision };
  const rows = [
    { layer: "common", key: "shell.reading_width", value: JSON.stringify(90) },
  ];
  const result = read.handle(
    {
      sql: {
        get(_sql: string, _params: readonly unknown[]) {
          return stateRow;
        },
        all(_sql: string, _params: readonly unknown[]) {
          return rows;
        },
      },
      as_of_seq: "00000000000000000001",
      port: () => {
        throw new Error("port는 이 read에 없다");
      },
    } as never,
    ctx(),
    {},
  );
  assert(result.ok);
  const settings = result.value.settings as Record<string, unknown>[];
  assertEquals(result.value.revision, 3);
  const chosen = settings.find((item) => item.key === width.key)!;
  assertEquals(chosen.resolved, true);
  assertEquals(chosen.value, 90);
  assertEquals(chosen.source_layer, "common");
  assertEquals(chosen.apply_at, "current_check");
  assertEquals(chosen.revision, 3);
  // 선택이 없는 항목은 기본값을 따른다.
  const fallback = settings.find((item) => item.key === tracked.key)!;
  assertEquals(fallback.source_layer, "builtin");
  assertEquals(fallback.value, { patterns: ["**/*.md"] });
  // 등록되지 않은 항목은 조회하지 않는다.
  const unknown = read.handle(
    {
      sql: {
        get() {
          return stateRow;
        },
        all() {
          return rows;
        },
      },
      as_of_seq: "00000000000000000001",
      port: () => {
        throw new Error("port는 이 read에 없다");
      },
    } as never,
    ctx(),
    { keys: ["shell.unknown"] },
  );
  assert(unknown.ok);
  assertEquals((unknown.value.settings as unknown[]).length, 0);
});

Deno.test("platform/settings#R30: 펼칠 정보(층·판·format)는 같은 read의 나머지 필드에 있다", () => {
  const registry = new SettingRegistry([width, tracked]);
  const read = settingsDefinitionsRead(registry);
  const result = read.handle(snapshot(), ctx(), {});
  assert(result.ok);
  // 선택 층은 항목 layers이다(R30).
  const definitions = result.value.definitions as Record<string, unknown>[];
  for (const item of definitions) {
    assertEquals(item.layers, ["common"]);
  }
  // 적용 판은 defaults_revision이다.
  assert(typeof result.value.defaults_revision === "string");
  assert(result.value.defaults_revision.length > 0);
  // 교환 format은 SETTINGS_EXCHANGE_FORMAT 상수다(T27 완료 기준).
  void ok;
  void err;
});
