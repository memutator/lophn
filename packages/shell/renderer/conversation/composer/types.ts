// composer가 받는 화면 값. CSS를 부르는 component 없이 type만 가져올 수 있게 따로 둔다.

/**
 * 입력칸 위에 붙은 context chip 하나. 계약 위반 toast가 여는 session은 첫 chip이 위반 대상이다.
 * 위반을 붙인 채 여는 Project Manager 대화는 위반의 파일과 어긴 규칙도 싣는다.
 */
export interface ContextChipView {
  /** chip 목록 안에서 chip을 가리키는 key(위반 key나 check id). */
  readonly id: string;
  /** 이 chip이 가리키는 context id(ctx_…). agent에게 `attached`로 전할 때 쓴다. */
  readonly context: string;
  /** 사건 대상 이름. */
  readonly label: string;
  /** 위반을 붙인 chip일 때 그 파일과 어긴 규칙. */
  readonly violation?: {
    readonly file: string;
    readonly rule: string;
  };
}
