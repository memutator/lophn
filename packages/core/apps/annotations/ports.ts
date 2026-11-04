import type { Result } from "../../../base/mod.ts";
import type { AnnotationId } from "../../../protocol/apps/annotation.ts";
import type { AgentId } from "../../../protocol/lophn-agent/places.ts";

// annotation module이 core 바깥에 기대는 것. 구현은 lead가 조립한다.
type AppId = string;
type ProjectId = string;
type SessionId = string;
type MessageId = string;

export type AnnotationDelivery = {
  /**
   * 고른 agent의 그 앱 place session에 사람 메시지 하나로 넣는다. session이 있으면 그 session
   * (그 agent의 그 앱 place 열린 session이어야 한다), null이면 새 session을 연다.
   * 보관한 앱이면 conflict다. 구현은 Router다.
   */
  deliver(input: {
    app: AppId;
    agent: AgentId;
    session: SessionId | null;
    text: string;
    annotations: readonly AnnotationId[];
  }): Promise<Result<{ session: SessionId; message: MessageId }>>;
  /**
   * artifact annotation을 받는 쪽에게 사람 메시지 하나로 넣는다. 후보 순서는 (a) 그 그릇의 artifacts 폴더에
   * 마지막으로 쓴 그 그릇 place의 열린 session, (b) 입력 session(그 그릇 place의 lophn 열린 session이어야
   * 한다), (c) 그 그릇 place의 lophn 새 session이다. 없거나 보관한 그릇이면 실패한다. 구현은 Router다.
   */
  deliverArtifact(input: {
    place: { kind: "project" | "app"; id: string };
    name: string;
    session: SessionId | null;
    text: string;
    annotations: readonly AnnotationId[];
  }): Promise<Result<{ session: SessionId; message: MessageId }>>;
  /**
   * 사람의 폴더에 있는 `.html`의 annotation을 그 project place의 lophn session에 사람 메시지 하나로 넣는다.
   * session이 있으면 그 project place의 열린 lophn session이어야 하고, null이면 새 session을 연다. 구현은 Router다.
   */
  deliverFile(input: {
    project: ProjectId;
    session: SessionId | null;
    text: string;
    annotations: readonly AnnotationId[];
  }): Promise<Result<{ session: SessionId; message: MessageId }>>;
};
