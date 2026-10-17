interface DiffSpan {
  text: string;
  // 바뀐 단어는 진한 단어 배경을 쓴다.
  changed?: boolean;
}

export interface DiffLine {
  kind: "same" | "add" | "delete";
  oldNumber?: number;
  newNumber?: number;
  text: string;
  // 이어 붙이면 text가 되는 조각. 없으면 줄 전체가 한 조각이다.
  spans?: readonly DiffSpan[];
}

// 추가·삭제 줄은 정한 diff 배경과 +/− 기호를 함께 쓰고 글자는 primary다.
