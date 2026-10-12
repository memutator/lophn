// lophn-agent/harness/run-loop#R20: run 한도는 공통 설정이다. 실제 core 조립의
// settings registry에서 기본값, 양의 정수만, 사람만 apply를 확인한다. 데이터 root는
// harness가 만든 temp dir다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { createLedgerRegistration } from "../../projects/register.ts";
import { type CoreHarness, createCoreHarness } from "../../testing/core.ts";
import { resolveRunLimits, RUN_LIMIT_SETTING_KEYS } from "./mod.ts";
import { DEFAULT_RUN_LIMITS } from "../../../protocol/lophn-agent/mod.ts";
import type { EffectiveSetting } from "../../../protocol/config/mod.ts";

const OPERATIONS = [
  "SettingsDefinitions",
  "GetSettings",
  "SettingsHistory",
  "ApplySettings",
  "ReloadSettings",
];

const KEYS = Object.values(RUN_LIMIT_SETTING_KEYS);

async function post(
  harness: CoreHarness,
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${harness.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function apply(
  harness: CoreHarness,
  token: string,
  key: string,
  changes: unknown[],
  compare: { revision: number; defaults_revision: string },
) {
  return post(harness, "settings/apply", {
    input: { changes },
    idempotency_key: key,
    compare,
    prepared: [],
  }, token);
}

function set(key: string, value: unknown) {
  return { layer: "common", key, action: "set", value };
}

async function effective(
  harness: CoreHarness,
  token: string,
): Promise<EffectiveSetting[]> {
  const got = await post(harness, "settings/get", { keys: KEYS }, token);
  assertEquals(got.status, 200, JSON.stringify(got.body));
  return (got.body as { settings: EffectiveSetting[] }).settings;
}

Deno.test("lophn-agent/harness/run-loop#R20: run 한도는 공통 설정이고 기본 30회·5분·30분이며 양의 정수만 사람이 바꾼다", async () => {
  const opened = await createCoreHarness({
    teams: [{ createLedgerRegistration }],
    teamModules: [],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    const issued = await harness.credential({
      actor: "user",
      principal: "user-1",
      scope: { operations: [...OPERATIONS], targets: {} },
      conditions: {},
    });
    assert(issued.ok, issued.ok ? "" : issued.error.message);
    const token = issued.value.token;

    // 정의는 공통 층 하나·다음 run부터 적용이다.
    const definitions = await post(harness, "settings/definitions", {
      keys: KEYS,
    }, token);
    assertEquals(definitions.status, 200, JSON.stringify(definitions.body));
    const listed = definitions.body as {
      definitions: {
        key: string;
        layers: string[];
        apply_at: string;
        owner: string;
        default: unknown;
      }[];
      defaults_revision: string;
    };
    assertEquals(listed.definitions.map((item) => item.key), KEYS);
    for (const item of listed.definitions) {
      assertEquals(item.layers, ["common"]);
      assertEquals(item.apply_at, "next_run");
      assertEquals(item.owner, "lophn-agent/harness/run-loop");
    }
    const defaultsRevision = listed.defaults_revision;

    // 아무것도 고르지 않으면 기본값이고 시작 한도가 된다.
    const before = resolveRunLimits(await effective(harness, token));
    assert(before.ok);
    assertEquals(before.value, { ...DEFAULT_RUN_LIMITS });
    assertEquals(before.value, {
      model_attempts: 30,
      stall_ms: 300_000,
      active_ms: 1_800_000,
    });

    // 0·음수·소수·문자열·null·무제한 값은 하나도 받지 않는다. 변환하지 않는다.
    let revision = 0;
    let n = 0;
    for (const key of KEYS) {
      for (
        const bad of [
          0,
          -1,
          1.5,
          "unlimited",
          "30",
          null,
          true,
          Number.MAX_SAFE_INTEGER + 2,
          {},
        ]
      ) {
        const rejected = await apply(
          harness,
          token,
          `bad-${n++}`,
          [set(key, bad)],
          { revision, defaults_revision: defaultsRevision },
        );
        assertEquals(
          rejected.status,
          400,
          `${key}=${JSON.stringify(bad)} ${JSON.stringify(rejected.body)}`,
        );
      }
      // 선택을 지워 "무제한"으로 두는 길도 없다. 지우면 기본값으로 돌아간다.
    }
    const stillDefault = resolveRunLimits(await effective(harness, token));
    assert(stillDefault.ok);
    assertEquals(stillDefault.value, { ...DEFAULT_RUN_LIMITS });

    // 사람이 양의 정수를 명시 apply하면 다음 run의 한도가 바뀐다.
    const applied = await apply(
      harness,
      token,
      "limits-apply-1",
      [
        set(RUN_LIMIT_SETTING_KEYS.model_attempts, 12),
        set(RUN_LIMIT_SETTING_KEYS.stall_ms, 60_000),
        set(RUN_LIMIT_SETTING_KEYS.active_ms, 600_000),
      ],
      { revision, defaults_revision: defaultsRevision },
    );
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    revision = (applied.body as { revision: number }).revision;
    const after = resolveRunLimits(await effective(harness, token));
    assert(after.ok);
    assertEquals(after.value, {
      model_attempts: 12,
      stall_ms: 60_000,
      active_ms: 600_000,
    });

    // machine(역할이 일하는 자격)은 설정을 바꾸지 못한다. 발급 자체가 막히거나 쓰면 거절이다.
    const machine = await harness.credential({
      actor: "machine",
      principal: "machine-1",
      scope: { operations: ["ApplySettings"], targets: { task: "run-loop" } },
      conditions: { task: "run-loop", process: "agent-runtime" },
    });
    if (machine.ok) {
      const denied = await apply(
        harness,
        machine.value.token,
        "machine-raise",
        [set(RUN_LIMIT_SETTING_KEYS.model_attempts, 99)],
        { revision, defaults_revision: defaultsRevision },
      );
      assert(denied.status >= 400, JSON.stringify(denied.body));
    }
    const unchanged = resolveRunLimits(await effective(harness, token));
    assert(unchanged.ok);
    assertEquals(unchanged.value.model_attempts, 12);
  } finally {
    await harness.close();
  }
});
