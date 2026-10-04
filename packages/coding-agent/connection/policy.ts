import type { ConnectionScope } from "../../contracts/coding-agent/mod.ts";

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
  "context.define",
  "term.define",
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
