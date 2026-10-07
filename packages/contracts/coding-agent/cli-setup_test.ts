import { assert, assertEquals } from "@std/assert";
import {
  CLI_SETUP_COMMANDS,
  CLI_SETUP_NAMES,
  cliConnectionCreateSchema,
  cliConnectionInstallSchema,
  cliConnectionListSchema,
  cliConnectionRevokeSchema,
  cliConnectionShowSchema,
  cliDaemonLogsSchema,
  cliDaemonStartSchema,
  cliDaemonStatusSchema,
  cliDaemonStopSchema,
  cliDoctorSchema,
  cliHarnessDetectSchema,
  cliHarnessInspectSchema,
  cliHarnessInstallSchema,
  cliHarnessListSchema,
  cliHarnessPlanSchema,
  cliHarnessRefreshSchema,
  cliHarnessRemoveSchema,
  cliHarnessUpdateSchema,
  cliMcpConfigSchema,
  cliSessionPlanSchema,
  cliSessionSummarySchema,
  cliSkillsInstallSchema,
  cliSkillsListSchema,
  CONFIRMATION_NAMES,
  HUMAN_ONLY_NAMES,
} from "./cli-setup.ts";
import { codingAgentLaunchPlanSchema } from "./launch.ts";
import { AT, CAC, TKT } from "./ticket-fixtures.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const PRJ = "prj_01h455vb4pex5v6nkc6gd5fdw1";

const userTarget = {
  scope_kind: "user" as const,
  environment: { kind: "host" as const, identity: "work" },
  profile_id: null,
  harness_id: "claude" as const,
  app: null,
  app_realpath: null,
};

const appTarget = {
  scope_kind: "app" as const,
  environment: { kind: "host" as const, identity: "work" },
  profile_id: null,
  harness_id: "claude" as const,
  app: APP,
  app_realpath: "/work/app",
};

// CLI 이름 전체가 architecture 5.4의 command 전체 목록에 있다. core·decision
// 이름과도 겹치지 않는다.
Deno.test(
  "coding-agent/cli#R1, coding-agent/cli#R4: 설치·점검 command 이름 23개를 공개한다",
  () => {
    assertEquals(CLI_SETUP_NAMES, [
      "doctor",
      "daemon start",
      "daemon stop",
      "daemon status",
      "daemon logs",
      "mcp config",
      "harness list",
      "harness detect",
      "harness refresh",
      "harness inspect",
      "harness plan",
      "harness install",
      "harness update",
      "harness remove",
      "skills list",
      "skills install",
      "connection list",
      "connection show",
      "connection create",
      "connection revoke",
      "connection install",
      "session summary",
      "session plan",
    ]);
    assertEquals(CLI_SETUP_COMMANDS.length, CLI_SETUP_NAMES.length);
  },
);

Deno.test(
  "coding-agent/cli#R10: doctor는 target을 받고 daemon·인증·설정·네 loading 단계 결과를 낸다",
  () => {
    cliDoctorSchema.parse({ command: "doctor" });
    cliDoctorSchema.parse({
      command: "doctor",
      target: userTarget,
      json: true,
    });
    assertEquals(
      cliDoctorSchema.safeParse({ command: "doctor", target: {} }).success,
      false,
    );
    // integrationTargetSchema를 그대로 쓴다. app target은 app·realpath가 필수다.
    cliDoctorSchema.parse({ command: "doctor", target: appTarget });
    assertEquals(
      cliDoctorSchema.safeParse({
        command: "doctor",
        target: { ...appTarget, app_realpath: null },
      }).success,
      false,
    );
  },
);

Deno.test(
  "coding-agent/cli#R8: daemon start·stop은 사람 전용이고 status·logs는 token 없이 읽는다",
  () => {
    assertEquals(HUMAN_ONLY_NAMES.includes("daemon start"), true);
    assertEquals(HUMAN_ONLY_NAMES.includes("daemon stop"), true);
    cliDaemonStartSchema.parse({ command: "daemon start" });
    cliDaemonStopSchema.parse({ command: "daemon stop" });
    cliDaemonStatusSchema.parse({ command: "daemon status", json: true });
    assertEquals(
      cliDaemonStartSchema.safeParse({ command: "daemon start", yes: true })
        .success,
      false,
    );
    cliDaemonLogsSchema.parse({ command: "daemon logs" });
    cliDaemonLogsSchema.parse({
      command: "daemon logs",
      cursor: "next-1",
      lines: 2_000,
    });
    assertEquals(
      cliDaemonLogsSchema.safeParse({ command: "daemon logs", lines: 2_001 })
        .success,
      false,
    );
  },
);

Deno.test(
  "coding-agent/cli#R9: mcp config는 제품·scope·connection·toolsets을 받는다",
  () => {
    cliMcpConfigSchema.parse({
      command: "mcp config",
      target: "claude",
      scope: "user",
      connection: CAC,
    });
    cliMcpConfigSchema.parse({
      command: "mcp config",
      target: "codex",
      scope: "app",
      connection: CAC,
      toolsets: "core,app",
      json: true,
    });
    // scope는 user|app 둘이다. 없는 제품과 connection 없는 요청은 거절이다.
    assertEquals(
      cliMcpConfigSchema.safeParse({
        command: "mcp config",
        target: "claude",
        scope: "all",
        connection: CAC,
      }).success,
      false,
    );
    assertEquals(
      cliMcpConfigSchema.safeParse({
        command: "mcp config",
        target: "nope",
        scope: "user",
        connection: CAC,
      }).success,
      false,
    );
    assertEquals(
      cliMcpConfigSchema.safeParse({
        command: "mcp config",
        target: "claude",
        scope: "user",
      }).success,
      false,
    );
  },
);

Deno.test(
  "coding-agent/cli#R40: harness 여덟 command는 catalog·감지·재감지·자원 관측·설치 계획·설치·갱신·제거다",
  () => {
    cliHarnessListSchema.parse({ command: "harness list" });
    cliHarnessDetectSchema.parse({ command: "harness detect" });
    // 재감지는 사람 요청일 때만이다. 자동 옵션 field는 없다.
    cliHarnessRefreshSchema.parse({ command: "harness refresh" });
    cliHarnessInspectSchema.parse({ command: "harness inspect" });
    cliHarnessInspectSchema.parse({
      command: "harness inspect",
      harness: "claude",
      json: true,
    });
    assertEquals(
      cliHarnessInspectSchema.safeParse({
        command: "harness inspect",
        harness: "nope",
      }).success,
      false,
    );
    cliHarnessPlanSchema.parse({
      command: "harness plan",
      target: userTarget,
      components: ["mcp", "skill"],
    });
    cliHarnessInstallSchema.parse({
      command: "harness install",
      target: userTarget,
      components: ["mcp", "skill"],
      operation_id: "install-1",
    });
    cliHarnessUpdateSchema.parse({
      command: "harness update",
      target: appTarget,
      components: ["skill"],
    });
    cliHarnessRemoveSchema.parse({
      command: "harness remove",
      target: userTarget,
      components: ["skill"],
    });
    assertEquals(
      cliHarnessPlanSchema.safeParse({
        command: "harness plan",
        target: userTarget,
      }).success,
      false,
    );
    assertEquals(
      cliHarnessInstallSchema.safeParse({
        command: "harness install",
        target: userTarget,
        components: ["mcp"],
      }).success,
      false,
    );
  },
);

Deno.test(
  "coding-agent/cli#R10: skills list·install은 목록 읽기와 target 설치다",
  () => {
    cliSkillsListSchema.parse({ command: "skills list" });
    cliSkillsInstallSchema.parse({
      command: "skills install",
      target: userTarget,
    });
    cliSkillsInstallSchema.parse({
      command: "skills install",
      target: userTarget,
      names: ["lophn-navigate", "lophn-repair"],
      json: true,
    });
    assertEquals(
      cliSkillsInstallSchema.safeParse({
        command: "skills install",
        target: userTarget,
        names: [],
      }).success,
      false,
    );
  },
);

Deno.test(
  "coding-agent/cli#R6, coding-agent/cli#R7, coding-agent/cli#R8: connection 다섯 command는 create·revoke·install이 사람 전용이다",
  () => {
    assertEquals(HUMAN_ONLY_NAMES.includes("connection create"), true);
    assertEquals(HUMAN_ONLY_NAMES.includes("connection revoke"), true);
    assertEquals(HUMAN_ONLY_NAMES.includes("connection install"), true);
    assertEquals(HUMAN_ONLY_NAMES.includes("session plan"), true);
    // revoke만 confirmation window를 쓴다(cli#R7).
    assertEquals(CONFIRMATION_NAMES, ["connection revoke"]);

    cliConnectionListSchema.parse({ command: "connection list" });
    cliConnectionShowSchema.parse({
      command: "connection show",
      connection: CAC,
    });
    cliConnectionCreateSchema.parse({
      command: "connection create",
      label: "claude code",
      scope: { kind: "all", app: null },
    });
    cliConnectionRevokeSchema.parse({
      command: "connection revoke",
      connection: CAC,
      base_revision: "4",
    });
    cliConnectionInstallSchema.parse({
      command: "connection install",
      target: userTarget,
      connection: CAC,
      json: true,
    });
    // create는 token 원문 field 없이 label·scope만 받는다(connections.ts와 같다).
    assertEquals(
      cliConnectionCreateSchema.safeParse({
        command: "connection create",
        label: "claude code",
        scope: { kind: "all", app: null },
        token: "plaintext",
      }).success,
      false,
    );
    assertEquals(
      cliConnectionCreateSchema.safeParse({
        command: "connection create",
        label: " ",
        scope: { kind: "all", app: null },
      }).success,
      false,
    );
    assertEquals(
      cliConnectionRevokeSchema.safeParse({
        command: "connection revoke",
        connection: CAC,
      }).success,
      false,
    );
  },
);

Deno.test(
  "coding-agent/cli#R40: session summary·plan은 lophn_session 결과와 LaunchPlan 입출력이다",
  () => {
    cliSessionSummarySchema.parse({ command: "session summary" });
    cliSessionSummarySchema.parse({
      command: "session summary",
      app: APP,
      cursor: "next-1",
      hook: true,
      json: true,
    });
    // hook mode는 선택이다. summary 입력은 owner read route 입력과 같다.
    assertEquals(
      cliSessionSummarySchema.safeParse({
        command: "session summary",
        limit: 2,
      })
        .success,
      false,
    );

    const planInput = {
      ticket: TKT,
      ticket_revision: "12",
      connection: CAC,
      cwd: "/work/app",
      method: "terminal_tui",
      human_start_handle: "hs_1",
      operation_id: "op_1",
    };
    cliSessionPlanSchema.parse({
      command: "session plan",
      plan_input: planInput,
      connection: CAC,
    });
    assertEquals(
      cliSessionPlanSchema.safeParse({ command: "session plan" }).success,
      false,
    );
    // plan 출력은 launch.ts의 sessionPlanOutputSchema와 같다.
    const plan = codingAgentLaunchPlanSchema.parse({
      ticket: TKT,
      ticket_revision: "12",
      harness_id: "claude",
      catalog_revision: "rev-1",
      adapter_revision: "rev-1",
      environment: { kind: "host", identity: "work" },
      profile_id: null,
      connection: CAC,
      project: PRJ,
      folder_ref: "src",
      cwd: "/work/app",
      method: "terminal_tui",
      executable: "/usr/local/bin/claude",
      argv: ["claude"],
      env_names: ["LOPHN_CONNECTION"],
      first_prompt: "read the ticket, claim it with MCP, work, report",
      prompt_delivery: { mode: "argv" },
      human_start_handle: "hs_1",
      operation_id: "op_1",
      observed_at: AT,
    });
    assertEquals(plan.ticket, TKT);
  },
);

Deno.test(
  "coding-agent/cli#R1, coding-agent/cli#R2: command 이름은 core·decision 이름과 겹치지 않는다",
  () => {
    // architecture 5.4의 command 전체 목록은 겹침이 없다. 각 command의 literal이
    // CLI_SETUP_NAMES과 같은지 함께 본다.
    for (const command of CLI_SETUP_COMMANDS) {
      const literal = (command.shape.command as unknown as {
        value?: string;
      }).value;
      assert(literal);
      assertEquals(CLI_SETUP_NAMES.includes(literal as never), true);
    }
  },
);
