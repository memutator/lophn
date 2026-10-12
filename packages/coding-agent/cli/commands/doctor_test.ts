// `lophn doctor` 테스트다(coding-agent/cli#R10, harnesses#R8·R10,
// connection#R13·R14, T32). daemon·인증·설정·네 loading 단계가 따로 나오고
// 읽기만 하는지 본다. 모든 root는 temp fixture이고 실제 harness binary나 사람의
// 설정 root는 열지 않는다. MCP server는 harnesses/testing의 대역이다.
import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "@std/assert";
import { err, ok } from "../../../base/mod.ts";
import {
  type CredentialDeliveryFailure,
  harnessIntegrationObservationSchema,
} from "../../../protocol/coding-agent/mod.ts";
import { filePort, stdioMcpProbe, storeOf } from "../../harnesses/mod.ts";
import {
  CAC,
  EXPECTED_TOOLS,
  type Fixture,
  fixture,
  fixtureLaunch,
  installWithReceipt,
  NOW,
  rootFor,
  SKILLS,
  snapshotAll,
  targetOf,
  write,
  writeGuide,
  writeMcpConfig,
  writeSkills,
} from "../../harnesses/testing/mod.ts";
import { findCommand } from "../registry.ts";
import {
  DOCTOR_COMMANDS,
  type DoctorInput,
  doctorOf,
  type DoctorPorts,
  doctorSummary,
} from "./doctor.ts";

type Facts = {
  daemon?: "absent" | "running" | "conflict" | "unreadable";
  connection?: "active" | "revoked" | "unreadable";
  credential?: "available" | CredentialDeliveryFailure;
};

function portsFor(fx: Fixture, facts: Facts = {}) {
  const asked: string[] = [];
  const ports: DoctorPorts = {
    files: filePort(),
    mcp: stdioMcpProbe({
      timeout_ms: 8_000,
      ambient: (name) =>
        ({
          PATH: "/usr/bin:/bin",
          HOME: fx.home,
          DENO_DIR: `${fx.base}/deno`,
        })[name],
    }),
    store: storeOf(fx.lophn),
    daemon: {
      status() {
        const state = facts.daemon ?? "running";
        if (state === "unreadable") {
          return Promise.resolve(
            err({ code: "unavailable", message: "status" }),
          );
        }
        return Promise.resolve(ok({ state, metadata: "present" as const }));
      },
    },
    connections: {
      read() {
        const state = facts.connection ?? "active";
        if (state === "unreadable") {
          return Promise.resolve(
            err({ code: "unavailable", message: "connections" }),
          );
        }
        return Promise.resolve(ok({ state }));
      },
    },
    credential: {
      available(id) {
        asked.push(id);
        return Promise.resolve(facts.credential ?? "available");
      },
    },
  };
  return { ports, asked };
}

function inputFor(
  fx: Fixture,
  harness: "claude" | "codex" | "hermes",
  scope: "user" | "app",
  extra: Partial<DoctorInput> = {},
): DoctorInput {
  return {
    target: targetOf(harness, scope, fx),
    connection: CAC,
    roots: { home: fx.home, env: fx.env, cwd: fx.project },
    denoExecutable: Deno.execPath(),
    now: NOW,
    expectedTools: EXPECTED_TOOLS,
    ...extra,
  };
}

async function claudeApp(fx: Fixture, mode = "ok"): Promise<void> {
  await installWithReceipt(
    fx,
    "claude",
    "app",
    fixtureLaunch(mode),
    "lophn-save",
  );
  await writeSkills(`${fx.project}/.claude/skills`, SKILLS);
  await writeGuide(fx, "claude");
}

Deno.test("coding-agent/cli#R10: doctor는 daemon·인증·설정과 네 loading 단계를 따로 낸다", async () => {
  const fx = await fixture();
  try {
    await claudeApp(fx);
    const { ports } = portsFor(fx);
    const result = await doctorOf(
      inputFor(fx, "claude", "app", { trust: "trusted" }),
      ports,
    );
    assert(result.ok);
    if (!result.ok) return;
    const report = result.value;
    assertEquals(report.daemon.result, "success");
    assertEquals(report.auth.result, "success");
    assertEquals(report.auth.credential, "available");
    assertEquals(report.config.receipt, "present");
    assertEquals(
      report.config.components.map((item) => `${item.kind}:${item.state}`)
        .sort(),
      ["mcp:current", "skill:current"],
    );
    assertEquals(report.loading.map((item) => item.stage), [
      "mcp_initialize",
      "tool_discovery",
      "skill_discovery",
      "app_guide_loading",
    ]);
    assertEquals(report.loading.map((item) => item.result), [
      "success",
      "success",
      "success",
      "success",
    ]);
    // 관측은 contract schema를 통과한다.
    assert(report.observation !== null);
    harnessIntegrationObservationSchema.parse(report.observation);
    const summary = doctorSummary(report);
    assertStringIncludes(summary.summary, "mcp_initialize success");
    assertEquals(summary.next, []);
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/cli#R10: daemon·인증 실패와 loading 결과는 서로 섞이지 않는다", async () => {
  const fx = await fixture();
  try {
    await claudeApp(fx);
    const down = portsFor(fx, { daemon: "absent", credential: "locked" });
    const result = await doctorOf(
      inputFor(fx, "claude", "app", { trust: "trusted" }),
      down.ports,
    );
    assert(result.ok);
    if (!result.ok) return;
    assertEquals(result.value.daemon.result, "failure");
    assertStringIncludes(result.value.daemon.next, "lophn daemon start");
    assertEquals(result.value.auth.result, "failure");
    assertEquals(result.value.auth.credential, "locked");
    assertStringIncludes(result.value.auth.next, "평문 fallback은 없다");
    // 같은 fixture의 loading은 daemon·credential과 무관하게 success다.
    assertEquals(
      result.value.loading.map((item) => item.result),
      ["success", "success", "success", "success"],
    );
    const summary = doctorSummary(result.value);
    assertEquals(summary.next.length, 2);

    // 상태를 읽지 못하면 unknown이다.
    const blind = portsFor(fx, {
      daemon: "unreadable",
      connection: "unreadable",
    });
    const unknown = await doctorOf(
      inputFor(fx, "claude", "app", { trust: "trusted" }),
      blind.ports,
    );
    assert(unknown.ok);
    if (!unknown.ok) return;
    assertEquals(unknown.value.daemon.result, "unknown");
    assertEquals(unknown.value.auth.result, "unknown");
    assertEquals(blind.asked, []);
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/connection#R13: active 연결과 credential이 있어도 설치가 없으면 mcp_initialize는 failure다", async () => {
  const fx = await fixture();
  try {
    const { ports, asked } = portsFor(fx);
    const result = await doctorOf(inputFor(fx, "codex", "user"), ports);
    assert(result.ok);
    if (!result.ok) return;
    assertEquals(result.value.auth.result, "success");
    assertEquals(asked, [CAC]);
    assertEquals(result.value.config.receipt, "absent");
    assertEquals(result.value.loading[0].stage, "mcp_initialize");
    assertEquals(result.value.loading[0].result, "failure");
    assertStringIncludes(
      result.value.loading[0].next,
      "lophn harness plan",
    );
    // credential 원문은 결과 어디에도 없다.
    assertFalse(JSON.stringify(result.value).includes("token"));
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/connection#R13: 회수된 연결은 credential을 묻지 않고 인증·mcp 단계가 이유를 낸다", async () => {
  const fx = await fixture();
  try {
    await claudeApp(fx);
    const { ports, asked } = portsFor(fx, { connection: "revoked" });
    const result = await doctorOf(
      inputFor(fx, "claude", "app", { trust: "trusted" }),
      ports,
    );
    assert(result.ok);
    if (!result.ok) return;
    assertEquals(result.value.auth.result, "failure");
    assertEquals(result.value.auth.connection_state, "revoked");
    assertEquals(result.value.auth.credential, "not_checked");
    assertEquals(asked, []);
    assertEquals(result.value.loading[0].result, "failure");
    assertStringIncludes(result.value.loading[0].reason, "회수");
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/cli#R10: target이 없으면 daemon·인증만 보고 loading 네 단계는 검사하지 않은 unknown이다", async () => {
  const fx = await fixture();
  try {
    const { ports } = portsFor(fx);
    const result = await doctorOf(
      { ...inputFor(fx, "codex", "user"), target: undefined, connection: null },
      ports,
    );
    assert(result.ok);
    if (!result.ok) return;
    assertEquals(result.value.daemon.result, "success");
    assertEquals(result.value.auth.result, "unknown");
    assertEquals(result.value.auth.connection_state, "not_selected");
    assertEquals(result.value.observation, null);
    assertEquals(result.value.config.receipt, "not_selected");
    assertEquals(result.value.loading.length, 4);
    for (const item of result.value.loading) {
      assertEquals(item.result, "unknown");
      assertStringIncludes(item.reason, "target");
    }
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/harnesses#R8: doctor는 깨진 Hermes YAML을 loading 실패 이유로 내고 파일을 고치지 않는다", async () => {
  const fx = await fixture();
  try {
    const path = `${rootFor(fx, "hermes_home")}/config.yaml`;
    const broken = "mcp_servers:\n  lophn: {\n";
    await write(path, broken);
    const before = await snapshotAll(fx);
    const { ports } = portsFor(fx);
    const result = await doctorOf(inputFor(fx, "hermes", "user"), ports);
    assert(result.ok);
    if (!result.ok) return;
    const init = result.value.loading[0];
    assertEquals(init.stage, "mcp_initialize");
    assertEquals(init.result, "failure");
    assertStringIncludes(init.reason, "깨진 YAML");
    assertStringIncludes(init.reason, "기본값으로 대체");
    assertStringIncludes(init.next, "고치지 않는다");
    assertEquals(result.value.loading[1].result, "unknown");
    const summary = doctorSummary(result.value);
    assert(summary.next.some((item) => item.includes("고치지 않는다")));
    assertEquals(await Deno.readTextFile(path), broken);
    assertEquals(await snapshotAll(fx), before);
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/connection#R14: doctor는 override·workspace 사례를 보여 주되 설정과 workspace를 바꾸지 않는다", async () => {
  const fx = await fixture();
  try {
    await claudeApp(fx);
    await writeGuide(fx, "codex");
    await write(`${fx.project}/AGENTS.override.md`, "# mine\n");
    await writeMcpConfig(fx, "codex", "user", fixtureLaunch());
    const before = await snapshotAll(fx);
    const { ports } = portsFor(fx);
    const override = await doctorOf(
      inputFor(fx, "codex", "app", { trust: "trusted" }),
      ports,
    );
    assert(override.ok);
    if (!override.ok) return;
    assertEquals(override.value.loading[0].result, "success");
    assertEquals(override.value.loading[3].result, "failure");
    assertStringIncludes(
      override.value.loading[3].reason,
      "AGENTS.override.md",
    );

    const away = `${fx.base}/elsewhere`;
    await Deno.mkdir(away);
    const workspace = await doctorOf(
      inputFor(fx, "claude", "app", { trust: "trusted", workspace: away }),
      ports,
    );
    assert(workspace.ok);
    if (!workspace.ok) return;
    assertEquals(
      workspace.value.loading.map((item) => item.result),
      ["unknown", "unknown", "unknown", "unknown"],
    );
    assertEquals(await snapshotAll(fx), before);
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/cli#R10: WSL·remote target은 미지원 안내로 끝난다", async () => {
  const fx = await fixture();
  try {
    const { ports } = portsFor(fx);
    const base = inputFor(fx, "codex", "user");
    const result = await doctorOf({
      ...base,
      target: {
        ...base.target!,
        environment: { kind: "wsl", identity: "Ubuntu" },
      },
    }, ports);
    assertFalse(result.ok);
    if (result.ok) return;
    assertEquals(result.error.code, "invalid_input");
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/cli#R10: doctor는 command 표에 있고 target 선택값만 받는다", () => {
  assertEquals(DOCTOR_COMMANDS.length, 1);
  const entry = findCommand("doctor");
  assert(entry !== undefined);
  assertEquals(entry!.input.safeParse({ command: "doctor" }).success, true);
  assertEquals(
    entry!.input.safeParse({ command: "doctor", token: "x" }).success,
    false,
  );
});
