// core 안 apps 제어 조립의 권한 경계: supervisor 실행 권한, registry 발급 상한, 자식 앱의
// app credential. 실제 registry와 실제 launch spec 검사를 쓴다.
import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../packages/base/mod.ts";
import { CredentialRegistry } from "../../packages/platform/identity/mod.ts";
import { operationCeiling } from "../../packages/platform/identity/model.ts";
import {
  checkLaunchSpec,
  launchArgv,
} from "../../packages/platform/security/mod.ts";
import {
  appCredentialIssuer,
  appsOperationPolicies,
  appSupervisorSpec,
  SUPERVISOR_CREDENTIAL_OPERATIONS,
} from "./apps-control.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const OTHER = "app_01arz3ndektsv4rrffq69g5faw";
const REL = "rel_01arz3ndektsv4rrffq69g5fav";

function registry() {
  return new CredentialRegistry({
    epoch: "core-one",
    clock: manualClock(Date.parse("2026-10-06T00:00:00.000Z")),
    random: { fill: (bytes: Uint8Array) => crypto.getRandomValues(bytes) },
    operations: appsOperationPolicies(),
  });
}

Deno.test("apps/runtime#R24: supervisor 실행 권한은 데이터 root·코드 읽기, 앱 socket 쓰기, core loopback과 앱 socket 자리 net, 설치된 Deno와 group 종료만이다", () => {
  const spec = appSupervisorSpec({
    dataRoot: "/data/lophn",
    apiPort: 7431,
    runtimeDir: "/run/user/1000",
  });
  const checked = checkLaunchSpec(spec);
  assert(checked.ok, checked.ok ? "" : checked.error.message);
  assertEquals(spec.kind, "apps/supervisor");
  assertEquals(spec.policy, "always");
  assertEquals(spec.allow_write, ["/run/user/1000/lophn"]);
  assertEquals(spec.allow_run, [Deno.execPath(), "/usr/bin/kill"]);
  assertEquals(spec.allow_sys, ["uid"]);
  assert(spec.allow_read.includes("/data/lophn"));
  assert(spec.allow_net.includes("127.0.0.1:7431"));
  // 가상 host와 앱 socket 자리의 정확한 경로만이다. 외부 host·와일드카드는 없다.
  const hosts = spec.allow_net.filter((entry) => !entry.startsWith("unix:"));
  assertEquals(hosts, ["127.0.0.1:7431", "lophn.invalid"]);
  assertEquals(
    spec.allow_net.filter((entry) => entry.startsWith("unix:")).length,
    128,
  );
  assert(spec.allow_net.every((entry) => !entry.includes("*")));
  const argv = launchArgv(spec);
  // credential은 argv에 없다. 허락은 flag 하나씩이다.
  assert(argv.some((arg) => arg.startsWith("--allow-net=127.0.0.1:7431,")));
  assert(!argv.some((arg) => arg === "--allow-all" || arg === "-A"));
  assert(!argv.some((arg) => arg.startsWith("--allow-ffi")));
});

Deno.test("apps/runtime#R9: registry 상한은 machine에게 관측 기록과 제어 connection만, 자식 앱에게 문제 보고만 연다", () => {
  const policies = appsOperationPolicies();
  const machine = operationCeiling("machine", policies);
  // supervisor의 관측 기록·제어 connection에 더해 collector가 자기 앱 log를 읽는 app.logs다.
  assertEquals(
    [...machine].sort(),
    [...SUPERVISOR_CREDENTIAL_OPERATIONS, "app.logs"].sort(),
  );
  // 앱 자식은 app.connect·record_*를 받지 못한다. agent는 connect만 받는다.
  const app = operationCeiling(`app:${APP}`, policies);
  // 상한이다: 앱 자식에게 주는 credential은 문제 보고 둘뿐이고(아래 R7), approval 요청은 core가 한 번의
  // confirm 요청을 위해서만 발급하는 짧은 자격이 쓴다.
  assertEquals(
    [...app].sort(),
    ["ObserveException", "ReportProblem", "create_approval_request"],
  );
  assertEquals(
    operationCeiling("agent:asg_01arz3ndektsv4rrffq69g5fav", policies),
    ["app.connect"],
  );
  assertEquals(
    operationCeiling("coding_agent:cac_01arz3ndektsv4rrffq69g5fav", policies),
    [
      "app.connect",
    ],
  );
});

Deno.test("apps/runtime#R7: 자식 앱 credential은 그 앱·release·프로세스에 묶이고 앱 영역의 다른 operation에 닿지 않는다", async () => {
  const keys = registry();
  const issuer = appCredentialIssuer(keys);
  const request = (app: string, process: string) => ({
    type: "app_credential_request",
    request_id: `req-${process}`,
    app,
    release: REL,
    process,
    mode: "live",
    bundle_hash: "ab".repeat(32),
  });
  const first = await issuer.request(request(APP, "nonce-1"));
  assert(first.ok, first.ok ? "" : first.error.message);
  const context = await keys.authenticate(first.value.credential);
  assert(context.ok);
  assertEquals(context.value.actor, `app:${APP}`);
  assertEquals(context.value.scope.operations.sort(), [
    "ObserveException",
    "ReportProblem",
  ]);
  assertEquals(context.value.conditions.process, "nonce-1");
  assertEquals(context.value.conditions.release, REL);
  assertEquals(context.value.scope.targets.app, APP);
  // supervisor만 하는 일에는 닿지 않는다.
  for (const operation of SUPERVISOR_CREDENTIAL_OPERATIONS) {
    assert(!keys.authorize(context.value, operation, { app: APP }).ok);
  }
  // 다른 앱을 대상으로는 닿지 못한다.
  assert(!keys.authorize(context.value, "ReportProblem", { app: OTHER }).ok);
  // 같은 앱의 새 자식이 오면 이전 자식의 credential은 끝난다.
  issuer.endApp(APP);
  const second = await issuer.request(request(APP, "nonce-2"));
  assert(second.ok);
  assert(!(await keys.authenticate(first.value.credential)).ok);
  assert((await keys.authenticate(second.value.credential)).ok);
});

Deno.test("apps/permissions#R14, apps/connections#R1: supervisor machine credential은 실행 범위·앱 쌍 준비 route에 닿고 core 안쪽 operation에는 닿지 않는다", async () => {
  const keys = registry();
  // core가 supervisor를 띄울 때 발급하는 자격과 같은 모양이다.
  const issued = await keys.issue({
    actor: "machine",
    principal: "machine:apps-supervisor",
    scope: {
      operations: [...SUPERVISOR_CREDENTIAL_OPERATIONS],
      targets: { task: "apps" },
    },
    conditions: { task: "apps", process: "apps/supervisor" },
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  const context = await keys.authenticate(issued.value.token);
  assert(context.ok);
  for (
    const operation of [
      "app.blueprint",
      "grants.list",
      "app.pair_prepare",
      "app.pair_confirm_request",
      "app.pair_confirm_poll",
      "app.pair_observe",
    ]
  ) {
    assert(
      SUPERVISOR_CREDENTIAL_OPERATIONS.includes(operation),
      `${operation} is not in the supervisor scope`,
    );
    // 앱을 대상으로 하는 읽기·준비는 모든 앱에 닿는다(supervisor는 앱 전체를 감독한다).
    assert(
      keys.authorize(context.value, operation, { app: APP, task: "apps" }).ok,
      operation,
    );
  }
  // release 확정·grant 변경·approval 같은 core 안쪽 일은 supervisor 자격으로 하지 못한다.
  for (
    const operation of [
      "release.prepare",
      "grant.create",
      "grant.revoke",
      "create_approval_request",
      "apply_approved_action",
    ]
  ) {
    assert(!keys.authorize(context.value, operation, { app: APP }).ok);
  }
  // 앱 자식의 app credential은 이 route 어디에도 닿지 않는다.
  const child = await appCredentialIssuer(keys).request({
    type: "app_credential_request",
    request_id: "req-1",
    app: APP,
    release: REL,
    process: "nonce-1",
    mode: "live",
    bundle_hash: "ab".repeat(32),
  });
  assert(child.ok);
  const childContext = await keys.authenticate(child.value.credential);
  assert(childContext.ok);
  for (const operation of SUPERVISOR_CREDENTIAL_OPERATIONS) {
    assert(!keys.authorize(childContext.value, operation, { app: APP }).ok);
  }
});
