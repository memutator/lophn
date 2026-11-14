// mock 모드의 Settings·앱 통로. 화면 테스트의 가짜 통로에 대표 값을
// 채운 것이다. key·로그인 응답은 보호 창이나 core를 부르지 않고 메모리에서만 끝난다.

import type { AppsSource } from "../../apps/source.ts";
import { appRow, fakeApps } from "../../apps/testdata/fake-apps.ts";
import type { JobsSource } from "../jobs/source.ts";
import { fakeJobs } from "../jobs/testdata/fake-source.ts";
import {
  type FakeSettingsScreen,
  fakeSettingsScreen,
} from "../settings/testdata/fake-screen.ts";
import { APP_BUDGET, APP_EXPENSES, APP_PLANNER } from "./ids.ts";

/** Settings 화면 전체. 답(core.answers)은 mock event 연결이 받는다. */
export function mockSettingsScreen(): FakeSettingsScreen {
  // 값이 비어 있는 필수 설정이 하나 있어 화면 위쪽 안내를 볼 수 있다.
  return fakeSettingsScreen({ requiredEmpty: true });
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

export function mockJobs(): JobsSource {
  return fakeJobs().source;
}
