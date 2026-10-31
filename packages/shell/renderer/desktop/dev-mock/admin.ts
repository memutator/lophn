// mock 모드의 Settings·앱 통로. 화면 테스트의 가짜 통로에 대표 값을
// 채운 것이다. key·로그인 응답은 보호 창이나 core를 부르지 않고 메모리에서만 끝난다.
// Providers와 Agents 항목은 각자의 가짜 통로(providers/testdata, agents/testdata)를 쓴다.
import {
  declared,
  fakeSettings,
  SAMPLE_DECLARED,
} from "../settings/testdata/fake-settings.ts";
import { fakeProviders } from "../settings/providers/testdata/fake-providers.ts";
import { fakeAgents } from "../settings/agents/testdata/fake-agents.ts";
import { fakeDiagnostics } from "../settings/diagnostics/testdata/fake-source.ts";
import { fakeAppearance } from "../settings/appearance/testdata/fake-source.ts";
import { fakeBrowserSettings } from "../settings/browser/testdata/fake-source.ts";
import { fakeKeyboard } from "../settings/keyboard/testdata/fake-source.ts";
import {
  fakeShellRules,
  SAMPLE_SHELL_RULES,
} from "../settings/shell-rules/testdata/fake-source.ts";
import { fakeJobs } from "../settings/jobs/testdata/fake-source.ts";
import { fakeConnections } from "../settings/connections/testdata/fake-source.ts";
import { appRow, fakeApps } from "../../apps/testdata/fake-apps.ts";
import type { SettingsSource } from "../settings/source.ts";
import type { SettingsPanels } from "../settings/settings-screen.tsx";
import type { AppsSource } from "../../apps/source.ts";
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
  }).source;
}

export function mockSettingsPanels(): SettingsPanels {
  return {
    providers: fakeProviders().source,
    agents: fakeAgents().source,
    diagnostics: fakeDiagnostics().source,
    shellRules: fakeShellRules({ value: SAMPLE_SHELL_RULES }).source,
    appearance: fakeAppearance().source,
    coding: fakeConnections().source,
    browser: fakeBrowserSettings().source,
    keyboard: fakeKeyboard().source,
    jobs: fakeJobs().source,
  };
}

export function mockApps(): AppsSource {
  return fakeApps({
    rows: [
      appRow(APP_BUDGET, "Grocery budget", {
        release: "rel_01h455vb4pex5v6nkc6gd5fd01",
        releaseNumber: 3,
      }),
      appRow(APP_PLANNER, "Meal planner", {
        release: "rel_01h455vb4pex5v6nkc6gd5fd03",
        releaseNumber: 1,
      }),
      appRow(APP_EXPENSES, "Expense log", { archived: true }),
    ],
    runs: { [APP_BUDGET]: "running", [APP_PLANNER]: "stopped" },
    screen: "home",
  }).source;
}
