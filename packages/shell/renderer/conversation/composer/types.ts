// composer가 받는 화면 값. CSS를 부르는 component 없이 type만 가져올 수 있게 따로 둔다.

/** 입력칸 위에 붙은 context chip 하나. notification의 [Ask]로 연 session은 첫 chip이 사건 대상이다. */
export interface ContextChipView {
  readonly id: string;
  /** 사건 대상 이름. */
  readonly label: string;
}
