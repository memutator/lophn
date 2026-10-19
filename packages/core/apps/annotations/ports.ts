import type { Result } from "../../../base/mod.ts";
import type {
  AnnotationId,
  AnnotationRead,
} from "../../../protocol/apps/annotation.ts";

// annotation module이 core 바깥에 기대는 것. 구현은 lead가 조립한다.
type AppId = string;
type ProjectId = string;
type SessionId = string;
type MessageId = string;

export type AnnotationDelivery = {
  /**
   * 그 앱의 Project Manager에게 사람 메시지 하나로 넣는다. session이 있으면 그 session
   * (그 앱 Project Manager의 열린 session이어야 한다), null이면 새 session을 연다.
   * 보관한 앱이면 conflict다. 구현은 Router다.
   */
  deliver(input: {
    app: AppId;
    session: SessionId | null;
    text: string;
    annotations: readonly AnnotationId[];
  }): Promise<Result<{ session: SessionId; message: MessageId }>>;
  /**
   * artifact annotation을 받는 쪽에게 사람 메시지 하나로 넣는다. session은 pane에 열려 있는 그 project의
   * Project Manager session이고 받는 쪽을 정할 때 쓰는 마지막 후보일 뿐이다. 없는 project나 보관 project면
   * 실패한다. 구현은 Router다(wave 2).
   */
  deliverArtifact?(input: {
    project: ProjectId;
    name: string | null;
    session: SessionId | null;
    text: string;
    annotations: readonly AnnotationId[];
  }): Promise<Result<{ session: SessionId; message: MessageId }>>;
};

export type AnnotationLookup = {
  /** ticket 근거를 읽는 쪽(core/apps/tickets)이 core 안에서 부른다. annotation-core가 구현한다. */
  byIds(ids: readonly AnnotationId[]): Result<readonly AnnotationRead[]>;
};
