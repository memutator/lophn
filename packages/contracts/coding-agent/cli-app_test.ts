import { assertEquals } from "@std/assert";
import { APP, CAC, HASH, REL, TKT, VER, VRF } from "./ticket-fixtures.ts";
import {
  appHumanOnlyNames,
  CLI_APP_NAMES,
  cliAppAutomationRunSchema,
  cliAppBlueprintSchema,
  cliAppCommandSchema,
  cliAppInvocationSchema,
  cliAppInvocationsSchema,
  cliAppListSchema,
  cliAppLogsSchema,
  cliAppPathSchema,
  cliAppPreviewStartSchema,
  cliAppPreviewStopSchema,
  cliAppRegisterSchema,
  cliAppReleaseActivateSchema,
  cliAppReleasePrepareSchema,
  cliAppShowSchema,
  cliAppSourceSchema,
  cliAppStartSchema,
  cliAppStatusSchema,
  cliAppStopSchema,
  cliAppSyncToolsSchema,
  cliAppTestSchema,
  cliAppValidateSchema,
  cliSdkAddSchema,
  cliSdkCatalogSchema,
  cliSdkShowSchema,
  cliTicketChecksSchema,
  cliTicketClaimSchema,
  cliTicketListSchema,
  cliTicketReleaseSchema,
  cliTicketRenewSchema,
  cliTicketReportSchema,
  cliTicketShowSchema,
} from "./cli-app.ts";

// app_test 요청은 ticket 없이 runner에 요청한다(mcp#R33).
const appTestRequest = {
  request_key: "test-1",
  kind: "app_test" as const,
  app: APP,
  target: { bundle_hash: HASH, release: null },
  problem: null,
  basis_seq: null,
  reports: [],
  before: null,
  after: null,
  ticket: null,
  test: HASH,
};

Deno.test(
  "coding-agent/cli#R24, coding-agent/cli#R25: app 읽기·등록 command는 owner 입력을 그대로 받는다",
  () => {
    assertEquals(CLI_APP_NAMES.slice(0, 6), [
      "app list",
      "app show",
      "app path",
      "app register",
      "app source",
      "app validate",
    ]);
    cliAppListSchema.parse({ command: "app list", status: "active" });
    cliAppShowSchema.parse({ command: "app show", app: APP });
    cliAppPathSchema.parse({ command: "app path", app: APP });
    cliAppRegisterSchema.parse({
      command: "app register",
      slug: "calendar",
      name: "Calendar",
      description: "Keeps one calendar",
    });
    cliAppSourceSchema.parse({
      command: "app source",
      app: APP,
      source_path: "/work/app",
    });
    assertEquals(
      (CLI_APP_NAMES as readonly string[]).includes("app archive"),
      false,
    );
  },
);

Deno.test(
  "coding-agent/cli#R26, coding-agent/cli#R27: app 검사·preview command는 접수와 상태를 구별한다",
  () => {
    cliAppValidateSchema.parse({
      command: "app validate",
      app: APP,
      commit: "a".repeat(40),
      request_key: "prep-1",
    });
    cliAppTestSchema.parse({ command: "app test", ...appTestRequest });
    cliAppPreviewStartSchema.parse({
      command: "app preview start",
      input: { app: APP, bundle_hash: HASH, release: null, fixture_hash: null },
    });
    cliAppPreviewStopSchema.parse({
      command: "app preview stop",
      app: APP,
      process_nonce: "nonce-1",
    });
  },
);

Deno.test(
  "coding-agent/cli#R28: app release prepare는 준비 접수를 내고 activate는 사람 전용이다",
  () => {
    cliAppReleasePrepareSchema.parse({
      command: "app release prepare",
      app: APP,
      commit: "a".repeat(40),
      request_key: "prep-2",
      ticket_source: { ticket: TKT, claim_seq: "12" },
    });
    // activate는 사람 보호 결정이므로 사람 전용 command다(R7).
    assertEquals(
      (CLI_APP_NAMES as readonly string[]).includes("app release activate"),
      true,
    );
    assertEquals(appHumanOnlyNames.includes("app release activate"), true);
  },
);

Deno.test(
  "coding-agent/cli#R24, coding-agent/cli#R29: app status·blueprint·invocations·logs·sync-tools는 읽기 command다",
  () => {
    cliAppStatusSchema.parse({ command: "app status", app: APP });
    cliAppBlueprintSchema.parse({ command: "app blueprint", app: APP });
    cliAppInvocationsSchema.parse({
      command: "app invocations",
      app: APP,
      limit: 20,
      cursor: "4",
    });
    cliAppLogsSchema.parse({ command: "app logs", app: APP, limit: 200 });
    cliAppSyncToolsSchema.parse({ command: "app sync-tools", app: APP });
  },
);

Deno.test(
  "coding-agent/cli#R30: sdk catalog·show·add는 exact version과 apply를 구별한다",
  () => {
    cliSdkCatalogSchema.parse({ command: "sdk catalog", app: APP });
    // show는 상세 API 목록을 읽는다. owner 입력은 name이 필수다.
    cliSdkShowSchema.parse({ command: "sdk show", name: "@lophn/calendar" });
    cliSdkAddSchema.parse({
      command: "sdk add",
      app: APP,
      name: "@lophn/calendar",
      version: "1.2.3",
    });
    assertEquals(
      CLI_APP_NAMES.filter((name) => name.startsWith("sdk")),
      ["sdk catalog", "sdk show", "sdk add"],
    );
  },
);

Deno.test(
  "coding-agent/cli#R31, coding-agent/cli#R32: app command·invocation·automation run은 command 경계를 같이 쓴다",
  () => {
    cliAppCommandSchema.parse({
      command: "app command",
      app: APP,
      name: "usage.read",
      json: true,
    });
    cliAppCommandSchema.parse({
      command: "app command",
      app: APP,
      name: "usage.read",
      input: '{"month":"2026-10"}',
    });
    cliAppInvocationSchema.parse({
      command: "app invocation",
      app: APP,
      invocation: `inv_${APP.slice(4)}`,
    });
    cliAppAutomationRunSchema.parse({
      command: "app automation run",
      app: APP,
    });
    // input과 input_file은 겹치지 않는다(cliCommonSchema).
    assertEquals(
      cliAppCommandSchema.safeParse({
        command: "app command",
        app: APP,
        name: "usage.read",
        input: "{}",
        input_file: "x.json",
      }).success,
      false,
    );
  },
);

Deno.test(
  "coding-agent/cli#R7: app start·stop은 사람 전용이고 coding credential의 운영 제어는 없다",
  () => {
    assertEquals([
      ...appHumanOnlyNames,
    ], [
      "app start",
      "app stop",
      "app release activate",
    ]);
    cliAppStartSchema.parse({ command: "app start", app: APP });
    cliAppStopSchema.parse({ command: "app stop", app: APP });
    cliAppReleaseActivateSchema.parse({ command: "app release activate" });
    // 사람 전용 command는 허락 입력을 받지 않는다(cli#R7).
    assertEquals(
      cliAppStartSchema.safeParse({
        command: "app start",
        app: APP,
        yes: true,
      }).success,
      false,
    );
  },
);

Deno.test(
  "coding-agent/cli#R36: ticket command는 list·show·checks 읽기와 claim 안내를 구별한다",
  () => {
    cliTicketListSchema.parse({
      command: "ticket list",
      app: APP,
      state: "claimed",
      limit: 20,
    });
    cliTicketShowSchema.parse({ command: "ticket show", ticket: TKT });
    cliTicketChecksSchema.parse({ command: "ticket checks", ticket: TKT });
    // CLI claim은 실행하지 않는다. MCP 연결·지정 ticket 안내로 끝난다(cli#R41).
    cliTicketClaimSchema.parse({ command: "ticket claim", ticket: TKT });
    assertEquals(
      cliTicketClaimSchema.safeParse({
        command: "ticket claim",
        ticket: TKT,
        base_revision: "12",
      }).success,
      false,
    );
  },
);

Deno.test(
  "coding-agent/cli#R36, coding-agent/cli#R41: ticket renew·release·report는 대응 contract 입력이다",
  () => {
    cliTicketRenewSchema.parse({
      command: "ticket renew",
      ticket: TKT,
      base_revision: "13",
      claim_seq: "8",
      connection: CAC,
    });
    cliTicketReleaseSchema.parse({
      command: "ticket release",
      ticket: TKT,
      base_revision: "14",
      claim_seq: "8",
    });
    cliTicketReportSchema.parse({
      command: "ticket report",
      ticket: TKT,
      base_revision: "15",
      claim_seq: "8",
      completion: {
        release: REL,
        summary_hash: HASH,
        outputs: [VER],
        fix_records: [],
        verifications: [VRF],
      },
      json: true,
    });
  },
);

Deno.test(
  "coding-agent/cli#R36: CLI_APP_NAMES은 31개고 ticket create·cancel은 없다",
  () => {
    assertEquals(CLI_APP_NAMES.length, 31);
    // ticket create·cancel은 사람 통로다(architecture 5.4 표). coding credential
    // 통로인 이 파일의 ticket command는 claim 안내·갱신·반납·release 연결·완료
    // 보고다(cli#R36, R37).
    assertEquals(
      (CLI_APP_NAMES as readonly string[]).includes("ticket create"),
      false,
    );
    assertEquals(
      (CLI_APP_NAMES as readonly string[]).includes("ticket cancel"),
      false,
    );
    assertEquals(
      CLI_APP_NAMES.filter((name) => name.startsWith("ticket")),
      [
        "ticket list",
        "ticket show",
        "ticket checks",
        "ticket claim",
        "ticket renew",
        "ticket release",
        "ticket report",
      ],
    );
  },
);

Deno.test(
  "coding-agent/cli#R31, coding-agent/cli#R32: app command는 command key·환경·timeout을 싣고 invocation은 환경을 고른다",
  () => {
    const parsed = cliAppCommandSchema.parse({
      command: "app command",
      app: APP,
      name: "usage.read",
      environment: "live",
      timeout_ms: 5_000,
      input: '{"month":"2026-10"}',
    });
    assertEquals(parsed.name, "usage.read");
    assertEquals(parsed.environment, "live");
    // command key가 없으면 어느 command인지 모른다.
    assertEquals(
      cliAppCommandSchema.safeParse({ command: "app command", app: APP })
        .success,
      false,
    );
    for (
      const bad of [
        { environment: "production" },
        { timeout_ms: 0 },
        { timeout_ms: 1.5 },
      ]
    ) {
      assertEquals(
        cliAppCommandSchema.safeParse({
          command: "app command",
          app: APP,
          name: "usage.read",
          ...bad,
        }).success,
        false,
      );
    }
    const invocation = cliAppInvocationSchema.parse({
      command: "app invocation",
      app: APP,
      invocation: `inv_${APP.slice(4)}`,
      environment: "live",
    });
    assertEquals(invocation.environment, "live");
  },
);
