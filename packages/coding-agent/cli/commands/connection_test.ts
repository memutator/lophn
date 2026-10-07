// `connection` command 시험이다(cli#R40, connection#R2·R9·R12, harnesses#R6). 설치·doctor·core는 port
// 대역이고 사람의 실제 설정 root·keychain은 열지 않는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { err, ok } from "../../../base/mod.ts";
import type {
  ConnectionId,
  IntegrationTarget,
} from "../../../contracts/coding-agent/mod.ts";
import type { InstallOutcome } from "../../harnesses/mod.ts";
import {
  connectAndInstall,
  type ConnectFlowPorts,
  CONNECTION_COMMANDS,
  connectionRevokeGuide,
  humanDecisionGuide,
  runConnectionInstall,
} from "./connection.ts";
import type { DoctorReport } from "./doctor.ts";

const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1" as ConnectionId;
const APP_A = "app_01h455vb4pex5v6nkc6gd5fdw1";
const APP_B = "app_01arz3ndektsv4rrffq69g5fav";

const USER_TARGET: IntegrationTarget = {
  scope_kind: "user",
  environment: { kind: "host", identity: "fixture" },
  profile_id: null,
  harness_id: "claude",
  app: null,
  app_realpath: null,
};

const APP_TARGET: IntegrationTarget = {
  scope_kind: "app",
  environment: { kind: "host", identity: "fixture" },
  profile_id: null,
  harness_id: "claude",
  app: APP_A,
  app_realpath: "/work/app",
};

function outcome(status: InstallOutcome["status"]): InstallOutcome {
  return {
    status,
    resources: [{
      resource_identity: "mcp:user",
      outcome: status === "complete" ? "changed" : "conflict",
      receipt_stored: status === "complete",
      reason: "시험",
    }],
    notices: [],
    receipt_stored: status === "complete",
    recovery_pending: false,
  };
}

const DOCTOR = { daemon: { result: "success" } } as unknown as DoctorReport;

Deno.test("coding-agent/cli#R40: connection 표는 list·show를 소유 읽기 route로, create·revoke·install을 route 없이 둔다", () => {
  const byName = new Map(
    CONNECTION_COMMANDS.map((entry) => [entry.name, entry]),
  );
  assertEquals([...byName.keys()], [
    "connection list",
    "connection show",
    "connection create",
    "connection revoke",
    "connection install",
  ]);
  assertEquals(byName.get("connection list")?.monoRoute?.kind, "read");
  assertEquals(byName.get("connection show")?.monoRoute?.kind, "read");
  assertEquals(byName.get("connection install")?.monoRoute, undefined);
  const guide = humanDecisionGuide("connection create");
  assert(guide.isError);
  assert(guide.summary.includes("사람"));
});

Deno.test("coding-agent/cli#R40 coding-agent/connection#R2: coding credential context는 연결 설치를 거절하고 아무것도 설치하지 않는다", async () => {
  let installs = 0;
  const result = await runConnectionInstall(
    { connection: CAC, target: USER_TARGET },
    {
      actor: "coding_agent",
      connections: { read: () => Promise.resolve(ok({ state: "active" })) },
      install: () => {
        installs += 1;
        return Promise.resolve(ok(outcome("complete")));
      },
    },
  );
  assertFalse(result.ok);
  assertEquals(result.error.code, "forbidden");
  assertEquals(installs, 0);
});

Deno.test("coding-agent/harnesses#R6 coding-agent/cli#R40: connection install은 기존 active connection의 선택 target만 설치하고 자동 재발급이 없다", async () => {
  const seen: { connection: string; target: IntegrationTarget }[] = [];
  const result = await runConnectionInstall(
    { connection: CAC, target: APP_TARGET },
    {
      actor: "user",
      connections: { read: () => Promise.resolve(ok({ state: "active" })) },
      install: (connection, target) => {
        seen.push({ connection, target });
        return Promise.resolve(ok(outcome("complete")));
      },
    },
  );
  assert(result.ok);
  assertEquals(result.value.isError, undefined);
  assertEquals(seen, [{ connection: CAC, target: APP_TARGET }]);
  assertFalse(JSON.stringify(result.value).toLowerCase().includes("token"));
});

Deno.test("coding-agent/connection#R9: 회수된 connection은 설치하지 않고 새 연결을 만들라고만 안내하며 없는 connection은 같은 not_found다", async () => {
  let installs = 0;
  const deps = (state: "active" | "revoked" | "absent") => ({
    actor: "user" as const,
    connections: {
      read: () =>
        Promise.resolve(
          state === "absent"
            ? err({ code: "not_found" as const, message: "다른 사유" })
            : ok({ state }),
        ),
    },
    install: () => {
      installs += 1;
      return Promise.resolve(ok(outcome("complete")));
    },
  });
  const revoked = await runConnectionInstall(
    { connection: CAC, target: USER_TARGET },
    deps("revoked"),
  );
  assert(revoked.ok);
  assert(revoked.value.isError);
  assert(revoked.value.next.join(" ").includes("새 연결"));
  const absent = await runConnectionInstall(
    { connection: CAC, target: USER_TARGET },
    deps("absent"),
  );
  assertFalse(absent.ok);
  assertEquals(absent.error.code, "not_found");
  assertEquals(absent.error.message, "연결을 읽을 수 없다");
  const missing = await runConnectionInstall(
    { target: USER_TARGET },
    deps("active"),
  );
  assertFalse(missing.ok);
  assertEquals(missing.error.code, "invalid_input");
  assertEquals(installs, 0);
});

function ports(
  overrides: Partial<ConnectFlowPorts>,
  calls: string[],
): ConnectFlowPorts {
  return {
    connect: () => {
      calls.push("connect");
      return Promise.resolve(ok({ connection: CAC }));
    },
    install: () => {
      calls.push("install");
      return Promise.resolve(ok(outcome("complete")));
    },
    doctor: () => {
      calls.push("doctor");
      return Promise.resolve(ok(DOCTOR));
    },
    ...overrides,
  };
}

Deno.test("coding-agent/connection#R2: 연결 흐름은 사람 선택 → connection 생성 → 선택 target 설치 → doctor 순서이고 token 단계가 없다", async () => {
  const calls: string[] = [];
  const result = await connectAndInstall({
    label: "claude",
    scope: { kind: "all", app: null },
    target: USER_TARGET,
  }, ports({}, calls));
  assert(result.ok);
  assertEquals(calls, ["connect", "install", "doctor"]);
  assertEquals(result.value.connection, CAC);
  assertEquals(result.value.install.status, "complete");
  assert(result.value.doctor !== null);
  assertFalse(JSON.stringify(result.value).toLowerCase().includes("token"));
});

Deno.test("coding-agent/connection#R2: 보관 준비가 실패해 connection이 만들어지지 않으면 설치도 doctor도 시작하지 않는다", async () => {
  const calls: string[] = [];
  const result = await connectAndInstall(
    {
      label: "claude",
      scope: { kind: "all", app: null },
      target: USER_TARGET,
    },
    ports({
      connect: () => {
        calls.push("connect");
        return Promise.resolve(
          err({
            code: "unavailable",
            message: "credential 준비를 사용할 수 없다",
          }),
        );
      },
    }, calls),
  );
  assertFalse(result.ok);
  assertEquals(result.error.code, "unavailable");
  assertEquals(calls, ["connect"]);
});

Deno.test("coding-agent/connection#R2 coding-agent/connection#R12: 설치 실패는 connection 성공과 따로 partial·error로 보이고 재발급·회수를 하지 않는다", async () => {
  const partialCalls: string[] = [];
  const partial = await connectAndInstall(
    {
      label: "claude",
      scope: { kind: "all", app: null },
      target: USER_TARGET,
    },
    ports({
      install: () => {
        partialCalls.push("install");
        return Promise.resolve(ok(outcome("partial")));
      },
    }, partialCalls),
  );
  assert(partial.ok);
  assertEquals(partial.value.connection, CAC);
  assertEquals(partial.value.install.status, "partial");
  // 설치가 일부만 됐어도 connect는 한 번뿐이다(재발급 없음). doctor는 읽기로 이어진다.
  assertEquals(partialCalls.filter((name) => name === "connect").length, 1);
  assert(partial.value.doctor !== null);

  const errorCalls: string[] = [];
  const failed = await connectAndInstall(
    {
      label: "claude",
      scope: { kind: "all", app: null },
      target: USER_TARGET,
    },
    ports({
      install: () => {
        errorCalls.push("install");
        return Promise.resolve(
          err({ code: "unavailable", message: "지원하지 않는 환경이다" }),
        );
      },
    }, errorCalls),
  );
  assert(failed.ok);
  assertEquals(failed.value.install.status, "error");
  assertEquals(errorCalls.filter((name) => name === "connect").length, 1);
});

Deno.test("coding-agent/connection#R2: 연결 범위의 앱과 설치 target의 앱이 다르면 발급 전에 거절한다", async () => {
  const calls: string[] = [];
  const result = await connectAndInstall({
    label: "claude",
    scope: { kind: "app", app: APP_B },
    target: APP_TARGET,
  }, ports({}, calls));
  assertFalse(result.ok);
  assertEquals(result.error.code, "invalid_input");
  assertEquals(calls, []);
});

Deno.test("coding-agent/cli#R7 coding-agent/connection#R2: connection revoke는 결정 화면 링크와 기다린다는 사실만 낸다", () => {
  const guide = connectionRevokeGuide({ connection: CAC, base_revision: "7" });
  assert(guide.isError);
  assertEquals(guide.data, {
    command: "connection revoke",
    human_only: true,
    connection: CAC,
    base_revision: "7",
    decision_link: `lophn://things-to-confirm/${CAC}`,
    waiting: true,
    window_opened: false,
    revoked: false,
  });
  assert(guide.summary.includes("기다리는 중"));
  assert(guide.summary.includes("아무것도 회수하지 않았다"));
  assert(guide.next[0].includes(`lophn://things-to-confirm/${CAC}`));
});

Deno.test("coding-agent/connection#R18: 회수 안내는 외부 프로세스·OS 파일 편집을 멈췄거나 멈춘다고 말하지 않는다", () => {
  const text = JSON.stringify(
    connectionRevokeGuide({ connection: CAC, base_revision: "7" }),
  );
  assert(text.includes("멈추지는 않는다"));
  for (const claim of ["종료했", "중단했", "멈췄", "강제로 멈춘다"]) {
    assertFalse(text.includes(claim), claim);
  }
});
