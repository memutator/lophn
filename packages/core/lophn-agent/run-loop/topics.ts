// writer Worker가 commit 뒤 할 일로 main thread에 넘기는 일의 이름이다(`storage/ledger`의 `afterCommit`).
export const QUEUE_PUT_TOPIC = "queue.put";
export const QUEUE_CLEAR_TOPIC = "queue.clear";
export const AGENT_EVENT_TOPIC = "agent_event";
