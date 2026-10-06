/**
 * approval 허락·거절·적용·계보 시험이 같이 쓰는 준비. 실제 core의 HTTP route만 쓴다.
 * 제품 main.ts에는 없다. 사람 데이터 root는 열지 않고 core는 temp 홈에서 뜬다.
 */
import { DatabaseSync } from "node:sqlite";
import { fingerprint } from "../../../packages/base/mod.ts";
import {
  type ApprovalAction,
  approvalBinding,
  type ApprovalRequest,
  grantApprovalRequest,
  type JsonObject,
  rejectApprovalRequest,
} from "../../../packages/contracts/platform/mod.ts";
import { confirmationBinding } from "../../../packages/platform/identity/mod.ts";

export type Reply = { status: number; body: Record<string, unknown> };

export type Server = {
  port: number;
  dataRoot: string;
  clock: { nowMs(): number };
  confirmation(body: {
    action: "issue" | "close-window" | "clear";
    request?: unknown;
    windowId?: string;
  }): Promise<
    { ok: true; value: unknown } | { ok: false; error: { message: string } }
  >;
};

export async function call(
  server: Pick<Server, "port">,
  path: string,
  token: string,
  body: unknown,
): Promise<Reply> {
  const response = await fetch(
    `http://127.0.0.1:${server.port}/v1/${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  );
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

export function command(
  input: unknown,
  extra: { compare?: unknown; confirmation?: string } = {},
) {
  return {
    input,
    idempotency_key: `k-${crypto.randomUUID()}`,
    compare: extra.compare ?? {},
    prepared: [],
    ...(extra.confirmation === undefined
      ? {}
      : { confirmation: extra.confirmation }),
  };
}

export function codeOf(reply: Reply): unknown {
  return (reply.body["error"] as { code?: unknown } | undefined)?.code;
}

// 시험 전용 SQLite 읽기. core가 쓰는 temp 홈의 ledger를 읽기 전용으로 연다.
export function inspect(
  server: Pick<Server, "dataRoot">,
  query: string,
  params: (string | number)[] = [],
): Record<string, unknown>[] {
  const ledger = new DatabaseSync(`${server.dataRoot}/lophn.db`, {
    readOnly: true,
  });
  try {
    return ledger.prepare(query).all(...params) as Record<string, unknown>[];
  } finally {
    ledger.close();
  }
}

export function count(
  server: Pick<Server, "dataRoot">,
  query: string,
  params: (string | number)[] = [],
): number {
  return Number(inspect(server, query, params)[0]?.["n"]);
}

export type ActionDraft = {
  concern?: string;
  command: string;
  caller: ApprovalAction["caller"];
  targets: string[];
  value: JsonObject;
  comparison?: JsonObject;
  // 시험만 쓴다. 입력 지문을 입력과 다르게 고정한다.
  inputHash?: string;
};

// 정확한 binding hash를 가진 action. 입력 지문은 정규 JSON의 sha256이다.
export async function actionOf(draft: ActionDraft): Promise<ApprovalAction> {
  const base = {
    concern: draft.concern ?? "test-owner/notes",
    command: draft.command,
    caller: draft.caller,
    targets: draft.targets,
    input: { kind: "inline" as const, value: draft.value },
    input_hash: draft.inputHash ?? await fingerprint(draft.value),
    comparison: draft.comparison ?? {},
  };
  return {
    ...base,
    binding_hash: await fingerprint(
      approvalBinding({ ...base, binding_hash: "ab".repeat(32) }),
    ),
  };
}

export function createInput(
  id: string,
  requester: string,
  action: ApprovalAction,
  options: {
    run?: string | null;
    expiresAt?: string | null;
    reason?: string;
    changes?: string;
    external?: string | null;
    reversibility?: string;
  } = {},
) {
  // 설명 글은 값으로 싣는다. core가 redaction을 거쳐 blob으로 준비한다.
  return {
    id,
    requester,
    run: options.run ?? null,
    reason: options.reason ?? "사람이 보고 정해야 한다",
    effect: {
      changes: options.changes ?? "노트 하나를 남긴다",
      external: options.external ?? null,
      reversible: false,
      reversibility: options.reversibility ?? "남긴 뒤에는 되돌리지 못한다",
    },
    action,
    expires_at: options.expiresAt ?? null,
  };
}

// 사람이 confirmation window에서 본 내용으로 handle을 발급한다.
async function issue(
  server: Server,
  route: typeof grantApprovalRequest | typeof rejectApprovalRequest,
  input: Record<string, unknown>,
): Promise<string> {
  const binding = await confirmationBinding(route, input);
  if (!binding) throw new Error("confirmation binding이 없다");
  const issued = await server.confirmation({
    action: "issue",
    request: {
      type: "confirmation_handle_register",
      window_id: `win-${route.name}`,
      target_ref: binding.target,
      content_hash: binding.content,
      allowed_decisions: [route.name],
      expires_at: new Date(server.clock.nowMs() + 120_000).toISOString(),
    },
  });
  if (!issued.ok) throw new Error(issued.error.message);
  return (issued.value as { confirmation: string }).confirmation;
}

// 사람이 허락(grant)하거나 거절(reject)한다. 본 내용은 request에서 그대로 가져온다.
export async function decide(
  server: Server,
  token: string,
  request: ApprovalRequest,
  decision: "grant" | "reject",
): Promise<Reply> {
  const base = {
    approval: request.id,
    created_seq: request.created_seq,
    binding_hash: request.action.binding_hash,
  };
  const input = decision === "grant"
    ? base
    : { ...base, closed_reason_blob: null };
  const route = decision === "grant"
    ? grantApprovalRequest
    : rejectApprovalRequest;
  return await call(
    server,
    `approvals/${decision}`,
    token,
    command(input, {
      compare: { created_seq: request.created_seq },
      confirmation: await issue(server, route, input),
    }),
  );
}
