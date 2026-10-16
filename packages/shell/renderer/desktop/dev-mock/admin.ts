// mock 모드의 Lophn Workspace 관리 화면(settings·apps) 통로. 화면 테스트의 가짜 통로에 대표 값을
// 채운 것이다. key·로그인 응답은 보호 창이나 core를 부르지 않고 메모리에서만 끝난다.
// Providers와 Agents 항목은 각자의 가짜 통로(providers/testdata, agents/testdata)를 쓴다.
import {
  declared,
  fakeSettings,
  SAMPLE_DECLARED,
  server,
} from "../lophn-space/settings/testdata/fake-settings.ts";
import { fakeProviders } from "../lophn-space/settings/providers/testdata/fake-providers.ts";
import { fakeAgents } from "../lophn-space/settings/agents/testdata/fake-agents.ts";
import { fakeDiagnostics } from "../lophn-space/settings/diagnostics/testdata/fake-source.ts";
import { fakeAppearance } from "../lophn-space/settings/appearance/testdata/fake-source.ts";
import {
  fakeReactions,
  SAMPLE_MODES,
} from "../lophn-space/settings/reactions/testdata/fake-source.ts";
import { fakeConnections } from "../lophn-space/settings/connections/testdata/fake-source.ts";
import { appRow, fakeApps } from "../lophn-space/apps/testdata/fake-apps.ts";
import type { SettingsSource } from "../lophn-space/settings/source.ts";
import type { SettingsPanels } from "../lophn-space/settings/settings-screen.tsx";
import type { AppsSource } from "../lophn-space/apps/source.ts";
import { APP_BUDGET, APP_EXPENSES, APP_PLANNER } from "./ids.ts";

export function mockSettings(): SettingsSource {
  return fakeSettings({
    // 값이 비어 있는 필수 설정이 하나 있어 화면 위쪽 안내를 볼 수 있다.
    declared: [
      ...SAMPLE_DECLARED,
      declared("agents.run.fallback_model", {
        type: "string",
        enum: ["sonnet", "opus"],
      }),
    ],
    settings: {
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
    providers: fakeProviders().source,
    agents: fakeAgents().source,
    diagnostics: fakeDiagnostics().source,
    reactions: fakeReactions({ modes: SAMPLE_MODES }).source,
    appearance: fakeAppearance().source,
    coding: fakeConnections().source,
  };
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
