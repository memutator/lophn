// Coding agents 화면이 읽고 쓰는 통로. core route 이름은 core-source.ts만 안다. 제품마다 감지 결과(`HarnessSettingsView`)와
// 전역 hook은 core의 `coding_agents/*`가 준다. 연결을 만들고 회수하는 길은 없다.
import type {
  HarnessHookView,
  HarnessSettingsView,
} from "../../../../../protocol/coding-agent/coding-agents.ts";
import type { HarnessId as HarnessName } from "../../../../../protocol/coding-agent/harness-id.ts";
import type { SourceResult } from "../source.ts";

export type { HarnessHookView, HarnessName, HarnessSettingsView, SourceResult };

/** 공유한 앱 목록(설정 `coding-agent.shared_apps`)은 화면이 `settings/list`를 useCoreRead로 읽는다. */
export interface CodingConnectionsSource {
  /** 저장한 감지 결과. 화면이 열릴 때·다시 들어올 때 부른다. 다시 감지하지 않는다. */
  harnesses(): Promise<SourceResult<readonly HarnessSettingsView[]>>;
  /** 사람이 [Detect again]을 누를 때만 부른다. 다시 감지한 결과를 돌려준다. */
  refresh(): Promise<SourceResult<readonly HarnessSettingsView[]>>;
  /** 제품마다 전역 hook이 놓였는지. 아무것도 쓰지 않는다. */
  hookStatus(): Promise<SourceResult<readonly HarnessHookView[]>>;
  /** 사람이 [Install hooks]를 누를 때만 부른다. 제품의 전역 설정 file에 hook을 쓴다. */
  installHooks(harness: HarnessName): Promise<SourceResult<HarnessHookView>>;
  /** 사람이 [Uninstall hooks]를 누를 때만 부른다. 제품의 전역 설정 file에서 lophn 항목만 지운다. */
  uninstallHooks(harness: HarnessName): Promise<SourceResult<HarnessHookView>>;
  /** 목록에서 앱을 뺀다. 사본은 shell main이 설정 변경(`StateChanged`의 `settings`)을 듣고 다음 sync에서 지운다. */
  unshareApp(slug: string): Promise<SourceResult<null>>;
}
