import type { CheckDefinition } from "./definitions.ts";

// test 앱 자식이 실제로 받은 보고. 접수는 runner broker가 그 요청의
// mode=test·scope로 collector에 넘긴 뒤의 사실이다.
export type ReceivedReport = {
  report_id: string;
  code: string;
  // 이 보고가 실제 command 호출 안에서 났으면 그 invocation, SDK를 직접 부른
  // 보고면 null이다.
  invocation_id: string | null;
  // 저장 전 redaction을 거친 보고 본문.
  stored: string;
};

// 앱이 바로 낸 ReadyAttestation의 test 자식 쪽 모양이다.
export type Attestation = {
  bundle_hash: string;
  commands: string[];
  data_schema: number;
  process_nonce: string;
};

export type SdkResult = {
  // SDK completion을 기다린 결과가 accepted일 때만 true다.
  accepted: boolean;
  reason: string;
  report: ReceivedReport | null;
};

export type InvokeResult = {
  invocation_id: string;
  outcome: "ok" | "error";
  // 이 호출 안에서 접수된 보고.
  reports: ReceivedReport[];
};

// 화면 검사 host가 판정할 수 없게 끝났다(exit 2–4·기한·잘못된 관측). 화면 검사는
// fail이 아니라 판정 불가로 남는다(shell#T46 계약, problems/tests#R7).
export class ViewHostInconclusive extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
    this.name = "ViewHostInconclusive";
  }
}

export type ViewDriver = {
  exception(): Promise<ReceivedReport[]>;
  feedback(): Promise<ReceivedReport[]>;
};

// test 앱 자식을 실제 진입점으로 구동하는 쪽(runner가 broker·caller다)이 test
// 자식에 주는 통로다. harness는 앱 code를 import하지 않고 이 통로로만 만진다.
export type AppDriver = {
  probe(): Promise<Attestation>;
  invoke(
    command: string,
    input: unknown,
    options?: { inject_failure: boolean },
  ): Promise<InvokeResult>;
  // 앱의 고정 SDK reportProblem을 직접 부른다.
  reportDirect(code: string): Promise<SdkResult>;
  // 앱의 SDK 접수 확인용 보고. 선언 code가 있으면 그 code, 없으면 진단 보고.
  sdkReceipt(): Promise<SdkResult>;
  // 처리되지 않은 process 예외를 일으키고 접수된 보고를 돌려준다.
  throwUnhandled(): Promise<ReceivedReport[]>;
  // canary가 든 보고를 내고 저장 전 본문을 돌려준다.
  reportWithSecret(secret: string): Promise<SdkResult>;
  // grant 없는 접근을 시도하고 거절되었는지 돌려준다.
  attemptDenied(): Promise<{ denied: boolean; reason: string }>;
  // 화면 있는 bundle의 화면 검사 host. 없으면 띄울 수 없다.
  view: ViewDriver | null;
};

export type HarnessPlanCheck = CheckDefinition & {
  digest: string;
  status: "required" | "not_applicable";
  reason: string;
};

// runner가 불변 설치 자료로 만들어 읽기 전용으로 건네는 검사 계획이다.
export type HarnessPlan = {
  bundle_hash: string;
  test_hash: string;
  declared_codes: string[];
  commands: string[];
  has_view: boolean;
  checks: HarnessPlanCheck[];
};
