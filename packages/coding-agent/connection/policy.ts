import type { ConnectionScope } from "../../protocol/coding-agent/mod.ts";

// 앱 scope가 허용하는 concern. 목록·검색·절·첨부·추가 근거에도 같은 범위다.
export const APP_SCOPE_CONCERNS = [
  "documents",
  "app",
  "problems",
  "tickets",
  "formats",
  "sdk",
  "templates",
] as const;

export type AppScopeConcern = (typeof APP_SCOPE_CONCERNS)[number];

// domain-model 금지 작업. coding agent에게는 scope와 무관하게 없다.
export const FORBIDDEN_ACTIONS = [
  "approval.decide",
  "grant.change",
  "secret.read",
  "backup.read",
  "problem.close",
  "problem.ignore",
  "problem.confirm",
  "connection.create",
  "connection.revoke",
  "connection.widen",
  "project.register",
  "project.tracking",
  "assignment.change",
  "ticket.goal",
  "ticket.confirm",
  "test_result.write",
] as const;

export type ForbiddenAction = (typeof FORBIDDEN_ACTIONS)[number];

export function appScopeAllows(concern: string): boolean {
  return (APP_SCOPE_CONCERNS as readonly string[]).includes(concern);
}

export function isForbiddenAction(action: string): boolean {
  return (FORBIDDEN_ACTIONS as readonly string[]).includes(action);
}

// 앱 등록은 scope all만 허용한다. app scope의 등록 요청은 거절한다.
export function registrationAllowed(scope: ConnectionScope): boolean {
  return scope.kind === "all";
}

// 금지 작업마다 daemon이 거절해야 하는 소유 route 이름이다. 이름 그대로 고정이라
// 계약이 이름을 바꾸면 시험이 깨진다. route가 없는 동작은 빈 배열이다: 없는 것을 열어
// 주지 않는 것이 그 거절이다.
export const FORBIDDEN_ROUTES: Readonly<
  Record<ForbiddenAction, readonly string[]>
> = {
  "approval.decide": ["grant_approval_request", "reject_approval_request"],
  "grant.change": ["grant.create", "grant.revoke"],
  // 값을 읽는 route는 없다. 등록·삭제·입력과 이름 조회를 coding credential에 주지 않는다(cli#R38).
  "secret.read": ["SetSecret", "RemoveSecret", "secret.input", "ListSecrets"],
  "backup.read": ["ListBackups", "GetBackup"],
  "problem.close": ["CloseProblemVerified", "ApplyProblemDecision"],
  "problem.ignore": ["ApplyProblemDecision"],
  "problem.confirm": ["ApplyProblemDecision"],
  "connection.create": ["CreateCodingAgentConnection"],
  "connection.revoke": ["RevokeCodingAgentConnection"],
  "connection.widen": ["CreateCodingAgentConnection"],
  "project.register": ["project.create", "project.update", "project.archive"],
  "project.tracking": [
    "project.set_tracking",
    "project.preview_tracking",
    "project.unarchive",
  ],
  "assignment.change": [
    "CreateOperatorAssignment",
    "PauseAssignment",
    "ResumeAssignment",
    "WithdrawAssignment",
  ],
  "ticket.goal": ["CreateTicket", "MakeTicketReady", "CancelTicket"],
  "ticket.confirm": ["RecordTicketChecks"],
  "test_result.write": [
    "RecordVerification",
    "RecordTicketChecks",
    "file.record_result",
  ],
};

// 원본 파일·문서 자리 관리는 사람의 화면 몫이다. 문서 정본 저장(document.save)만
// coding credential의 길이다(cli#R16·R17·R23).
export const HUMAN_ONLY_DOCUMENT_ROUTES = [
  "document.move",
  "document.rename",
  "document.archive",
  "document.unarchive",
  "document.set_source",
  "document.restore",
  "files.list",
  "files.read",
  "files.status",
  "files.watch",
  "files.write",
  "files.rename",
  "files.delete",
] as const;

export function forbiddenRouteNames(): string[] {
  return [
    ...new Set([
      ...Object.values(FORBIDDEN_ROUTES).flat(),
      ...HUMAN_ONLY_DOCUMENT_ROUTES,
    ]),
  ];
}
