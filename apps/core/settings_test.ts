// platform/settings#R31: 실제 core 조립이 각 팀 등록 파일이 공개한 설정 항목을
// registry 하나로 모으고, settings apply·reload·read route를 wire에 등록한다.
// 데이터 root는 harness가 만든 temp dir다. 사람 데이터 root와 harness home은
// 열지 않는다. 값 검증은 소유 concern의 schema를 따른다(platform/settings#R31).
import { assert, assertEquals } from "@std/assert";
import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import { createLedgerRegistration } from "./documents.ts";
import { type CoreHarness, createCoreHarness } from "./testing/core.ts";

const teams = [
  { createLedgerRegistration },
  { codingAgentConnectionDefinitions },
];

const OPERATIONS = [
  "SettingsDefinitions",
  "GetSettings",
  "SettingsHistory",
  "ApplySettings",
  "ReloadSettings",
];

function post(
  harness: CoreHarness,
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; body: unknown }> {
  return (async () => {
    const response = await fetch(
      `http://127.0.0.1:${harness.port}/v1/${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, body: await response.json() };
  })();
}

function setMutation(key: string, value: unknown): unknown {
  return { layer: "common", key, action: "set", value };
}

Deno.test("platform/settings#R31: core는 팀 등록 파일의 설정 항목을 registry 하나로 모으고 apply·read route를 등록한다", async () => {
  const opened = await createCoreHarness({ teams, teamModules: [] });
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

    // definitions은 각 팀이 공개한 항목 전부다.
    const definitions = await post(harness, "settings/definitions", {}, token);
    assertEquals(definitions.status, 200, JSON.stringify(definitions.body));
    const listed = (definitions.body as {
      definitions: { key: string }[];
      defaults_revision: string;
    }).definitions.map((definition) => definition.key);
    assertEquals(listed, [
      "shell.reading_width",
      "lophn-agent.model.catalog_auto_update",
      "lophn-agent.extensions.skill_folders",
      "lophn-agent.extensions.mcp_servers",
      "coding-agent.harnesses.enabled",
      "coding-agent.default_harness",
      "coding-agent.harnesses.profile",
    ]);
    const defaultsRevision = (definitions.body as { defaults_revision: string })
      .defaults_revision;

    // harness 설정 3개를 apply한다. 저장 선택은 사람의 명시 apply만 바꾼다(R17).
    const applied = await post(harness, "settings/apply", {
      input: {
        changes: [
          setMutation("shell.reading_width", "wide"),
          setMutation("coding-agent.harnesses.enabled", false),
          setMutation("coding-agent.default_harness", "codex"),
          setMutation("coding-agent.harnesses.profile", "work"),
        ],
      },
      idempotency_key: "harness-apply-1",
      compare: { revision: 0, defaults_revision: defaultsRevision },
      prepared: [],
    }, token);
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    const result = applied.body as {
      revision: number;
      changed: boolean;
      applied: { key: string }[];
    };
    assertEquals(result.revision, 1);
    assertEquals(result.changed, true);
    assertEquals(
      result.applied.map((application) => application.key),
      [
        "shell.reading_width",
        "coding-agent.harnesses.enabled",
        "coding-agent.default_harness",
        "coding-agent.harnesses.profile",
      ],
    );

    // get은 apply한 선택을 그대로 읽는다. 값 검증은 소유 concern의 schema다.
    const got = await post(harness, "settings/get", {
      keys: [
        "shell.reading_width",
        "coding-agent.harnesses.enabled",
        "coding-agent.default_harness",
        "coding-agent.harnesses.profile",
      ],
    }, token);
    assertEquals(got.status, 200, JSON.stringify(got.body));
    const settings = (got.body as {
      settings: { key: string; resolved: boolean; value: unknown }[];
      revision: number;
    }).settings;
    assertEquals(
      settings.map((setting) => [setting.key, setting.value]),
      [
        ["shell.reading_width", "wide"],
        ["coding-agent.harnesses.enabled", false],
        ["coding-agent.default_harness", "codex"],
        ["coding-agent.harnesses.profile", "work"],
      ],
    );
    assertEquals(settings.every((setting) => setting.resolved), true);
    assertEquals((got.body as { revision: number }).revision, 1);

    // 등록되지 않은 항목은 거절이다.
    const unknown = await post(harness, "settings/apply", {
      input: { changes: [setMutation("coding-agent.unknown", true)] },
      idempotency_key: "harness-apply-unknown",
      compare: { revision: 1, defaults_revision: defaultsRevision },
      prepared: [],
    }, token);
    assertEquals(unknown.status, 400, JSON.stringify(unknown.body));
    assertEquals(
      (unknown.body as { error?: { code?: string } }).error?.code,
      "invalid_input",
    );

    // history는 apply한 판을 남긴다. 첫 apply는 machine 시작 판(revision 0) 뒤에 온다.
    const history = await post(harness, "settings/history", {}, token);
    assertEquals(history.status, 200, JSON.stringify(history.body));
    const revisions = (history.body as {
      revisions: {
        revision: number;
        changes: { key: string }[];
        actor: string;
      }[];
    }).revisions;
    assertEquals(revisions.length, 2);
    assertEquals(revisions[0].revision, 1);
    assertEquals(revisions[0].actor, "user");
    assertEquals(
      revisions[0].changes.map((change) => change.key),
      [
        "shell.reading_width",
        "coding-agent.harnesses.enabled",
        "coding-agent.default_harness",
        "coding-agent.harnesses.profile",
      ],
    );
  } finally {
    await harness.close();
  }
});
