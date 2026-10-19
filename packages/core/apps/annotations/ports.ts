import type { Result } from "../../../base/mod.ts";
import type {
  AnnotationId,
  AnnotationRead,
} from "../../../protocol/apps/annotation.ts";

// annotation module이 core 바깥에 기대는 것. 구현은 lead가 조립한다.
type AppId = string;
type DomainId = string;
type ProjectId = string;
type SessionId = string;
type MessageId = string;

export type AnnotationDelivery = {
  /**
   * 그 앱의 App Engineer에게 사람 메시지 하나로 넣는다. session이 있으면 그 session
   * (그 앱 App Engineer의 열린 session이어야 한다), null이면 새 session을 연다.
   * 보관한 앱이면 conflict다. 구현은 Router다.
   */
  deliver(input: {
    app: AppId;
    session: SessionId | null;
    text: string;
    annotations: readonly AnnotationId[];
  }): Promise<Result<{ session: SessionId; message: MessageId }>>;
  /**
   * artifact annotation을 받는 쪽에게 사람 메시지 하나로 넣는다. 후보 순서는 (a) 그 domain의 artifacts 폴더에
   * 마지막으로 쓴 열린 session, (b) 입력 session(그 domain owner의 열린 PM 또는 App Engineer여야 한다),
   * (c) owner의 새 session이다. 없는 domain이나 보관한 owner면 실패한다. 구현은 Router다.
   */
  deliverArtifact(input: {
    domain: DomainId;
    name: string;
    session: SessionId | null;
    text: string;
    annotations: readonly AnnotationId[];
  }): Promise<Result<{ session: SessionId; message: MessageId }>>;
  /**
   * 사람의 폴더에 있는 `.html`의 annotation을 그 project의 PM에게 사람 메시지 하나로 넣는다. session이 있으면
   * 그 project의 열린 PM session이어야 하고, null이면 새 session을 연다. 구현은 Router다.
   */
  deliverFile(input: {
    project: ProjectId;
    session: SessionId | null;
    text: string;
    annotations: readonly AnnotationId[];
  }): Promise<Result<{ session: SessionId; message: MessageId }>>;
};

export type AnnotationLookup = {
  /** ticket 근거를 읽는 쪽(core/apps/tickets)이 core 안에서 부른다. annotation-core가 구현한다. */
  byIds(ids: readonly AnnotationId[]): Result<readonly AnnotationRead[]>;
};
