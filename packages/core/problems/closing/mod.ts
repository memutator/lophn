// problems/closing은 지워졌다. 아래는 `problems.closing` 반응기를 부르는 곳(test runner service)이 다른
// 단위에서 끊기기 전까지 남긴 경계다.
export {
  CLOSING_EVENT_TYPES,
  CLOSING_SUBSCRIBER,
  type ClosingEvent,
  closingReactionKey,
  type ClosingReactionPorts,
  reactClosing,
} from "./work.ts";
export {
  type ClosingClientOptions,
  createClosingPorts,
} from "./adapters/core-client.ts";
