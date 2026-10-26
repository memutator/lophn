// Coding agents 화면이 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름과 main IPC는
// core-source.ts만 안다. 제품마다 감지 결과(`HarnessSettingsView`)는 main IPC가 주고, 기본 실행
// 옵션은 선언 설정(`coding-agent.default_*`)이다. 연결을 만들고 회수하는 길은 없다.
import type {
  HarnessHookView,
  HarnessName,
  HarnessSettingsView,
} from "../../../../ipc/coding.ts";
import type { SourceResult } from "../source.ts";

export type { HarnessHookView, HarnessName, HarnessSettingsView, SourceResult };

/** App Engineer가 제품을 고르지 않았을 때 쓰는 값. 비어 있으면 제품의 기본을 따른다. */
export interface CodingDefaults {
  readonly harness: HarnessName | null;
  /** 빈 글이면 제품의 기본 model이다. */
  readonly model: string;
}

export interface CodingConnectionsSource {
  /** core 연결 상태를 듣는다. 준비되면 화면이 다시 읽는다. 해제는 반환 함수다. */
  watch(listener: (state: { readonly state: string }) => void): () => void;
  /** 저장한 감지 결과. 화면이 열릴 때·다시 들어올 때 부른다. 다시 감지하지 않는다. */
  harnesses(): Promise<SourceResult<readonly HarnessSettingsView[]>>;
  /** 사람이 [Detect again]을 누를 때만 부른다. 다시 감지한 결과를 돌려준다. */
  refresh(): Promise<SourceResult<readonly HarnessSettingsView[]>>;
  /** 제품마다 전역 hook이 놓였는지. 아무것도 쓰지 않는다. */
  hookStatus(): Promise<SourceResult<readonly HarnessHookView[]>>;
  /** 사람이 [Install hooks]를 누를 때만 부른다. 제품의 전역 설정 file에 hook을 쓴다. */
  installHooks(harness: HarnessName): Promise<SourceResult<HarnessHookView>>;
  defaults(): Promise<SourceResult<CodingDefaults>>;
  /** 기본 실행 옵션을 저장한다. 틀린 값이면 code가 거절 이유다. */
  saveDefaults(values: CodingDefaults): Promise<SourceResult<null>>;
}
