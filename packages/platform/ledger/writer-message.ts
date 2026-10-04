import type { LophnError, Result } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../contracts/platform/mod.ts";

// API 쪽과 writer Worker가 주고받는 작은 메시지. 연결 객체는 넘기지 않는다.
// command 이름은 등록 표의 route.name이다. SQL·파일 경로는 메시지에 없다(R20).

export type CommandEnvelope = {
  command: string;
  input: unknown;
  idempotency_key: string;
  compare: unknown;
  run?: string;
  prepared: readonly string[];
  // 일회 handle 원문이 아니라 사람 결정의 대상·내용이다. 지문에만 들어간다.
  decision?: { target: unknown; content: unknown };
};

export type CommandSuccess = {
  result: unknown;
  replayed: boolean;
  first_seq: string | null;
  last_seq: string | null;
  // commit 뒤에만 켜진다. 배포기는 reader에서 커밋된 event를 읽는다(R5).
  wake: boolean;
};

export type WriterRequest =
  | {
    id: number;
    op: "command";
    ctx: AuthenticatedContext;
    envelope: CommandEnvelope;
  }
  | { id: number; op: "read-result"; ctx: AuthenticatedContext; key: string }
  | { id: number; op: "close" };

export type StoredCommandResult = {
  principal: string;
  idempotency_key: string;
  fingerprint: string;
  result: unknown;
  first_seq: string | null;
  last_seq: string | null;
  at: string;
};

export type WriterResponse =
  | { id: number; op: "command"; body: Result<CommandSuccess, LophnError> }
  | {
    id: number;
    op: "read-result";
    body: Result<StoredCommandResult | null, LophnError>;
  }
  | { id: number; op: "closed" }
  | { id: number; op: "failed"; body: LophnError };
