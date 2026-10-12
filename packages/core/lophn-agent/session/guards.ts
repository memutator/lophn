import { err, ok, type Result } from "../../../base/mod.ts";
import {
  parseActor,
  type RequestContext,
} from "../../../protocol/platform/mod.ts";
import type { SessionRow } from "./model.ts";

// command와 read가 같이 쓰는 거절과 보이는 범위 판정.

type Code =
  | "invalid_input"
  | "conflict"
  | "not_found"
  | "forbidden"
  | "unavailable";

export function reject(code: Code, message: string): Result<never> {
  return err({ code, message });
}

export function sessionNotFound(): Result<never> {
  return reject("not_found", "session not found");
}

export function requireUser(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "user" ? ok(undefined) : reject(
    "forbidden",
    "only a person does this",
  );
}

// Compact의 요약을 끝내는 일은 runtime(machine)이 한다. 요청만 사람이 한다.
export function requireMachine(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "machine" ? ok(undefined) : reject(
    "forbidden",
    "only the runtime does this",
  );
}

// null은 제한 없음, 문자열은 그 assignment만, undefined는 아무것도 보지 못함. user·machine은
// 모든 세션을 보고 agent는 자기 assignment의 세션만 본다. 그 밖(coding_agent, app)은 없는
// 세션과 똑같이 답한다.
export function visibleAssignment(
  ctx: RequestContext,
): string | null | undefined {
  const actor = parseActor(ctx.actor);
  if (actor === undefined) return undefined;
  if (actor.kind === "user" || actor.kind === "machine") return null;
  if (actor.kind === "agent") return actor.id;
  return undefined;
}

export function sessionVisible(
  ctx: RequestContext,
  session: SessionRow,
): boolean {
  const scope = visibleAssignment(ctx);
  return scope === null || scope === session.assignment;
}
