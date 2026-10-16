// Diagnostics 화면이 읽는 통로. 구성 요소마다 지금 쓸 수 있는지, 안전한 불가 이유, 실제로 점검한
// 시각이다(`diagnostics/status`). 모양은 protocol(diagnostics)에서 이 화면이 쓰는 field만 옮긴 것이다.
// 경로·key·값은 이 통로에 없다. 점검은 사람이 [Run checks]를 누를 때만 한다.
import type { SourceResult } from "../source.ts";

export type { SourceResult };

/** core가 점검하는 구성 요소. 새 이름이 와도 화면은 이름을 그대로 읽을 수 있게 string이다. */
interface ComponentStatus {
  readonly component: string;
  readonly available: boolean;
  /** 안전한 불가 이유. 쓸 수 있으면 null이다. */
  readonly reason: string | null;
  readonly checkedAt: string;
}

export interface DiagnosticsView {
  readonly checkedAt: string;
  readonly components: readonly ComponentStatus[];
}

export interface DiagnosticsSource {
  /** 지금 점검한다. 사람이 누를 때만 부른다. */
  check(): Promise<SourceResult<DiagnosticsView>>;
}
