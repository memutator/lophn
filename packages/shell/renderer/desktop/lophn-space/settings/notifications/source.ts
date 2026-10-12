// settings OS notification 자리가 읽고 쓰는 통로. 설정 값만 저장한다. 실제 OS notification은
// 이 통로에 없다. 모양은 contracts(settings)에서 이 자리가 쓰는 field만 옮긴 것이다.
import type { SourceResult } from "../source.ts";

export type { SourceResult };

export interface NotificationsView {
  /** OS notification 설정 값. 아직 고르지 않으면 null이다. */
  readonly enabled: boolean | null;
  /** 바꿀 때의 비교 기준. */
  readonly revision: number;
  readonly defaultsRevision: string;
}

export interface NotificationsSource {
  /** core 연결 상태를 듣는다. 준비되면 화면이 다시 읽는다. 해제는 반환 함수다. */
  watch(listener: (state: { readonly state: string }) => void): () => void;
  /** OS notification 설정 값을 읽는다. */
  notifications(): Promise<SourceResult<NotificationsView>>;
  /** OS notification 설정 값을 저장한다. 실제 OS notification은 보내지 않는다. */
  setNotifications(
    view: NotificationsView,
    enabled: boolean,
  ): Promise<SourceResult<null>>;
}
