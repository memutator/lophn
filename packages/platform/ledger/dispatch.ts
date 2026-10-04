import { err, ok, type Result } from "../../base/mod.ts";
import type {
  AuthenticatedContext,
  CommandDefinition,
  CommandRoute,
  Tx,
} from "../../contracts/platform/mod.ts";
<<<<<<< HEAD
import { authorizeConditions } from "../identity/mod.ts";
=======
import { authorize } from "../identity/mod.ts";
>>>>>>> origin/main
import { countCas, withinCommandLimits } from "./fingerprint.ts";
import {
  actorKind,
  authorityTarget,
  casAgrees,
  handlerResult,
} from "./command-outcome.ts";

// 바깥 command 하나가 transaction을 연다. 안쪽 call은 새 transaction·commit을 만들지 않는다(R3).
export const CALL_MAX_DEPTH = 4;

export type CommandDispatch = {
  // 안쪽 command는 바깥과 같은 Tx를 받는다. route 객체에는 SQL이 없다.
  call(
    tx: Tx,
    route: CommandRoute,
    input: unknown,
    compare: unknown,
  ): Result<unknown>;
};

// 불린 command는 바깥과 같은 원래 자격으로 actor 상한·schema·CAS를 다시 검사한다.
// 등록 밖 이름, 이번 호출 경로에 이미 있는 command, 깊이 4 초과는 handler 전에 거절한다.
export function createCommandDispatch(
  commands: ReadonlyMap<string, CommandDefinition>,
  ctx: AuthenticatedContext,
  run: string | null,
  request: AuthenticatedContext,
  checkCursor: (subscriber: string) => Result<void>,
  outer?: string,
): CommandDispatch {
  // 바깥 이름은 순환 검사용이다. 깊이 4는 안쪽 call만 센다.
  const stack: string[] = [];
  const call: CommandDispatch["call"] = (tx, route, input, compare) => {
    if (stack.length >= CALL_MAX_DEPTH) {
      return err({
        code: "invalid_input",
        message: "command 호출 깊이가 한도를 넘는다",
      });
    }
    const definition = lookup(commands, route);
    if (!definition.ok) return definition;
    const name = definition.value.route.name;
    // 바깥 command도 경로다. 안쪽이 그 이름을 다시 부르면 순환이다.
    if (name === outer || stack.includes(name)) {
      return err({
        code: "invalid_input",
        message: "command가 자기 자신을 다시 부른다",
      });
    }
    const checked = admit(definition.value, ctx, run, input, compare);
    if (!checked.ok) return checked;
    const compared = casAgrees(
      tx.sql,
      checked.value.compare,
      checked.value.input,
      checkCursor,
    );
    if (!compared.ok) return compared;
    stack.push(name);
    let raw: unknown;
    let thrown: unknown;
    try {
      raw = definition.value.handle(
        tx,
        request,
        checked.value.input,
        checked.value.compare,
      );
    } catch (error) {
      thrown = error;
    } finally {
      stack.pop();
    }
    if (thrown !== undefined) throw thrown;
    return handlerResult(definition.value, raw);
  };
  return { call };
}

function lookup(
  commands: ReadonlyMap<string, CommandDefinition>,
  route: CommandRoute,
): Result<CommandDefinition> {
  const definition = commands.get(route.name);
  if (
    definition === undefined || definition.route.kind !== "command" ||
    definition.dispatchable !== true || definition.route !== route
  ) {
    return err({
      code: "invalid_input",
      message: "등록되지 않은 command다",
    });
  }
  return ok(definition);
}

function admit(
  definition: CommandDefinition,
  ctx: AuthenticatedContext,
  run: string | null,
  input: unknown,
  compare: unknown,
): Result<{ input: unknown; compare: unknown }> {
  const kind = actorKind(ctx.actor);
  if (kind === undefined || !definition.route.actors.includes(kind)) {
    return err({ code: "forbidden", message: "actor 종류가 command 밖이다" });
  }
<<<<<<< HEAD
  const allowed = authorizeConditions(
=======
  const allowed = authorize(
>>>>>>> origin/main
    ctx,
    definition.route.name,
    authorityTarget(ctx, run ?? undefined),
  );
  if (!allowed.ok) return allowed;
  const parsedInput = definition.route.input.safeParse(input);
  if (!parsedInput.success) {
    return err({ code: "invalid_input", message: "input이 schema와 다르다" });
  }
  const compareSchema = definition.route.compare;
  const parsedCompare = compareSchema === undefined
    ? { success: true as const, data: compare }
    : compareSchema.safeParse(compare);
  if (!parsedCompare.success) {
    return err({ code: "invalid_input", message: "compare가 schema와 다르다" });
  }
  const limits = withinCommandLimits(countCas(parsedCompare.data));
  if (!limits.ok) return limits;
  return ok({ input: parsedInput.data, compare: parsedCompare.data });
}
