// fake server가 밖에 내놓는 모양. e2e-support-core, e2e-support-shape, e2e-*, dev-fake가
// 이 이름으로 부른다.

export type Partial =
  | { text: string }
  | {
      // arguments의 앞 절반만 보낸다(JSON이 끝나지 않는다).
      tool: { id: string; name: string; arguments: string };
    };

export type Reply =
  | { kind: "text"; text: string; usage?: { input: number; output: number } }
  | {
      kind: "tool";
      calls: { id: string; name: string; arguments: string }[];
      text?: string;
    }
  | {
      kind: "error";
      status: number;
      headers?: Record<string, string>;
      body?: string;
    }
  // 연결을 열고 아무 byte도 안 준다. client가 끊을 때까지.
  | { kind: "silent" }
  // 일부 event 뒤 message_stop 없이 연결을 닫는다.
  | { kind: "cut"; partial: Partial }
  // 일부 event 뒤 더는 안 주고 client가 끊을 때까지 둔다.
  | { kind: "stall"; partial: Partial }
  | {
      kind: "raw";
      status: number;
      headers: Record<string, string>;
      chunks: string[];
      end?: "close" | "hold";
    };

export type JournalEntry = {
  n: number; // 1부터
  method: string;
  path: string;
  headers: Record<string, string>; // 소문자 이름
  body: unknown; // JSON이면 파싱한 값, 아니면 원문 글
  step: number | null; // 쓴 step 번호(0부터). 못 쓰면 null
  mismatch: string | null; // 차이 오류로 답했으면 그 설명
  lane: string | null; // 요청을 받은 줄 이름. 기본 줄이 받았으면 null
};

// 응답을 만들기 직전에 부른다. 그 요청이 journal에 들어간 뒤라 journal의 마지막이 request다.
export type ReplyFn = (
  request: JournalEntry,
  journal: readonly JournalEntry[],
) => Reply;

export type Step = {
  reply: Reply | ReplyFn;
  // 문자열을 돌려주면 그것이 차이 설명이다. null이면 기대대로다.
  expect?: (request: JournalEntry) => string | null;
};

export type Lane = {
  name: string;
  match: (request: JournalEntry) => boolean;
};

export type FakeServer = {
  url: string; // "http://127.0.0.1:<port>"
  // lane 없이 부르면 기본 줄의 queue를 대체한다. lane을 주면 그 name의 줄을 더하거나 그 queue를 대체한다.
  // 요청은 줄을 등록한 순서대로 match를 검사해 처음 true인 줄로 가고, 어느 줄에도 안 맞으면 기본 줄로 간다.
  script(steps: readonly Step[], lane?: Lane): void;
  reset(): void; // 줄, queue, journal을 비운다
  journal(): readonly JournalEntry[];
  arrived(n: number): Promise<JournalEntry>; // n번째(1부터) 요청이 들어온 때 풀린다
  aborted(n: number): Promise<void>; // n번째 요청을 server가 붙들고 있는 동안(silent, stall, raw hold) client가 끊은 때 풀린다. 다 보낸 응답 뒤의 끊김과 close()는 풀지 않는다
  handle(request: Request): Promise<Response>;
  close(): Promise<void>;
};
