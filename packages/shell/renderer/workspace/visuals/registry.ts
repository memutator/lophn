// 대화 안 앱 카드의 참조. 본문의 `app_card` part가 싣는 값이다.
import type { AppViewOpen } from "../../../ipc/app-frame.ts";

export interface AppCardRef {
  readonly app: string;
  /** 카드를 만든 때의 판. 본문의 `app_card` part는 판을 싣지 않아 null이고, 그때는 지금 판이다. */
  readonly release: string | null;
  /** 앱 선언의 화면 key. */
  readonly view: string;
  /** 카드 화면에 넘긴 인자. 없으면 인자 없이 연다. */
  readonly params?: AppViewOpen["params"];
}
