import { assert, assertEquals, assertThrows } from "@std/assert";
import { z } from "zod";
import { ERROR_CODES } from "../../base/mod.ts";
import { commandRequestSchema } from "./envelope.ts";
import { eventEnvelopeSchema } from "./events.ts";
import { routePath } from "./route.ts";
import {
  applySettings,
  applySettingsInputSchema,
  defineSetting,
  effectiveSettingSchema,
  reloadSettings,
  type SettingDefinition,
  settingDefinitionSchema,
  SETTINGS_EVENTS,
  SETTINGS_EXCHANGE_FORMAT,
  SETTINGS_EXCHANGE_FORMAT_VERSION,
  SETTINGS_ROUTES,
  settingsApplyResultSchema,
  settingsChanged,
  settingsCompareSchema,
  settingsGetOutputSchema,
  settingsHistoryOutputSchema,
  settingsRevisionSchema,
  settingsValidationErrorSchema,
} from "./settings.ts";
const definition = {
  key: "shell.reading_width",
  owner: "shell/workspace",
  display_name_key: "settings.reading_width.name",
  description: "settings.reading_width.description",
  value_meaning_key: "settings.reading_width.value",
  default_meaning_key: "settings.reading_width.default",
  affected_features: ["shell/workspace"],
  risk_key: "settings.reading_width.risk",
  revert_key: "settings.reading_width.revert",
  value_type: z.number().int().min(40).max(120),
  default_present: true,
  default: 80,
  required: false,
  constraints: { minimum: 40, maximum: 120, unit: "characters" },
  layers: ["common"],
  apply_at: "current_check",
  apply_at_key: "settings.reading_width.apply_at",
  machine_local: false,
} satisfies SettingDefinition<z.ZodNumber>;
const effective = {
  key: definition.key,
  resolved: true,
  value: 90,
  source_layer: "common",
  choices: [{ key: definition.key, layer: "common", value: 90 }],
  revision: 1,
  apply_at: "current_check",
};
const change = {
  layer: "common",
  key: definition.key,
  before_present: false,
  before: null,
  action: "set",
  after: 90,
};
const revision = {
  revision: 1,
  previous_revision: 0,
  changes: [change],
  affected_concerns: [definition.owner],
  defaults_revision: "defaults-a",
  actor: "user",
  at: "2026-10-04T00:00:00.000Z",
};
Deno.test("platform/settings#R1, platform/settings#R10, platform/settings#R20, platform/settings#R25, platform/settings#R28: route와 event 이름은 architecture 표와 같다", () => {
  assertEquals(
    SETTINGS_ROUTES.map((route) => [route.kind, routePath(route)]),
    [
      ["read", "/v1/settings/definitions"],
      ["read", "/v1/settings/get"],
      ["read", "/v1/settings/history"],
      ["command", "/v1/settings/apply"],
      ["command", "/v1/settings/reload"],
    ],
  );
  assertEquals([applySettings.name, reloadSettings.name], [
    "ApplySettings",
    "ReloadSettings",
  ]);
  assertEquals(SETTINGS_EVENTS.map((event) => event.type), [
    "SettingsChanged",
    "SettingsReloaded",
  ]);
  for (const event of SETTINGS_EVENTS) {
    assert(event.subject.safeParse(null).success);
    assert(!event.subject.safeParse("settings:common").success);
  }
  for (const route of SETTINGS_ROUTES) {
    for (const code of route.errors) assert(ERROR_CODES.includes(code));
  }
});
Deno.test("platform/settings#R1, platform/settings#R11, platform/settings#R12, platform/settings#R13, platform/settings#R27, platform/settings#R28: 소유 concern의 typed schema와 모든 설명을 등록한다", () => {
  const registered = defineSetting(definition);
  assertEquals(registered, definition);
  assert(registered.value_type.safeParse(40).success);
  for (const value of ["80", 39, 121, null]) {
    assert(!registered.value_type.safeParse(value).success);
  }
  assertThrows(() => defineSetting({ ...definition, description: " " }));
  assertThrows(() => defineSetting({ ...definition, default: 121 }));
  const { description: _description, ...withoutDescription } = definition;
  assertThrows(() => {
    // 필수 설명을 놓친 소유 concern은 typecheck에서도 실패해야 한다.
    // @ts-expect-error description is required
    defineSetting(withoutDescription);
  });
  assertThrows(() => {
    // @ts-expect-error default must match the value schema
    defineSetting({ ...definition, default: "80" });
  });
  const extension = defineSetting({
    ...definition,
    key: "lophn-agent.extensions",
    owner: "lophn-agent/extensions",
    value_type: z.strictObject({
      mcp_servers: z.array(
        z.strictObject({
          name: z.string(),
          tool_class: z.enum(["read", "write"]),
        }),
      ),
      skill_roots: z.array(z.string()),
      catalog_auto_refresh: z.boolean(),
    }),
    default: { mcp_servers: [], skill_roots: [], catalog_auto_refresh: false },
    apply_at: "next_run",
  });
  assert(extension.value_type.safeParse(extension.default).success);
  assert(
    !extension.value_type.safeParse({
      ...extension.default,
      catalog_auto_refresh: "true",
    }).success,
  );
  assert(
    !extension.value_type.safeParse({
      ...extension.default,
      mcp_servers: [{ name: "local", tool_class: "unknown" }],
    }).success,
  );
  const { value_type, ...metadata } = definition;
  const output = { ...metadata, value_type: z.toJSONSchema(value_type) };
  assert(settingDefinitionSchema.safeParse(output).success);
  assert(
    !settingDefinitionSchema.safeParse({ ...output, apply_at_key: "" }).success,
  );
  assert(
    !settingDefinitionSchema.safeParse({ ...output, description: undefined })
      .success,
  );
});
Deno.test("platform/settings#R3, platform/settings#R26, platform/settings#R31: TOML 교환 판과 machine-local 제외 표시를 공개한다", () => {
  assertEquals(SETTINGS_EXCHANGE_FORMAT_VERSION, 1);
  assertEquals(SETTINGS_EXCHANGE_FORMAT, {
    format: "TOML",
    toml_version: "1.0",
    encoding: "UTF-8",
    format_version: 1,
  });
  const local = defineSetting({ ...definition, machine_local: true });
  assert(local.machine_local);
  assert(!defineSetting(definition).machine_local);
});
Deno.test("platform/settings#R5, platform/settings#R9, platform/settings#R10: explicit null과 false와 빈 목록은 선택 삭제와 다르다", () => {
  const nullable = defineSetting({
    ...definition,
    key: "coding-agent.default_harness",
    owner: "coding-agent/harnesses",
    value_type: z.string().nullable(),
    default: null,
  });
  assert(nullable.value_type.safeParse(null).success);
  for (const value of [null, false, []]) {
    const result = applySettingsInputSchema.parse({
      changes: [{ layer: "common", key: definition.key, action: "set", value }],
    });
    assertEquals(result.changes[0].action, "set");
  }
  assert(
    applySettingsInputSchema.safeParse({
      changes: [{ layer: "common", key: definition.key, action: "delete" }],
    }).success,
  );
  assert(
    !applySettingsInputSchema.safeParse({
      changes: [{
        layer: "common",
        key: definition.key,
        action: "delete",
        value: null,
      }],
    }).success,
  );
  for (const layer of ["builtin", "preset", "assignment", "session"]) {
    assert(
      !applySettingsInputSchema.safeParse({
        changes: [{ layer, key: definition.key, action: "set", value: 90 }],
      }).success,
    );
  }
  assert(
    effectiveSettingSchema.safeParse({ ...effective, value: null }).success,
  );
  assert(
    effectiveSettingSchema.safeParse({
      ...effective,
      resolved: false,
      value: null,
      source_layer: null,
      choices: [],
    }).success,
  );
  assert(
    !effectiveSettingSchema.safeParse({ ...effective, resolved: false })
      .success,
  );
});
Deno.test("platform/settings#R11, platform/settings#R12, platform/settings#R14, platform/settings#R15: 입력은 strict이고 오류에는 안전한 제약 정보만 둔다", () => {
  const input = {
    changes: [{
      layer: "common",
      key: definition.key,
      action: "set",
      value: 90,
    }],
  };
  assert(applySettingsInputSchema.safeParse(input).success);
  assert(
    !applySettingsInputSchema.safeParse({ ...input, actor: "user" }).success,
  );
  assert(
    !applySettingsInputSchema.safeParse({
      changes: [{ ...input.changes[0], unknown: 1 }],
    }).success,
  );
  assert(
    !applySettingsInputSchema.safeParse({
      changes: [input.changes[0], input.changes[0]],
    }).success,
  );
  assert(
    !applySettingsInputSchema.safeParse({
      changes: [{ ...input.changes[0], value: undefined }],
    }).success,
  );
  // machine 근거는 질문·option의 strict 모양이다. 사람 apply는 evidence를 생략한다.
  assert(
    applySettingsInputSchema.safeParse({
      ...input,
      evidence: { question: "qst_01arz3ndektsv4rrffq69g5fav", option: "adopt" },
    }).success,
  );
  assert(!applySettingsInputSchema.safeParse(input).success === false);
  assert(
    !applySettingsInputSchema.safeParse({
      ...input,
      evidence: { question: "qst_01arz3ndektsv4rrffq69g5fav", option: "" },
    }).success,
  );
  assert(
    !applySettingsInputSchema.safeParse({
      ...input,
      evidence: {
        question: "qst_01arz3ndektsv4rrffq69g5fav",
        option: "adopt",
        caller: "user",
      },
    }).success,
  );
  assert(
    !applySettingsInputSchema.safeParse({
      ...input,
      evidence: { question: "doc_01arz3ndektsv4rrffq69g5fav", option: "adopt" },
    }).success,
  );
  for (
    const route of SETTINGS_ROUTES.filter((route) => route.kind === "read")
  ) {
    assert(route.input.safeParse({}).success);
    assert(!route.input.safeParse({ unknown: true }).success);
  }
  assert(
    settingsValidationErrorSchema.safeParse({
      key: definition.key,
      layer: "common",
      expected: "integer 40..120 characters",
      remedy: "settings.reading_width.remedy",
    }).success,
  );
  assertEquals(Object.keys(settingsValidationErrorSchema.shape), [
    "key",
    "layer",
    "expected",
    "remedy",
  ]);
  // 원문 secret 검사와 대상 참조 검증은 소유 concern과 redaction 경계에서 수행한다.
  assertEquals(Object.keys(applySettingsInputSchema.shape), [
    "changes",
    "evidence",
  ]);
});
Deno.test("platform/settings#R19, platform/settings#R20, platform/settings#R29: apply와 reload는 envelope의 CAS와 준비 참조를 사용한다", () => {
  const compare = { revision: 1, defaults_revision: "defaults-a" };
  for (const route of [applySettings, reloadSettings]) {
    const request = {
      input: route === applySettings ? { changes: [] } : {},
      compare,
      idempotency_key: "settings-apply-a",
      prepared: ["settings-validation-a"],
    };
    const schema = commandRequestSchema(route);
    assert(schema.safeParse(request).success);
    assert(!schema.safeParse({ ...request, prepared: undefined }).success);
    assert(!schema.safeParse({ ...request, compare: { revision: 1 } }).success);
    assert(
      !schema.safeParse({ ...request, run: "app_01arz3ndektsv4rrffq69g5fav" })
        .success,
    );
  }
  assert(
    !settingsCompareSchema.safeParse({ ...compare, revision: "1" }).success,
  );
  assert(
    !settingsCompareSchema.safeParse({ ...compare, revision: -1 }).success,
  );
  assert(
    !settingsCompareSchema.safeParse({ ...compare, revision: 1.5 }).success,
  );
  assertEquals(applySettings.actors, ["user", "machine"]);
  assertEquals(reloadSettings.actors, ["user", "machine"]);
});
Deno.test("platform/settings#R10, platform/settings#R20, platform/settings#R25: 판 이력과 read와 event는 값과 시점을 공개한다", () => {
  assert(settingsRevisionSchema.safeParse(revision).success);
  assert(
    settingsRevisionSchema.safeParse({
      ...revision,
      revision: 0,
      previous_revision: null,
      changes: [],
    }).success,
  );
  assert(
    !settingsRevisionSchema.safeParse({ ...revision, previous_revision: null })
      .success,
  );
  assert(
    !settingsRevisionSchema.safeParse({
      ...revision,
      changes: [change, change],
    }).success,
  );
  assert(
    !settingsRevisionSchema.safeParse({ ...revision, at: "2026-10-04" })
      .success,
  );
  assert(
    !settingsRevisionSchema.safeParse({ ...revision, actor: "app_bad" })
      .success,
  );
  assert(
    settingsGetOutputSchema.safeParse({
      settings: [effective],
      revision: 1,
      defaults_revision: "defaults-a",
      as_of_seq: "1",
      next_cursor: null,
    }).success,
  );
  assert(
    settingsHistoryOutputSchema.safeParse({
      revisions: [revision],
      as_of_seq: "1",
      next_cursor: null,
    }).success,
  );
  const applied = [
    { key: "lophn-agent.run_limit", apply_at: "next_run" },
    { key: "shell.theme", apply_at: "current_check" },
    { key: "shell.notification_opt_in", apply_at: "next_call" },
  ];
  assert(
    settingsApplyResultSchema.safeParse({ revision: 1, changed: true, applied })
      .success,
  );
  assert(
    settingsApplyResultSchema.safeParse({
      revision: 1,
      changed: false,
      applied: [],
    }).success,
  );
  assert(
    !settingsApplyResultSchema.safeParse({
      revision: 1,
      changed: true,
      applied: [{ key: "shell.theme", apply_at: "restart" }],
    }).success,
  );
  assert(
    eventEnvelopeSchema(settingsChanged).safeParse({
      seq: "1",
      type: "SettingsChanged",
      subject: null,
      actor: "user",
      run: null,
      payload: {
        revision: 1,
        changes: [change],
        affected_concerns: [definition.owner],
        applied,
      },
      at: revision.at,
    }).success,
  );
  assert(
    SETTINGS_EVENTS[1].payload.safeParse({
      revision: 2,
      defaults_revision: "defaults-b",
      keys: [definition.key],
      affected_concerns: [definition.owner],
      applied,
    }).success,
  );
});
