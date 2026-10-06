import type { z } from "zod";
import { ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../contracts/lophn-agent/mod.ts";
import { limitJson } from "../result.ts";
import type { ToolDefinition } from "../registry.ts";

// 내장 묶음이 함께 쓰는 정의·결과 모양. 묶음마다 다른 것은 이름·입력·소유 contract뿐이다.

export const COMMON_ERRORS = [
  "invalid_input",
  "not_found",
  "forbidden",
  "conflict",
  "unavailable",
] as const;

export type DefineOptions = {
  effect: ToolDefinition["effect"];
  scopeCheck: string;
  reversible: boolean;
  idempotent: boolean;
};

export function defineBuiltin(
  revision: string,
  name: string,
  description: string,
  input: z.ZodType,
  contract: string,
  options: DefineOptions,
): ToolDefinition {
  return {
    name,
    description,
    revision,
    input,
    effect: options.effect,
    confirm: false,
    contract,
    scopeCheck: options.scopeCheck,
    reversible: options.reversible,
    idempotent: options.idempotent,
    errors: COMMON_ERRORS,
    origin: "builtin",
  };
}

export const READ = {
  effect: "read",
  reversible: true,
  idempotent: true,
} as const;

// handler가 소유 contract를 부르는 통로다. 실제 연결(core client)은 agent runtime 조립이
// 넣는다. `call`은 contract 이름 하나와 그 입력 하나이고 여러 영역의 숨은 절차는 없다.
export type ContractCall = {
  call(
    contract: string,
    input: unknown,
    run: string,
  ): Promise<Result<unknown>>;
};

export function success(summary: string, value: unknown): ToolResult {
  const limited = limitJson(value);
  return {
    status: "success",
    summary,
    content: limited.content as ToolResult["content"],
    complete: limited.complete,
    source: null,
    continuation: null,
    pending: [],
  };
}

export function listResult(
  summary: string,
  value: { next_cursor?: string | null },
): ToolResult {
  const result = success(summary, value);
  const next = value.next_cursor ?? null;
  return next === null
    ? result
    : { ...result, continuation: { has_more: true, read_next: next } };
}

export async function passThrough(
  ports: ContractCall,
  contract: string,
  summary: string,
  input: unknown,
  run: string,
): Promise<Result<ToolResult>> {
  const read = await ports.call(contract, input, run);
  if (!read.ok) return read;
  return ok(listResult(summary, read.value as { next_cursor?: string | null }));
}
