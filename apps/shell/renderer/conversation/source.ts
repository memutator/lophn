// 대화 도크가 core에 묻고 보내는 통로. 모양은 lophn-agent contract(session·message·run·
// assignment read, ReadMessageBody와 OpenSession·ReceiveMessage·StopRun)에서 이 화면이
// 읽는 field만 옮겼다.
import type { ConnectionState } from "../desktop/connection/connection.ts";

export type SourceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string };

/** lophn 역할의 담당. 화면에는 이름이 나오지 않는다(ui-ux 3절). */
export interface Agent {
  readonly id: string;
  readonly state: "enabled" | "paused" | "withdrawn";
  readonly revision: number;
}

export type WorkPlace =
  | { readonly kind: "global"; readonly id: null }
  | { readonly kind: "project"; readonly id: string }
  | { readonly kind: "app"; readonly id: string };

export interface SessionRow {
  readonly id: string;
  readonly state: "open" | "closed";
  readonly stateSeq: string;
}

/** 답 아래에 두는 결과. 실제로 만들거나 바꾼 문서만이다(lophn-agent/conversation#R4). */
export type ResultLink =
  | { readonly kind: "document"; readonly document: string }
  | {
    readonly kind: "version";
    readonly document: string;
    readonly version: string;
  };

export type MessageActor = "user" | "machine" | "agent";

export interface MessageRow {
  readonly id: string;
  readonly actor: MessageActor;
  /** 본문 blob의 hash. 글은 ReadMessageBody로 따로 읽는다(bodies.ts). */
  readonly body: string;
  readonly run: string | null;
  readonly mode: "request" | "correction" | null;
  /** model 판단에 처음 반영됐는지. 접수와 따로 보인다(conversation#R3). */
  readonly applied: boolean;
  readonly results: readonly ResultLink[];
}

export interface RunRow {
  readonly id: string;
  readonly session: string | null;
  readonly state: "accepted" | "running" | "waiting_user" | "finished";
  readonly outcome: "completed" | "failed" | "stopped" | null;
  readonly stateSeq: string;
  readonly acceptedSeq: string;
}

/** 사람 말의 본문 값. 글 part만이고 hash·blob은 core가 만든다(lophn-agent Q29). */
export interface TextContent {
  readonly schema_version: 1;
  readonly parts: readonly [{ readonly kind: "text"; readonly text: string }];
}

/**
 * 확정 메시지 본문의 한 part. 시각 블록은 받은 값 그대로이며 블록 renderer
 * (workspace/visuals/registry.ts)가 그리기 전에 검사한다.
 */
export type BodyPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "visual"; readonly block: unknown };

export interface SendInput {
  readonly session: SessionRow;
  readonly agent: Agent;
  readonly id: string;
  readonly key: string;
  readonly content: TextContent;
  readonly mode: "request" | "correction";
  readonly run: string | null;
}

export interface ConversationSource {
  /** main이 미는 연결 상태. 끊겨도 화면은 마지막 내용을 둔다(desktop#R7). */
  watch(listener: (state: ConnectionState) => void): () => void;
  /** 사람이 대화하는 lophn 역할의 담당. 없으면 null이다. */
  agent(): Promise<SourceResult<Agent | null>>;
  sessions(agent: string): Promise<SourceResult<readonly SessionRow[]>>;
  messages(session: string): Promise<SourceResult<readonly MessageRow[]>>;
  runs(agent: string): Promise<SourceResult<readonly RunRow[]>>;
  openSession(
    input: { id: string; agent: Agent; workPlace: WorkPlace },
  ): Promise<SourceResult<SessionRow>>;
  /**
   * 확정 메시지 하나의 본문(ReadMessageBody). 범위 밖이나 없는 메시지는 not_found,
   * 본문 blob을 못 읽으면 unavailable이다.
   */
  body(message: string): Promise<SourceResult<readonly BodyPart[]>>;
  /** 같은 id·key로 다시 보내면 core가 이전 결과를 돌려준다(conversation#R2). */
  send(input: SendInput): Promise<SourceResult<void>>;
  stop(run: RunRow, key: string): Promise<SourceResult<void>>;
  documentTitle(document: string): Promise<SourceResult<string>>;
}
