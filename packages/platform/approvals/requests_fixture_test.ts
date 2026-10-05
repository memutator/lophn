// requests_test.ts의 ledger harness 준비. 테스트 이름과 단언은 그 파일에 있다.

import { assert } from "@std/assert";
import type { Result } from "../../base/mod.ts";
import { fingerprint, sha256Hex } from "../../base/mod.ts";
import type {
  ApprovalAction,
  ApprovalEffect,
  AuthenticatedContext,
  SqlRow,
} from "../../contracts/platform/mod.ts";
import { approvalBinding } from "../../contracts/platform/mod.ts";

export type CommandEnvelope = {
  command: string;
  input: unknown;
  idempotency_key: string;
  compare: unknown;
  prepared: readonly string[];
  run?: string;
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

export async function effect(
  external: string | undefined,
): Promise<ApprovalEffect> {
  return {
    changes_blob: await sha256Hex("release 하나를 시작한다"),
    external_blob: external === undefined ? null : await sha256Hex(external),
    reversible: false,
    reversibility_blob: await sha256Hex("시작한 뒤에는 되돌리지 못한다"),
  };
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
  } = {},
): Promise<Result<{ result: unknown; replayed: boolean }>> {
  return await harness.command(ctx, {
    command: "create_approval_request",
    input: {
      id: options.id ?? APPROVAL,
      requester: ctx.actor,
      run: options.run ?? null,
      reason_blob: await sha256Hex("배포 전 확인이 필요하다"),
      effect: await effect(options.external),
      action: await action(),
      expires_at: options.expiresAt ?? null,
    },
    idempotency_key: options.key ?? `create-${options.id ?? APPROVAL}`,
    compare: {},
    prepared: [],
    ...(options.run ? { run: options.run } : {}),
  });
}
