// 어떤 호출을 invocation으로 남기는지와 후행 기록 사실의 모양.
// 앱 runtime(Zod 없음)도 쓰므로 순수 타입과 규칙만 둔다. 값의 검증은 core command가 한다.

export type RecordedJson =
  | null
  | boolean
  | number
  | string
  | RecordedJson[]
  | { [key: string]: RecordedJson };

export type RecordedOperation =
  | { kind: "command"; command: string }
  | { kind: "start" }
  | { kind: "data_change"; from: number; to: number };

export type RecordedTrigger =
  | { kind: "direct" }
  | { kind: "automation"; key: string }
  | { kind: "activation"; activation_seq: number }
  | { kind: "restart" };

export type RecordedCaller =
  | { kind: "direct" }
  | { kind: "automation"; key: string }
  | {
    kind: "app";
    app: string;
    release: string;
    parent_invocation: string | null;
  }
  | { kind: "agent"; run: string; tool_call: string }
  | { kind: "system" };

// 후행 전달 사실 셋. 신원(app·release·mode)은 broker가 자식 연결에서 붙인다.
export type StartFact = {
  operation: RecordedOperation;
  trigger: RecordedTrigger;
  caller: RecordedCaller;
  actor: string;
  started_at: string;
};

export type FinishFact = {
  status: "succeeded" | "failed" | "unknown";
  started_at: string | null;
  finished_at: string;
  summary: RecordedJson;
  detail_hash: string | null;
};

export type DenyFact = {
  operation: RecordedOperation;
  trigger: RecordedTrigger;
  caller: RecordedCaller;
  actor: string;
  finished_at: string;
  summary: RecordedJson;
};

export type RecordedFact = "start" | "finish" | "deny";

export type SubmittedFact =
  | { fact: "start"; body: StartFact }
  | { fact: "finish"; body: FinishFact }
  | { fact: "deny"; body: DenyFact };

// "always"는 시작과 종료를 모두 남기고, "on_failure"는 실패·거절일 때만 한 번에 남긴다.
export type RecordingMode = "always" | "on_failure";

export type RecordingSubject = {
  operation: RecordedOperation["kind"];
  // command 경계가 아니면(앱 시작·데이터 변경) 없다.
  effect?: "read" | "write" | "external";
  confirm?: boolean;
  trigger: RecordedTrigger["kind"];
};

// confirm·write·external·automation(읽기 포함)·앱 시작·데이터 변경은 항상 남기고,
// 그 밖의 일반 읽기는 실패·거절만 남긴다. 호출자 종류(직접·다른 앱·agent)는 규칙을 바꾸지 않는다.
export function recordingMode(subject: RecordingSubject): RecordingMode {
  if (subject.operation !== "command") return "always";
  if (subject.confirm === true) return "always";
  if (subject.trigger === "automation") return "always";
  return subject.effect === "read" ? "on_failure" : "always";
}

// 후행 전달 메시지의 중복 방지 key. 같은 (inv ID, 사실)은 같은 메시지다.
export function deliveryKey(invocation: string, fact: RecordedFact): string {
  return `${invocation}:${fact}`;
}
