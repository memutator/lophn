// writer Worker가 commit 뒤 할 일로 main thread에 넘기는 일의 이름이다(`storage/ledger`의 `afterCommit`).
export const QUEUE_PUT_TOPIC = "queue.put";
export const QUEUE_CLEAR_TOPIC = "queue.clear";
// 아직 가져가지 않은 call 입력 하나를 queue에서 거둔다(그 call이 닫혔다).
export const QUEUE_WITHDRAW_TOPIC = "queue.withdraw";
export const AGENT_EVENT_TOPIC = "agent_event";
