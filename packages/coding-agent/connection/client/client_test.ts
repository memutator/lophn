import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../base/mod.ts";
import {
  connectionIdSchema,
  LOPHN_CONNECTION,
} from "../../../contracts/coding-agent/mod.ts";
import { runMetadataSchema } from "../../../contracts/platform/mod.ts";
import {
  acceptAddress,
  type DaemonAddressInputs,
  defaultAddress,
  installSettingsAddress,
  LOPHN_DAEMON_URL,
  resolveDaemonAddress,
  runMetadataAddress,
} from "./daemon.ts";
import { resolveTargetApp, scopeAllows, withinScope } from "./target-app.ts";

function timedOut(result: Result<unknown>, message: string) {
  assert(!result.ok, message);
  return result.error;
}

const at = "2026-10-05T00:00:00.000Z";
const runMetadata = {
  format: 1,
  api_port: 7442,
  core_epoch: "epoch-1",
  started_at: at,
};

Deno.test("coding-agent/connection#R15: daemon 주소는 option → env → 현재 연결 정보 → 설치 설정 → 기본 순서다", () => {
  // 다섯 단계가 모두 있으면 첫 단계다.
  const first = resolveDaemonAddress({
    option: "http://127.0.0.1:7440",
    env: "http://localhost:7441",
    runMetadata,
    installSettings: { port: 7443 },
  });
  assertEquals(first.ok && first.value.url, "http://127.0.0.1:7440");
  assertEquals(first.ok && first.value.source, "option");

  // 옵션이 없으면 env다.
  const second = resolveDaemonAddress({
    env: "http://localhost:7441",
    runMetadata,
    installSettings: { port: 7443 },
  });
  assertEquals(second.ok && second.value.url, "http://localhost:7441");
  assertEquals(second.ok && second.value.source, "env");

  // env가 없으면 현재 daemon 연결 정보(H/run 위치 metadata)다.
  const third: Result<unknown> = resolveDaemonAddress({
    runMetadata,
    installSettings: { port: 7443 },
  });
  assertEquals(
    third.ok && (third.value as { url: string }).url,
    "http://127.0.0.1:7442",
  );
  assertEquals(
    third.ok && (third.value as { source: string }).source,
    "run_metadata",
  );

  // 현재 연결 정보가 없으면 설치 설정이다.
  const fourth = resolveDaemonAddress({
    installSettings: { host: "127.0.0.1", port: 7443 },
  });
  assertEquals(fourth.ok && fourth.value.url, "http://127.0.0.1:7443");
  assertEquals(fourth.ok && fourth.value.source, "install_settings");

  // 아무 단서도 없으면 기본 port 7431이다(R15의 마지막 단계).
  const fifth = resolveDaemonAddress({} as DaemonAddressInputs);
  assertEquals(fifth.ok && fifth.value.url, "http://127.0.0.1:7431");
  assertEquals(fifth.ok && fifth.value.source, "default");
  assertEquals(defaultAddress().url, "http://127.0.0.1:7431");
});

Deno.test("coding-agent/connection#R15: loopback 아닌 명시 주소는 거절이고 http 밖 scheme도 거절이다", () => {
  // 명시 주소의 거절은 다음 단계로 내려가지 않는다.
  const remote = resolveDaemonAddress({
    option: "http://10.0.0.4:7440",
    env: "http://127.0.0.1:7441",
  });
  assertEquals(timedOut(remote, "remote").code, "invalid_input");

  const inet6 = acceptAddress("http://[fe80::1]:7440", "option");
  assertEquals(inet6.ok, false);

  const https = acceptAddress("https://127.0.0.1:7440", "option");
  assertEquals(https.ok, false);

  const broken = acceptAddress("not a url", "env");
  assertEquals(broken.ok, false);

  // env 이름은 contracts와 같다.
  assertEquals(LOPHN_DAEMON_URL, "LOPHN_DAEMON_URL");
});

Deno.test("coding-agent/connection#R15: 현재 daemon 연결 정보와 설치 설정도 loopback만 받는다", () => {
  const parsed = runMetadataSchema.safeParse(runMetadata);
  assertEquals(parsed.success, true);
  const located = runMetadataAddress(runMetadata);
  assertEquals(located.ok && located.value.url, "http://127.0.0.1:7442");

  // 위치 metadata가 올바르지 않으면 거절이다.
  const broken = runMetadataAddress({ api_port: 7442 });
  assertEquals(broken.ok, false);

  // 설치 설정의 host도 loopback이다.
  const foreign = installSettingsAddress({ host: "10.0.0.4", port: 7443 });
  assertEquals(foreign.ok, false);

  const portless = installSettingsAddress({});
  assertEquals(portless.ok, false);
});

Deno.test("coding-agent/connection#R11: 대상 앱은 option → env → blueprint 순서다", () => {
  const blueprint = {
    name: "notes",
    description: "keep notes",
    screens: [],
    commands: [],
    automatic_tasks: [],
    permissions: [],
    problem_codes: [],
    documents: [],
    agent_context: [],
    app_connections: [],
    sdk_dependencies: [],
  };
  const found = resolveTargetApp({
    option: "app_01arz3ndektsv4rrffq69g5fav",
    env: "app_01arz3ndektsv4rrffq69g5faw",
    blueprintValue: blueprint,
  });
  assertEquals(found.ok && found.value.app, "app_01arz3ndektsv4rrffq69g5fav");
  assertEquals(found.ok && found.value.source, "option");

  const fromEnv = resolveTargetApp({
    env: "app_01arz3ndektsv4rrffq69g5faw",
    blueprintValue: blueprint,
  });
  assertEquals(
    fromEnv.ok && fromEnv.value.app,
    "app_01arz3ndektsv4rrffq69g5faw",
  );
  assertEquals(fromEnv.ok && fromEnv.value.source, "env");

  // 실제 lophn_app_00... 형태는 app ID다. blueprint는 작업 폴더 기준 값이고
  // 검증은 apps blueprint 검증기가 만든다.
  const appBlueprint = {
    ...blueprint,
    name: "app_01arz3ndektsv4rrffq69g5fav",
  };
  const fromBlueprint = resolveTargetApp({ blueprintValue: appBlueprint });
  assertEquals(
    fromBlueprint.ok && fromBlueprint.value.app,
    "app_01arz3ndektsv4rrffq69g5fav",
  );
  assertEquals(fromBlueprint.ok && fromBlueprint.value.source, "blueprint");

  const missing = resolveTargetApp({});
  assertEquals(missing.ok, false);
});

Deno.test("coding-agent/connection#R11: 찾은 앱을 connection scope와 다시 비교해 범위 밖이면 거절이다", () => {
  const app = "app_01arz3ndektsv4rrffq69g5fav";
  const other = "app_01arz3ndektsv4rrffq69g5faw";

  // app scope는 그 앱 하나만 본다.
  assertEquals(
    scopeAllows({ kind: "app", app }, app),
    true,
  );
  assertEquals(
    scopeAllows({ kind: "app", app }, other),
    false,
  );
  assertEquals(scopeAllows({ kind: "all", app: null }, other), true);

  const target = { app: other, source: "option" as const };
  const outside = withinScope(target, { kind: "app", app });
  assertEquals(outside.ok, false);
  if (!outside.ok) assertEquals(outside.error.code, "forbidden");

  const inside = withinScope({ app, source: "option" }, { kind: "app", app });
  assertEquals(inside.ok, true);
});

Deno.test("coding-agent/connection#R15: connection 참조는 --connection과 env 참조만 있다", () => {
  const parsed = connectionIdSchema.safeParse(
    "cac_01arz3ndektsv4rrffq69g5fav",
  );
  assertEquals(parsed.success, true);
  assertEquals(LOPHN_CONNECTION, "LOPHN_CONNECTION");
});
