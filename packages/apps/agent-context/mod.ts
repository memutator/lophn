// 앱이 agent에게 보여 줄 화면 context의 규칙(apps/agent-context). 입력 검사·민감 칸 제거·요약
// 크기 제한과 SDK에 설치하는 host port다. 모두 의존성 없이 순수해 release bundle에 들어간다.
// 화면 상태의 정본은 앱이고 lophn ledger에는 화면 상태를 저장하지 않는다.
export {
  isOpaque,
  isPointer,
  parseReadInput,
  parseWriteInput,
  pointerOf,
  pointerTokens,
  SUMMARY_MAX_BYTES,
  utf8Length,
} from "./schema.ts";
export type { Parsed, ReadInput, WriteInput } from "./schema.ts";
export {
  DATA_MAX_DEPTH,
  LEAK_MIN_CHARS,
  limitSummary,
  prepareScreenContext,
} from "./redaction.ts";
export type { PreparedContext, PrepareInput } from "./redaction.ts";
export {
  createScreenContextHost,
  installScreenContextHost,
  SCREEN_CONTEXT_PORT,
} from "./host.ts";
export type {
  DeclaredContext,
  ScreenContextHost,
  ScreenContextSource,
} from "./host.ts";
