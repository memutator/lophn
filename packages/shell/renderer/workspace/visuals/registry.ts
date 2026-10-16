// 대화 안 앱 카드의 참조. 본문의 `app_card` part가 싣는 값이다.

export interface AppCardRef {
  readonly app: string;
  /** 카드를 만든 때의 판. 본문의 `app_card` part는 판을 싣지 않아 null이고, 그때는 지금 판이다. */
  readonly release: string | null;
  /** 앱 blueprint 화면 key. */
  readonly view: string;
}
