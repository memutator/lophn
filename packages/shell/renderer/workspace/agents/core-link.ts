// Agents 통로가 core를 부르는 길. 응답은 main의 contract client가 route output schema로 이미 검사했으므로 화면이 읽는 field만
// 골라 쓴다. 실패는 core의 오류 code(`not_found`, `conflict`, `unavailable`…)로 돌려준다.
import type { z } from "zod";

import type { CommandRoute } from "../../../../protocol/base/route.ts";
import { type CommandBody, commandBody } from "../../command-call.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import type { AgentDefinitionIssue } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import type { ReadResult } from "../source.ts";

type Reply<V> =
  | { readonly ok: true; readonly value: V }
  | { readonly ok: false; readonly code: string; readonly error: unknown };

export interface Link {
  /** 읽기 route 하나. 실패하면 오류 code가 message다. */
  read<V>(
    resource: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<ReadResult<V>>;
  /** memory route 하나(settings/list). */
  memory<V>(
    resource: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<ReadResult<V>>;
  /** worker가 조립하는 읽기 하나(문서 본문). */
  worker<V>(
    resource: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<ReadResult<V>>;
  /** 쓰기 route 하나. compare는 읽을 때의 hash 같은 비교 기준이다. */
  command<R extends CommandRoute>(
    route: R,
    body: { input: unknown; compare: Record<string, unknown> },
  ): Promise<Reply<z.output<R["output"]>>>;
}

export function createLink(core: CoreSource, random: () => string): Link {
  const call = async (
    kind: "read" | "command" | "worker" | "memory",
    resource: string,
    method: string,
    body: unknown,
  ): Promise<Reply<unknown>> => {
    try {
      const reply = await core.call({ kind, resource, method, body });
      return reply.ok ? { ok: true, value: reply.value } : {
        ok: false,
        code: reply.error?.code ?? "internal",
        error: reply.error,
      };
    } catch {
      return { ok: false, code: "unavailable", error: undefined };
    }
  };
  const fetchValue = (kind: "read" | "worker" | "memory") =>
  async <V>(
    resource: string,
    method: string,
    body: Record<string, unknown>,
  ) => {
    const reply = await call(kind, resource, method, body);
    return reply.ok
      ? { ok: true as const, value: reply.value as V }
      : { ok: false as const, message: reply.code };
  };
  return {
    read: fetchValue("read"),
    memory: fetchValue("memory"),
    worker: fetchValue("worker"),
    command: (route, body) =>
      call(
        "command",
        route.resource,
        route.method,
        // 이 통로의 입력은 정의 draft처럼 route 입력보다 느슨한 모양이라 입력과 compare는 type을 좁히지 않는다.
        commandBody(route, {
          ...body,
          key: `${route.resource}-${route.method}-${random()}`,
        } as CommandBody<CommandRoute>),
      ) as Promise<Reply<never>>,
  };
}

/** 오류의 details가 항목별 이유 목록이면 그대로, 아니면 빈 목록이다(이유를 꾸며 내지 않는다). */
export function issuesOf(error: unknown): AgentDefinitionIssue[] {
  const details = (error as { details?: { issues?: unknown } } | undefined)
    ?.details;
  const issues = details?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue) =>
    typeof issue?.field === "string" && typeof issue?.code === "string"
      ? [{ field: issue.field, code: issue.code } as AgentDefinitionIssue]
      : []
  );
}

export const unavailable: ReadResult<never> = {
  ok: false,
  message: "unavailable",
};
