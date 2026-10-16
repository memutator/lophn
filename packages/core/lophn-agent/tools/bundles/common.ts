import type { z } from "zod";
import {
  fingerprint,
  ok,
  type Result,
  sha256Hex,
} from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import { limitJson } from "../result.ts";
import {
  type BuiltinToolName,
  TOOL_INPUTS,
} from "../../../../protocol/lophn-agent/tool-catalog.ts";
import type { ToolCallHandler, ToolDefinition } from "../registry.ts";
import type { RunCredential } from "../work.ts";

// 내장 묶음이 함께 쓰는 정의·결과 모양. 묶음마다 다른 것은 이름·입력·소유 contract뿐이다.

export type BuiltinSpec = {
  name: BuiltinToolName;
  description: string;
  effect: ToolDefinition["effect"];
  handler: ToolCallHandler;
  // Gate가 걸리는 tool만 준다.
  gate?: ToolDefinition["gate"];
  // 없으면 `TOOL_INPUTS[name]`이다.
  input?: z.ZodType;
};

// 내장 tool 정의다. 입력 schema는 protocol의 `TOOL_INPUTS`가 정본이다.
// 옛 칸(revision, confirm, contract, reversible, idempotent)은 run-loop가 읽어서
// 기본값을 채운다.
export function defineBuiltin(spec: BuiltinSpec): ToolDefinition {
  const read = spec.effect === "read";
  return {
    name: spec.name,
    description: spec.description,
    input: spec.input ?? TOOL_INPUTS[spec.name],
    effect: spec.effect,
    origin: "builtin",
    handler: spec.handler,
    ...(spec.gate === undefined ? {} : { gate: spec.gate }),
    revision: BUILTIN_TOOL_REVISION,
    confirm: false,
    contract: spec.name,
    reversible: read,
    idempotent: read,
  };
}

export const BUILTIN_TOOL_REVISION = "1";

export const READ = {
  effect: "read",
  reversible: true,
  idempotent: true,
} as const;

// handler가 소유 contract를 부르는 통로다. 실제 연결(core client)은 agent runtime 조립이
// 넣는다. `call`은 contract 이름 하나와 그 입력 하나이고 여러 영역의 숨은 절차는 없다.
//
// command는 비교 기준(`compare`, 예: 읽은 revision)과 같은 호출의 재전송을 하나로 묶는
// idempotency key를 더 받을 수 있다. 읽기는 둘 다 쓰지 않는다. 둘 다 없으면 연결이 빈 비교 기준과
// 입력에서 정한 key를 쓴다.
export type CallOptions = {
  compare?: unknown;
  idempotency_key?: string;
};

export type ContractCall = {
  call(
    contract: string,
    input: unknown,
    run: string,
    options?: CallOptions,
  ): Promise<Result<unknown>>;
};

// 같은 호출의 재전송이 새 변경을 만들지 않게 idempotency key는 최초 ToolCall ID다. 모르면 호출
// 내용에서 정한다.
export async function toolIdempotencyKey(
  tool: string,
  input: unknown,
  credential: RunCredential,
): Promise<string> {
  return credential.call ??
    `tool-${(await fingerprint([credential.run, tool, input])).slice(0, 40)}`;
}

const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

// 새 대상의 ID는 key에서 정한다. 같은 key는 같은 ID를 가리키므로 재전송이 두 번째 대상을 만들지
// 않고 이미 있다는 conflict로 끝난다. 모양은 `<prefix>_<26자 Crockford>`이다.
export async function idFromKey(prefix: string, key: string): Promise<string> {
  const hex = await sha256Hex(`lophn:${prefix}:${key}`);
  let value = 0n;
  for (let index = 0; index < 32; index += 2) {
    value = (value << 8n) | BigInt(parseInt(hex.slice(index, index + 2), 16));
  }
  let id = "";
  for (let position = 25; position >= 0; position -= 1) {
    id += ID_ALPHABET[Number((value >> BigInt(position * 5)) & 31n)];
  }
  return `${prefix}_${id}`;
}

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
