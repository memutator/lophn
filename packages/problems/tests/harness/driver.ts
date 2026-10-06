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

export type MigrationScenario = "empty" | "upgrade";

// 고정 fixture DB에서 돌린 migration 한 번의 결과. 빈 DB 전체 migration은 schema 0에서,
// 이전 release schema는 이전 release의 schema에서 시작한다(problems/tests#R8).
export type MigrationRun = {
  ok: boolean;
  from_schema: number;
  data_schema: number;
  integrity_ok: boolean;
  // 중간 실패로 첫 변경 전 backup으로 되돌렸으면 true다(apps/data#R7).
  restored: boolean;
  reason: string;
};

// read command 한 번을 fixture에서 불러 본 관측. 상태는 hash로만 주고받는다.
export type ReadProbe = {
  // 입력 계약을 어긴 입력이 거절됐는지.
  invalid_input_rejected: boolean;
  business_before: string;
  business_after: string;
  external_effects: number;
};

export type AutomationRun = {
  ran: boolean;
  approvals_used: number;
  reason: string;
};

export type SecretOperation = "import" | "write" | "sync";
export type SecretUseResult = {
  allowed: boolean;
  approvals_requested: number;
};

// net·secret·문서 쓰기가 닿은 곳. 고정 대역이 받은 요청과, 대역 밖으로 나간 접속이다.
export type AdapterEffects = {
  net: { host: string; port: number }[];
  secret_uses: { name: string }[];
  document_writes: { key: string }[];
  real_connections: string[];
};

export type ChangeResult = {
  ok: boolean;
  // 변경에 묶인 되돌림 자료. 되돌릴 수 없으면 null이다.
  revert: string | null;
  state_after: string;
};

export type RevertResult = {
  ok: boolean;
  code: "conflict" | "already_reverted" | "invalid_input" | null;
  state_after: string;
};

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
  // 고정 fixture DB의 migration. 빈 DB 전체와 이전 release schema → 새 schema다.
  migrate(scenario: MigrationScenario): Promise<MigrationRun>;
  // read command를 fixture에서 잘못된 입력과 정상 입력으로 불러 본다.
  probeRead(command: string): Promise<ReadProbe>;
  // 선언한 automation을 실행한다. approval은 사람이 켤 때 한 번 하는 승인이다.
  runAutomation(
    key: string,
    approval: "none" | "once",
  ): Promise<AutomationRun>;
  // confirm command를 automation으로 실행하려 하고 거절됐는지 돌려준다.
  attemptConfirmAutomation(
    command: string,
  ): Promise<{ refused: boolean; reason: string }>;
  // grant된 secret을 대역으로 쓴다. caller는 사람이 부른 command나 automation이다.
  useSecret(input: {
    name: string;
    operation: SecretOperation;
    caller: "command" | "automation";
  }): Promise<SecretUseResult>;
  // 외부에 닿는 command를 대역으로만 실행하고 닿은 곳을 돌려준다.
  exerciseAdapters(): Promise<AdapterEffects>;
  // 업무 데이터의 현재 상태 hash.
  businessState(): Promise<string>;
  // 되돌리기를 지원하는 write command를 fixture 입력으로 한 번 실행한다.
  change(command: string): Promise<ChangeResult>;
  revert(token: string): Promise<RevertResult>;
};

export type PlanCommand = {
  key: string;
  effect: "read" | "write" | "external";
  confirm: boolean;
  revert: { supported: boolean; command?: string };
};

export type PlanAutomation = { key: string; command: string };

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
  command_details: PlanCommand[];
  automations: PlanAutomation[];
  // 선언한 secret.use 이름. 사람이 grant한 것으로 대역이 받는다.
  secrets: string[];
  // 선언한 net.fetch 목적지와 document.save key. 대역이 받을 수 있는 곳이다.
  net: { host: string; port: number }[];
  documents: string[];
  // 새 bundle의 data schema(0은 DB 미사용)와 이전 release의 schema.
  data: { schema: number; previous_schema: number | null };
  checks: HarnessPlanCheck[];
};
