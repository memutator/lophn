// requests_test.ts의 ledger harness 준비. 테스트 이름과 단언은 그 파일에 있다.

import { assert } from "@std/assert";
import type { Result } from "../../base/mod.ts";
import { fingerprint } from "../../base/mod.ts";
import type {
  ApprovalAction,
  ApprovalEffectInput,
  AuthenticatedContext,
  SqlRow,
} from "../../contracts/platform/mod.ts";
import {
  approvalBinding,
  type ApprovalRequest,
  grantApprovalRequest,
  rejectApprovalRequest,
} from "../../contracts/platform/mod.ts";
import { confirmationBinding } from "../identity/mod.ts";
import { effectText, REASON_TEXT } from "./testing/mod.ts";

export type CommandEnvelope = {
  command: string;
  input: unknown;
  idempotency_key: string;
  compare: unknown;
  prepared: readonly string[];
  run?: string;
  confirmation?: string;
};

export type LedgerHarness = {
  command(
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
  ): Promise<Result<{ result: unknown; replayed: boolean }>>;
  read(
    route: { resource: string; method: string },
    ctx: AuthenticatedContext,
    input: unknown,
  ): Promise<Result<unknown>>;
  // main↔core 비공개 통로의 handle 발급과 같다. writer의 confirmation registry에만 남는다.
  confirmation(body: {
    action: "issue" | "close-window" | "clear";
    request?: unknown;
    windowId?: string;
  }): Promise<Result<unknown>>;
  inspect(
    query: string,
    params?: readonly unknown[],
  ): Promise<Result<SqlRow[]>>;
  close(): Promise<void>;
};

const REGISTRATION = new URL("./harness_test.ts", import.meta.url);
export const NOW = Date.UTC(2026, 9, 5);

const OPERATIONS = [
  "create_approval_request",
  "expire_approval_request",
  "cancel_approval_request",
  "seed_approval_request",
  "probe_use_approval",
  "grant_approval_request",
  "reject_approval_request",
  "GetApproval",
  "ListApprovals",
];

export const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
export const APPROVAL = "apr_01h455vb4pex5v6nkc6gd5fdw1";

export function credential(
  actor: AuthenticatedContext["actor"],
  principal: string,
): AuthenticatedContext {
  return {
    actor,
    principal,
    credential_ref: `test:${principal}:${actor}`,
    scope: { operations: [...OPERATIONS], targets: {} },
    conditions: {},
  };
}

export const user = credential("user", "user-1");
export const machine = credential("machine", "machine-1");

export function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

export function requestOf(
  result: { result: unknown },
): Record<string, unknown> {
  const body = result.result as { request: Record<string, unknown> };
  return body.request;
}

export function failure(result: Result<unknown>): { code: string } {
  assert(!result.ok, "거절을 기다렸다");
  return { code: result.error.code };
}

export async function openHarness(
  credentials: readonly AuthenticatedContext[],
  nowMs = NOW,
): Promise<LedgerHarness> {
  const harness = await import("../../../apps/core/testing/ledger.ts");
  return value(
    await harness.createLedgerHarness({
      registrationModules: [REGISTRATION],
      credentials,
      nowMs,
    }),
  );
}

export async function action(): Promise<ApprovalAction> {
  const draft = {
    concern: "apps/invocations",
    command: "record_started",
    caller: `app:${APP}` as const,
    targets: [APP],
    input: {
      kind: "inline" as const,
      value: { release: "rel_01h455vb4pex5v6nkc6gd5fdw1" },
    },
    input_hash: "ab".repeat(32),
    comparison: { release: "rel_01h455vb4pex5v6nkc6gd5fdw1" },
  };
  return {
    ...draft,
    binding_hash: await fingerprint(
      approvalBinding({ ...draft, binding_hash: "ab".repeat(32) }),
    ),
  };
}

// 설명 글 값. 요청에 값으로 싣는다.
export function effect(external: string | undefined): ApprovalEffectInput {
  return effectText({
    changes: "release 하나를 시작한다",
    external: external ?? null,
    reversibility: "시작한 뒤에는 되돌리지 못한다",
  });
}

export async function create(
  harness: LedgerHarness,
  ctx: AuthenticatedContext,
  options: {
    id?: string;
    external?: string;
    expiresAt?: string | null;
    key?: string;
    run?: string | null;
    sessionGrantable?: boolean;
    // 기본은 harness의 고정 action이다. confirm 같은 다른 동작을 고정할 때 준다.
    action?: ApprovalAction;
  } = {},
): Promise<Result<{ result: unknown; replayed: boolean }>> {
  return await harness.command(ctx, {
    command: "create_approval_request",
    input: {
      id: options.id ?? APPROVAL,
      requester: ctx.actor,
      run: options.run ?? null,
      reason: REASON_TEXT,
      effect: effect(options.external),
      action: options.action ?? await action(),
      expires_at: options.expiresAt ?? null,
      session_grantable: options.sessionGrantable ?? false,
    },
    idempotency_key: options.key ?? `create-${options.id ?? APPROVAL}`,
    compare: {},
    prepared: [],
    ...(options.run ? { run: options.run } : {}),
  });
}

export type Decision = "grant" | "reject";

export async function decisionInput(
  harness: LedgerHarness,
  id: string,
  reason?: string | null,
): Promise<Record<string, unknown>> {
  const read = value(
    await harness.read({ resource: "approvals", method: "get" }, user, {
      approval: id,
    }),
  ) as { request: ApprovalRequest };
  return {
    approval: id,
    created_seq: read.request.created_seq,
    binding_hash: read.request.action.binding_hash,
    ...(reason === undefined ? {} : { closed_reason: reason }),
  };
}

// 사람이 confirmation window에서 본 내용으로 handle을 발급한다.
export async function issue(
  harness: LedgerHarness,
  decision: Decision,
  input: Record<string, unknown>,
): Promise<string> {
  const route = decision === "grant"
    ? grantApprovalRequest
    : rejectApprovalRequest;
  const binding = await confirmationBinding(route, shaped(decision, input));
  assert(binding);
  const issued = value(
    await harness.confirmation({
      action: "issue",
      request: {
        type: "confirmation_handle_register",
        window_id: `win-${decision}`,
        target_ref: binding.target,
        content_hash: binding.content,
        allowed_decisions: [route.name],
        expires_at: new Date(NOW + 120_000).toISOString(),
      },
    }),
  ) as { confirmation: string };
  return issued.confirmation;
}

// 거절 입력은 이유 칸이 항상 있고(없으면 null) 범위 칸이 없다. 허락 입력은 범위 칸이 항상 있고(기본
// once) 이유 칸이 없다.
export function shaped(
  decision: Decision,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const { closed_reason: reason, scope, ...rest } = input;
  return decision === "reject"
    ? { ...rest, closed_reason: reason ?? null }
    : { ...rest, scope: scope === undefined ? "once" : scope };
}

export function decide(
  harness: LedgerHarness,
  ctx: AuthenticatedContext,
  decision: Decision,
  input: Record<string, unknown>,
  key: string,
  confirmation?: string,
) {
  return harness.command(ctx, {
    command: decision === "grant"
      ? "grant_approval_request"
      : "reject_approval_request",
    input: shaped(decision, input),
    idempotency_key: key,
    compare: { created_seq: input["created_seq"] },
    prepared: [],
    ...(confirmation === undefined ? {} : { confirmation }),
  });
}

export async function statusOf(
  harness: LedgerHarness,
  id: string,
): Promise<string> {
  const rows = value(
    await harness.inspect(
      "select status from approval_requests where id = ?",
      [id],
    ),
  );
  return String(rows[0]?.["status"]);
}
