import type { Result } from "../../../base/mod.ts";
import type {
  AnnotationId,
  AnnotationRead,
} from "../../../protocol/apps/annotation.ts";

// annotation module이 core 바깥에 기대는 것. 구현은 lead가 조립한다.
type AppId = string;
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
    images: readonly {
      hash: string;
      size_bytes: number;
      media_type: "image/png";
    }[];
    annotations: readonly AnnotationId[];
  }): Promise<Result<{ session: SessionId; message: MessageId }>>;
};

export type ReleaseSourceMaps = {
  /** release의 UI bundle 파일에 맞는 source map 본문. 없으면 null. */
  sourceMap(
    app: AppId,
    release: string,
    bundleFile: string,
  ): Promise<Result<string | null>>;
};

export type AnnotationLookup = {
  /** ticket 근거를 읽는 쪽(core/apps/tickets)이 core 안에서 부른다. annotation-core가 구현한다. */
  byIds(ids: readonly AnnotationId[]): Result<readonly AnnotationRead[]>;
};
