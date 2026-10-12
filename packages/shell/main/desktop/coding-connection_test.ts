import assert from "node:assert/strict";
import { test } from "node:test";

import { CONNECT_INTENT } from "../../ipc/coding.ts";
import {
  childCliRunner,
  type CliResult,
  type CliRun,
  createCodingConnection,
} from "./coding-connection.ts";

const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const APP = "app_01arz3ndektsv4rrffq69g5fav";
const AT = "2026-10-07T00:00:00.000Z";

function detection(
  harness: string,
  discovery: "detected" | "absent" = "detected",
  over: Record<string, unknown> = {},
) {
  return {
    harness_id: harness,
    catalog_revision: "1",
    environment: { kind: "host", identity: "desk" },
    profile_id: "work",
    observed_at: AT,
    discovery,
    candidates: [],
    selected_executable: discovery === "detected"
      ? `/usr/bin/${harness}`
      : null,
    version: discovery === "detected"
      ? { result: "verified", value: "1.2.3", reason: null }
      : { result: "unknown", value: null, reason: "not found" },
    auth: { result: "not_verified", evidence: null, reason: "not checked" },
    probe_results: [],
    freshness: "fresh",
    ...over,
  };
}

const detectOk = (...found: unknown[]): CliResult => ({
  ok: true,
  data: { source: "cached", cache_saved: null, detections: found },
});

type Fake = {
  cli: CliRun;
  runs: string[][];
  core: Parameters<typeof createCodingConnection>[0]["core"];
  coreCalls: {
    kind: string;
    resource: string;
    method: string;
    body: unknown;
  }[];
};

function fake(
  options: {
    detect?: CliResult;
    install?: CliResult;
    doctor?: CliResult;
    connect?: unknown;
    app?: unknown;
  } = {},
): Fake {
  const runs: string[][] = [];
  const coreCalls: Fake["coreCalls"] = [];
  const cli: CliRun = (args) => {
    runs.push(args);
    if (args[0] === "harness") {
      return Promise.resolve(
        options.detect ?? detectOk(detection("claude"), detection("codex")),
      );
    }
    if (args[0] === "connection") {
      return Promise.resolve(
        options.install ?? {
          ok: true,
          data: {
            connection: CAC,
            install: "complete",
            resources: [{
              resource_identity: "claude/mcp",
              outcome: "changed",
              receipt_stored: true,
              reason: "ok",
            }],
          },
        },
      );
    }
    return Promise.resolve(
      options.doctor ?? {
        ok: true,
        data: {
          loading: [
            {
              stage: "mcp_initialize",
              result: "success",
              reason: "ok",
              next: "",
            },
            {
              stage: "tool_discovery",
              result: "unknown",
              reason: "?",
              next: "",
            },
          ],
        },
      },
    );
  };
  return {
    cli,
    runs,
    coreCalls,
    core: () => ({
      internal(kind, resource, method, body) {
        coreCalls.push({ kind, resource, method, body });
        if (resource === "coding_agent_connections") {
          return Promise.resolve(
            (options.connect ??
              { ok: true, value: { connection: CAC } }) as never,
          );
        }
        return Promise.resolve(
          (options.app ??
            {
              ok: true,
              value: { app: { source_path: "/work/budget" } },
            }) as never,
        );
      },
    }),
  };
}

const request = {
  intent: CONNECT_INTENT,
  harness_id: "claude",
  label: "Desk Claude",
  scope: { kind: "all", app: null },
};

test("shell/desktop#R19: 고정 연결 intent를 main이 다시 검사한다: 모양·이름·범위가 다르면 core도 child도 부르지 않는다", async () => {
  const world = fake();
  const connection = createCodingConnection({
    core: world.core,
    cli: world.cli,
  });
  for (
    const bad of [
      null,
      "connect",
      {},
      { ...request, intent: "create_connection" },
      { ...request, intent: undefined },
      { ...request, token: "secret" },
      { ...request, token_digest: "a".repeat(64) },
      { ...request, harness_id: "not-a-product" },
      { ...request, label: "   " },
      { ...request, label: "x".repeat(81) },
      { ...request, scope: { kind: "all", app: APP } },
      { ...request, scope: { kind: "app", app: null } },
      { ...request, scope: { kind: "app", app: "app_bad" } },
      { ...request, scope: { kind: "everything", app: null } },
      { ...request, target: { scope_kind: "user" } },
    ]
  ) {
    const reply = await connection.connect(bad);
    assert.equal(reply.ok, false, JSON.stringify(bad));
    if (!reply.ok) assert.equal(reply.error.code, "invalid_input");
  }
  assert.deepEqual(world.runs, []);
  assert.deepEqual(world.coreCalls, []);
});

test("shell/desktop#R19: 감지되지 않은 harness와 없는 harness로는 연결을 만들지 않는다", async () => {
  const world = fake({
    detect: detectOk(detection("claude", "absent"), detection("codex")),
  });
  const connection = createCodingConnection({
    core: world.core,
    cli: world.cli,
  });
  for (const harness of ["claude", "gemini"]) {
    const reply = await connection.connect({ ...request, harness_id: harness });
    assert.equal(reply.ok, false);
    if (!reply.ok) assert.equal(reply.error.code, "not_detected");
  }
  assert.deepEqual(world.coreCalls, []);
  // 감지 확인은 저장한 결과다. 사람 요청 재감지가 아니다.
  assert.deepEqual(world.runs, [["harness", "detect"], ["harness", "detect"]]);
});

test("coding-agent/connection#R2: 감지된 harness를 고르면 확인 창 없이 core 연결 → 선택 target 설치 → doctor 순서로 부른다", async () => {
  const world = fake();
  const connection = createCodingConnection({
    core: world.core,
    cli: world.cli,
  });
  const reply = await connection.connect(request);
  assert.equal(reply.ok, true);
  if (!reply.ok) return;
  assert.deepEqual(world.coreCalls, [{
    kind: "memory",
    resource: "coding_agent_connections",
    method: "connect",
    body: { label: "Desk Claude", scope: { kind: "all", app: null } },
  }]);
  const target = {
    scope_kind: "user",
    environment: { kind: "host", identity: "desk" },
    profile_id: "work",
    harness_id: "claude",
    app: null,
    app_realpath: null,
  };
  const input = JSON.stringify({ target });
  assert.deepEqual(world.runs, [
    ["harness", "detect"],
    ["connection", "install", "--connection", CAC, "--input", input],
    ["doctor", "--input", input],
  ]);
  assert.deepEqual(reply.value, {
    connection: CAC,
    install: {
      status: "complete",
      resources: [{ identity: "claude/mcp", outcome: "changed" }],
    },
    checks: [
      { stage: "mcp_initialize", result: "success" },
      { stage: "tool_discovery", result: "unknown" },
    ],
  });
  // token·hash 이름은 어느 호출에도 없다.
  const sent = JSON.stringify([world.runs, world.coreCalls]);
  assert.equal(/token|digest/i.test(sent), false);
});

test("coding-agent/connection#R2: 앱 하나 범위는 그 앱의 source 폴더를 main이 읽어 target에 넣고 source가 없으면 연결 전에 거절한다", async () => {
  const world = fake();
  const connection = createCodingConnection({
    core: world.core,
    cli: world.cli,
  });
  const scope = { kind: "app", app: APP };
  const reply = await connection.connect({ ...request, scope });
  assert.equal(reply.ok, true);
  assert.deepEqual(world.coreCalls.map((call) => call.resource), [
    "apps",
    "coding_agent_connections",
  ]);
  assert.deepEqual(world.coreCalls[1]?.body, { label: "Desk Claude", scope });
  const install = world.runs[1]!;
  const sentTarget = JSON.parse(install[5]!).target;
  assert.equal(sentTarget.scope_kind, "app");
  assert.equal(sentTarget.app, APP);
  assert.equal(sentTarget.app_realpath, "/work/budget");

  const noSource = fake({
    app: { ok: true, value: { app: { source_path: null } } },
  });
  const refused = await createCodingConnection({
    core: noSource.core,
    cli: noSource.cli,
  }).connect({ ...request, scope });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.code, "invalid_input");
  assert.deepEqual(noSource.coreCalls.map((call) => call.resource), ["apps"]);
});

test("coding-agent/connection#R12: 설치가 실패해도 이미 만든 연결을 회수하거나 다시 발급하지 않고 따로 알린다", async () => {
  const world = fake({
    install: {
      ok: false,
      error: { code: "unavailable", message: "install failed" },
    },
    doctor: { ok: false, error: { code: "unavailable", message: "no" } },
  });
  const reply = await createCodingConnection({
    core: world.core,
    cli: world.cli,
  }).connect(request);
  assert.equal(reply.ok, true);
  if (!reply.ok) return;
  assert.equal(reply.value.connection, CAC);
  assert.deepEqual(reply.value.install, { status: "error", resources: [] });
  assert.equal(reply.value.checks, null);
  // core 호출은 연결 생성 하나뿐이다.
  assert.equal(world.coreCalls.length, 1);

  const partial = fake({
    install: {
      ok: true,
      data: { connection: CAC, install: "partial", resources: [] },
    },
  });
  const part = await createCodingConnection({
    core: partial.core,
    cli: partial.cli,
  }).connect(request);
  assert.equal(part.ok && part.value.install.status, "partial");
});

test("coding-agent/connection#R2: core가 연결을 거절하면 설치·doctor를 시작하지 않고 이유를 옮긴다", async () => {
  for (
    const [code, expected] of [
      ["forbidden", "forbidden"],
      ["conflict", "conflict"],
      ["unavailable", "unavailable"],
      ["internal", "unavailable"],
    ] as const
  ) {
    const world = fake({
      connect: { ok: false, error: { code, message: "no" } },
    });
    const reply = await createCodingConnection({
      core: world.core,
      cli: world.cli,
    }).connect(request);
    assert.equal(reply.ok, false);
    if (!reply.ok) assert.equal(reply.error.code, expected);
    assert.deepEqual(world.runs, [["harness", "detect"]]);
  }
  const notReady = await createCodingConnection({
    core: () => null,
    cli: fake().cli,
  }).connect(request);
  assert.equal(notReady.ok, false);
  const noCli = await createCodingConnection({
    core: fake().core,
    cli: null,
  }).connect(request);
  assert.equal(noCli.ok, false);
});

test("coding-agent/harnesses#R2: 화면이 여는 감지는 저장한 결과이고 refresh는 사람이 누른 재감지만 부른다", async () => {
  const world = fake({
    detect: detectOk(
      detection("claude", "detected", {
        candidates: [{
          path: "/usr/bin/claude",
          source: "path",
          executable_result: "ok",
        }],
        probe_results: [{ probe: "version", outcome: "ok", detail: null }],
      }),
      detection("codex", "absent"),
    ),
  });
  const connection = createCodingConnection({
    core: world.core,
    cli: world.cli,
  });
  const first = await connection.detect("detect");
  const again = await connection.detect("refresh");
  assert.deepEqual(world.runs, [["harness", "detect"], ["harness", "refresh"]]);
  assert.equal(first.ok, true);
  assert.equal(again.ok, true);
  if (!first.ok) return;
  assert.equal(first.value.source, "cached");
  assert.deepEqual(first.value.harnesses.map((item) => item.discovery), [
    "detected",
    "absent",
  ]);
  const claude = first.value.harnesses[0]!;
  assert.equal(claude.version, "1.2.3");
  assert.equal(claude.executable, "/usr/bin/claude");
  assert.deepEqual(claude.candidates, [{
    path: "/usr/bin/claude",
    source: "path",
  }]);
  assert.deepEqual(claude.probes, [{ probe: "version", outcome: "ok" }]);
});

test("coding-agent/harnesses#R2: 모르는 모양의 감지 결과는 지어내지 않고 unavailable이다", async () => {
  const world = fake({ detect: { ok: true, data: { nothing: true } } });
  const reply = await createCodingConnection({
    core: world.core,
    cli: world.cli,
  }).detect("detect");
  assert.equal(reply.ok, false);
  const failed = await createCodingConnection({
    core: world.core,
    cli: fake({
      detect: { ok: false, error: { code: "unavailable", message: "x" } },
    }).cli,
  }).detect("detect");
  assert.equal(failed.ok, false);
});

test("coding-agent/cli#R40: child는 --json으로 부르고 connection·관측 socket·credential 환경을 지우며 종료 code와 상관없이 stdout을 읽는다", async () => {
  const seen: { file: string; args: string[]; env: Record<string, string> }[] =
    [];
  const run = childCliRunner({
    command: "/usr/bin/lophn",
    env: {
      PATH: "/usr/bin",
      LOPHN_HOME: "/data",
      LOPHN_CONNECTION: CAC,
      LOPHN_TERMINAL_OBSERVE: "/tmp/sock",
      API_TOKEN: "secret",
      MY_PASSWORD: "secret",
      KEYCHAIN_CREDENTIAL: "secret",
      UNSET: undefined,
    },
    exec: (file, args, options) => {
      seen.push({ file, args, env: options.env });
      return Promise.resolve({
        code: 4,
        stdout: JSON.stringify({
          summary: "partial",
          data: { install: "partial" },
        }),
      });
    },
  });
  const result = await run(["connection", "install", "--connection", CAC]);
  assert.deepEqual(result, { ok: true, data: { install: "partial" } });
  assert.equal(seen[0]?.file, "/usr/bin/lophn");
  assert.deepEqual(seen[0]?.args, [
    "connection",
    "install",
    "--connection",
    CAC,
    "--json",
  ]);
  assert.deepEqual(seen[0]?.env, { PATH: "/usr/bin", LOPHN_HOME: "/data" });

  const refused = await childCliRunner({
    command: "/usr/bin/lophn",
    env: {},
    exec: () =>
      Promise.resolve({
        code: 3,
        stdout: JSON.stringify({ error: { code: "forbidden", message: "no" } }),
      }),
  })(["doctor"]);
  assert.deepEqual(refused, {
    ok: false,
    error: { code: "forbidden", message: "no", details: undefined },
  });
  const noJson = await childCliRunner({
    command: "/usr/bin/lophn",
    env: {},
    exec: () => Promise.resolve({ code: 1, stdout: "not json" }),
  })(["doctor"]);
  assert.equal(noJson.ok, false);
});
