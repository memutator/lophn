// mod.ts는 runtime-facing 자리다. 앱 runtime이 부르는 cap-schedule host port와 후행 기록 사실의
// 모양·규칙만 내보낸다(sdk/cap-schedule#R5, platform/responsiveness#R1). 모두 Zod 없이 순수하다.
// ledger 조립은 commands.ts·reads.ts·schema.ts·store.ts를 직접 부르고, 전달 목록은 delivery/를 부른다.
export {
  readSchedulePort,
  readStagePort,
  SCHEDULE_PORT,
  STAGE_PORT,
} from "./context.ts";
export type {
  InvocationContext,
  InvocationStageState,
  RegisteredHandler,
  SchedulePort,
  StagePort,
} from "./context.ts";
export { deliveryKey, recordingMode } from "./recording.ts";
export type {
  DenyFact,
  FinishFact,
  RecordedCaller,
  RecordedFact,
  RecordedJson,
  RecordedOperation,
  RecordedTrigger,
  RecordingMode,
  RecordingSubject,
  StartFact,
  SubmittedFact,
} from "./recording.ts";
// 전달 목록의 모양은 type만 내보낸다(런타임 import가 없다). 목록 구현은 delivery/queue.ts다.
export type {
  DeliveryLimits,
  DeliveryMessage,
  DeliveryOutcome,
  DeliveryQueue,
  LossReport,
} from "./delivery/queue.ts";
