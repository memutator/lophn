// notification의 [Ask <agent 이름>]이 쓰는 값.
// 어느 계기에 [Ask]가 붙고 무엇을 첫 context로 싣는지는 core가 계기 표로 계산해(platform의
// notifications/ask-agent.ts) 알림 행에 실어 보낸다. 이 화면은 표를 모르고 받은 값을 그대로 쓴다.

/** 부를 수 있는 agent의 role. */
export type AskRole = "app_engineer" | "context_engineer";

/** 첫 context가 가리키는 대상 종류. */
export type AskTarget = "problem" | "release";

/**
 * [Ask <agent>]가 callback에 싣는 전부다. Agent 탭을 열 role과 자리, 첫 context가 될 대상
 * 참조뿐이다. 메시지·run·notification 본문 복사본은 없고 보내는 일도 없다.
 */
export interface AskRequest {
  readonly notification: string;
  readonly role: AskRole;
  readonly workPlace: { readonly kind: "app"; readonly id: string };
  readonly openingContext: {
    readonly sourceSeq: string;
    readonly target: { readonly kind: AskTarget; readonly id: string };
  };
}

/** 알림 행이 싣고 오는 Ask 값. 계기가 부를 agent를 갖지 않으면 행의 ask는 null이다(보기만). */
export interface AskView {
  /** 단추에 쓰는 agent 정의의 이름. */
  readonly agentName: string;
  /** callback에 그대로 싣는 값(role 포함). */
  readonly request: AskRequest;
}
