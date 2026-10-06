// core 안 apps 제어 조립의 권한 경계: supervisor 실행 권한, registry 발급 상한, 자식 앱의
// app credential. 실제 registry와 실제 launch spec 검사를 쓴다.
import { assert, assertEquals } from "@std/assert";
import { err, manualClock, ok } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
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
  createAppsControl,
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
  assertEquals([...app].sort(), ["ObserveException", "ReportProblem"]);
  assertEquals(
    operationCeiling("agent:asg_01arz3ndektsv4rrffq69g5fav", policies),
    ["app.connect"],
  );
  // coding agent는 connect에 더해 preview를 연다(apps/preview#R1). 사람은 route 상한 전체를 받는다.
  assertEquals(
    [
      ...operationCeiling(
        "coding_agent:cac_01arz3ndektsv4rrffq69g5fav",
        policies,
      ),
    ].sort(),
    ["app.connect", "previews.get", "previews.start", "previews.stop"],
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

Deno.test("apps/agent-context#R2, apps/agent-context#R5: 닫힌 화면 view는 사람 자격의 범위 안 앱만 supervisor의 지금 live 자식에 중계한다", async () => {
  const revoked = new Set<string>();
  const control = await createAppsControl({
    clock: manualClock(Date.parse("2026-10-06T00:00:00.000Z")),
    ledgerPath: "/nonexistent/ledger.db",
    readers: {
      read: () => Promise.resolve(err({ code: "unavailable", message: "x" })),
    },
    revalidate: (ref) =>
      revoked.has(ref)
        ? err({ code: "unauthorized", message: "revoked" })
        : ok(user(ref)),
    redact: (line) => line,
  });
  function user(ref = "cred-user", app?: string): AuthenticatedContext {
    return {
      principal: "user",
      actor: "user",
      scope: {
        operations: ["app.view_closed"],
        targets: app === undefined ? {} : { app: [app] },
      },
      conditions: {},
      credential_ref: ref,
    };
  }
  const handler = control.memory.get("apps/view_closed")!;
  const input = { app: APP, view_session: "view-1" };
  // supervisor가 없으면 닿지 못한다.
  const early = await handler(user(), input);
  assertEquals(early.ok ? "" : early.error.code, "unavailable");
  const sent: unknown[] = [];
  control.channel.bind((payload) => {
    sent.push(payload);
    const request = payload as { request_id: string; payload: unknown };
    queueMicrotask(() =>
      control.channel.onMessage({
        type: "worker_response",
        request_id: request.request_id,
        ok: true,
        payload: { relayed: true },
      } as { type: string })
    );
    return Promise.resolve(true);
  });
  assertEquals(await handler(user(), input), ok({ relayed: true }));
  assertEquals(sent, [{
    type: "worker_request",
    request_id: "apps-request-1",
    op: "apps.view_closed",
    payload: { app: APP, view_session: "view-1" },
  }]);
  // 범위 밖 앱은 없는 앱과 같고 supervisor에 닿지 않는다.
  const outside = await handler(user("cred-user", OTHER), input);
  assertEquals(outside.ok ? "" : outside.error.code, "not_found");
  revoked.add("cred-gone");
  const gone = await handler(user("cred-gone"), input);
  assertEquals(gone.ok ? "" : gone.error.code, "unauthorized");
  assertEquals(sent.length, 1);
  control.stop();
});
