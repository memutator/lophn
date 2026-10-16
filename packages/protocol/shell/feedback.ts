// 버튼 시점 고정 참조. 원문은 main 메모리다.

// 제보는 글만 보낸다. 화면 상태·screenshot 선택이 없다.
// existing_problem은 Issues에서 고른 같은 앱의 기존 문제다. null이면 새 문제다.

// 접수된 feedback이 묶인 Issue로 간다. dialog를 닫고 그 앱 공간을 연다.

// problems/feedback 한도를 shell이 복제하지 않고 다시 내보낸다.

export type LophnShellFeedbackSend = {
  sendFeedback(
    draftRef: string,
    text: string,
    existing_problem: string | null,
  ): Promise<{ report: string; problem: string | null }>;
};
