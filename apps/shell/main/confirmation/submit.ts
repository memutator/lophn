// 제출은 main이 소유 command에 handle을 붙여 보낸다. renderer 입력의
// confirmation 필드는 받지 않는다. 결과가 불명이면 같은 key의 receipt만 다시 본다.
import type { Route } from "../../../../packages/contracts/platform/mod.ts";

import type { LiveHandle } from "./handle.ts";
import type { SubmitPort, SubmitReceipt } from "./coordinator.ts";

export interface CommandCaller {
  call(
    kind: string,
    resource: string,
    method: string,
    body: unknown,
  ): Promise<
    | { ok: true; value: unknown }
    | { ok: false; error: { code: string; message: string; details?: unknown } }
  >;
}

export interface DecisionRoute {
  readonly decision: string;
  readonly route: Route;
  /** command input을 고정 정본에서 만든다. renderer가 보낸 본문은 쓰지 않는다. */
  input(canonical: unknown, decision: string): Record<string, unknown>;
  compare(canonical: unknown): Record<string, unknown>;
}

const UNKNOWN = new Set(["unavailable"]);

function isReceipt(value: unknown): value is SubmitReceipt {
  if (value === null || typeof value !== "object") return false;
  const receipt = (value as { receipt?: unknown }).receipt;
  if (receipt === null || typeof receipt !== "object") return false;
  const kind = (receipt as { kind?: unknown }).kind;
  return kind === "entity" || kind === "event";
}

/**
 * 같은 idempotency key로 다시 보내도 core가 새 결정을 만들지 않게 한다.
 * key는 handle 참조에서만 만든다. 원문을 log에 남기지 않는다.
 */
export function idempotencyKey(ref: string): string {
  return `confirmation:${ref}`;
}

export function createSubmitter(input: {
  caller: CommandCaller;
  routes: readonly DecisionRoute[];
  /** 정본. submit은 이 값을 command 입력으로 쓴다. */
  canonical(handle: LiveHandle): unknown;
}): SubmitPort {
  const byDecision = new Map(
    input.routes.map((route) => [route.decision, route]),
  );

  const send = async (
    handle: LiveHandle,
    decision: string,
  ): Promise<
    | { ok: true; value: SubmitReceipt }
    | { ok: false; unknown: true }
    | { ok: false; unknown: false; error: { code: string; message: string } }
  > => {
    const route = byDecision.get(decision);
    if (route === undefined || route.route.kind !== "command") {
      return {
        ok: false,
        unknown: false,
        error: { code: "forbidden", message: "허용되지 않은 결정이다" },
      };
    }
    const canonical = input.canonical(handle);
    const body = {
      input: route.input(canonical, decision),
      idempotency_key: idempotencyKey(handle.ref),
      compare: route.compare(canonical),
      prepared: [],
      confirmation: handle.ref,
    };
    let result: Awaited<ReturnType<CommandCaller["call"]>>;
    try {
      result = await input.caller.call(
        "command",
        route.route.resource,
        route.route.method,
        body,
      );
    } catch {
      return { ok: false, unknown: true };
    }
    if (!result.ok) {
      if (UNKNOWN.has(result.error.code)) return { ok: false, unknown: true };
      return { ok: false, unknown: false, error: result.error };
    }
    const value = result.value as { result?: unknown };
    if (!isReceipt(value.result) && !isReceipt(value)) {
      return {
        ok: false,
        unknown: false,
        error: { code: "unavailable", message: "접수 확인을 읽지 못했다" },
      };
    }
    return {
      ok: true,
      value: isReceipt(value) ? value : (value.result as SubmitReceipt),
    };
  };

  return {
    submit: ({ handle, decision }) => send(handle, decision),
    async receipt(handle) {
      const found = await send(handle, handle.allowed[0] ?? "");
      return found.ok ? found.value : undefined;
    },
  };
}
