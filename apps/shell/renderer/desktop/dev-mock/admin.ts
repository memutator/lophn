// mock 모드의 lophn 공간 관리 화면(roles·settings·apps) 통로. 화면 테스트의 가짜 통로에 대표 값을
// 채운 것이다. key·로그인 응답·복원·export는 보호 창이나 core를 부르지 않고 메모리에서만 끝난다.
import {
  ASG_APP,
  ASG_LOPHN,
  ASG_OPERATOR,
  CHOICES,
  definition,
  DOC_NOTES,
  DOC_REPORT,
  fakeRoles,
  PST_DEFAULT,
  PST_MINE,
  role,
  runId,
  step,
  toolId,
  trace,
  VER_NOTES,
  VER_REPORT,
  work,
} from "../lophn-space/roles/testdata/fake-roles.ts";
import {
  account,
  CHATGPT,
  CLAUDE,
  fakeSettings,
  LOCAL,
  provider,
  server,
  setting,
} from "../lophn-space/settings/testdata/fake-settings.ts";
import {
  backupRow,
  fakeBackup,
} from "../lophn-space/settings/backup/testdata/fake-source.ts";
import { fakeUpdate } from "../lophn-space/settings/update/testdata/fake-source.ts";
import { fakeDiagnostics } from "../lophn-space/settings/diagnostics/testdata/fake-source.ts";
import { fakeNotifications } from "../lophn-space/settings/notifications/testdata/fake-source.ts";
import { fakeConnections } from "../lophn-space/settings/connections/testdata/fake-source.ts";
import { appRow, fakeApps } from "../lophn-space/apps/testdata/fake-apps.ts";
import type { RolesSource } from "../lophn-space/roles/source.ts";
import type { SettingsSource } from "../lophn-space/settings/source.ts";
import type { SettingsPanels } from "../lophn-space/settings/settings-screen.tsx";
import type { CodingConnectionsSource } from "../lophn-space/settings/connections/source.ts";
import type { AppsSource } from "../lophn-space/apps/source.ts";
import {
  APP_BUDGET,
  APP_EXPENSES,
  APP_PLANNER,
  PROJECT_GROCERY,
} from "./ids.ts";

const MINUTE = 60 * 1000;

const DOC_TITLES = {
  [DOC_REPORT]: "Weekly grocery report",
  [DOC_NOTES]: "Store notes",
};

export function mockRoles(): RolesSource {
  const operatorPreset = {
    id: PST_DEFAULT,
    revision: 1,
    definition: definition({
      name: "grocery operator",
      origin: "user",
      role: "operator",
    }),
  };
  const finished = runId(1);
  return fakeRoles({
    roles: [
      role({ id: ASG_LOPHN, role: "lophn", presetName: "lophn" }),
      role({
        id: ASG_APP,
        role: "app_engineer",
        scope: { kind: "app", id: APP_BUDGET },
        presetName: "app engineer",
      }),
      role({
        id: ASG_OPERATOR,
        role: "operator",
        scope: { kind: "project", id: PROJECT_GROCERY },
        presetName: "grocery operator",
        outputs: [DOC_REPORT],
      }),
    ],
    works: {
      [ASG_LOPHN]: [
        work(1),
        work(2, { state: "running", finishedAt: null, outcome: null }),
        work(3, {
          startedAt: "2026-10-05T08:00:00.000Z",
          finishedAt: "2026-10-05T08:02:00.000Z",
        }),
      ],
      [ASG_APP]: [work(4)],
      [ASG_OPERATOR]: [work(5, { origin: "schedule" })],
    },
    made: {
      [ASG_LOPHN]: [
        { document: DOC_REPORT, version: VER_REPORT, work: finished },
        { document: DOC_NOTES, version: VER_NOTES, work: finished },
      ],
    },
    titles: DOC_TITLES,
    requests: {
      [finished]: "Summarize this week's grocery spending in a report.",
    },
    traces: {
      [finished]: trace(finished, {
        toolCalls: [toolId(1), toolId(2)],
        tools: {
          steps: 2,
          succeeded: 2,
          failed: [],
          denied: [],
          notExecuted: [],
          uncertain: [],
          unfinished: [],
          external: [],
        },
      }),
    },
    steps: {
      [finished]: [
        step(1, { tool: "document.search", effect: "read" }),
        step(2, { tool: "document.create", effect: "write" }),
      ],
    },
    presets: {
      lophn: [{ id: PST_DEFAULT, revision: 1, definition: definition() }],
      app_engineer: [{
        id: PST_MINE,
        revision: 2,
        definition: definition({ name: "app engineer", role: "app_engineer" }),
      }],
      operator: [operatorPreset],
    },
    choices: CHOICES,
    operator: { presets: [operatorPreset] },
  }).source;
}

export function mockSettings(): SettingsSource {
  return fakeSettings({
    providers: [
      provider(CLAUDE, "Claude", {
        ways: ["api_key", "oauth"],
        signIn: { verified: true },
        accounts: [
          account("main", "Main", {
            way: "oauth",
            order: 0,
            account: "mina@example.com",
            plan: "Max",
          }),
          account("backup", "Backup key", { order: 1 }),
        ],
        lastCheck: {
          at: new Date(Date.now() - 20 * MINUTE).toISOString(),
          result: "success",
          kind: "text",
          model: "claude-a",
        },
      }),
      provider(CHATGPT, "ChatGPT", {
        ways: ["oauth"],
        accounts: [account("personal", "Personal", { way: "oauth" })],
      }),
      provider(LOCAL, "Local", { local: true, ways: ["none"] }),
    ],
    models: {
      "claude-def": ["claude-a", "claude-b"],
      "chatgpt-def": ["gpt-a"],
      "local-def": ["local-small"],
    },
    usage: {
      main: {
        calls: 128,
        costs: [{
          kind: "subscription",
          amount: null,
          currency: null,
          calls: 128,
        }],
        complete: true,
      },
      backup: {
        calls: 12,
        costs: [{
          kind: "estimated",
          amount: "0.84",
          currency: "USD",
          calls: 12,
        }],
        complete: true,
      },
    },
    defaults: {
      decisions: { provider: CLAUDE, model: "claude-a" },
      summaries: { provider: CLAUDE, model: "claude-b" },
      seq: "9",
    },
    settings: {
      rows: [
        setting(
          "shell.os_notifications",
          "Show a desktop notification when something needs your attention.",
          false,
          { applyAt: "current_check" },
        ),
        setting("lophn-agent.run_attempts", "Run limit: attempts (count).", 3),
        setting(
          "shell.reading_width",
          "Reading width shared by every document.",
          "default",
          { applyAt: "next_call" },
        ),
        setting(
          "lophn-agent.extensions.skill_folders",
          "Registered absolute skill discovery roots in user order.",
          ["/home/mina/skills/notes"],
        ),
        setting(
          "lophn-agent.extensions.mcp_servers",
          "Registered external MCP servers.",
          [],
        ),
      ],
      folders: ["/home/mina/skills/notes"],
      servers: [
        server("docs-search", { transport: "http", auth: "none" }),
        server("local-files", {
          transport: "stdio",
          auth: "none",
          enabled: false,
        }),
      ],
    },
  }).source;
}

export function mockSettingsPanels(): SettingsPanels {
  return {
    backup: fakeBackup({
      backups: [
        backupRow("2026-10-09T02:00:00.000Z", { sizeBytes: 52428800 }),
        backupRow("2026-10-08T02:00:00.000Z", { sizeBytes: 51200000 }),
      ],
      apps: [
        { id: APP_BUDGET, name: "Grocery budget" },
        { id: APP_PLANNER, name: "Meal planner" },
      ],
    }).source,
    update: fakeUpdate({
      picked: "/home/mina/Downloads/lophn-1.9.0.deb",
      candidate: { version: "1.9.0", os: "linux", format: "deb", schema: 2 },
      notice: {
        ok: true,
        currentVersion: "1.8.2",
        newVersion: "1.9.0",
        os: "linux",
        schema: "compatible",
        restartRequired: true,
      },
    }).source,
    diagnostics: fakeDiagnostics({
      view: {
        observedAt: new Date().toISOString(),
        rows: [
          { check: "sdk_hash", finding: null },
          { check: "credential_permission", finding: null },
          {
            check: "broad_grant",
            finding: {
              impact: "wide_grant",
              raw: "app Expense log holds fs.read on /home/mina",
              at: new Date(Date.now() - 5 * MINUTE).toISOString(),
            },
          },
          { check: "file_and_network_grant", finding: null },
          { check: "unused_grant", finding: null },
          { check: "raw_key_pattern", finding: null },
        ],
      },
    }).source,
    notifications: fakeNotifications({ enabled: true }).source,
  };
}

export function mockCoding(): CodingConnectionsSource {
  return fakeConnections().source;
}

export function mockApps(): AppsSource {
  return fakeApps({
    rows: [
      appRow(APP_BUDGET, "Grocery budget", {
        release: "rel_01h455vb4pex5v6nkc6gd5fd01",
      }),
      appRow(APP_PLANNER, "Meal planner", {
        release: "rel_01h455vb4pex5v6nkc6gd5fd03",
      }),
      appRow(APP_EXPENSES, "Expense log", { archived: true }),
    ],
    runs: { [APP_BUDGET]: "running", [APP_PLANNER]: "stopped" },
    screen: "home",
  }).source;
}
