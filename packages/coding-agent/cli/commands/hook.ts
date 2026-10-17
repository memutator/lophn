// `lophn hook <harness> <event>`: harness hook이 부르는 명령이다. stdin JSON을 coding token으로 core에 넘긴다.
// 전역 hook이라 lophn과 상관없는 harness 실행에서도 불린다. token이 없으면 stdin도 읽지 않고 아무것도
// 보내지 않은 채 성공한다. stdout에는 아무것도 쓰지 않는다(harness가 model context로 읽을 수 있다).
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import {
  codingHook,
  HOOK_PAYLOAD_MAX_BYTES,
} from "../../../protocol/coding-agent/mod.ts";
import { callRoute } from "../../connection/mod.ts";
import { type CommandEntry, entryOf, type RunContext } from "./types.ts";

function invalid(message: string): LophnError {
  return { code: "invalid_input", message };
}

async function runHook(
  input: Record<string, unknown>,
  ctx: RunContext,
): Promise<Result<unknown, LophnError>> {
  if (ctx.client === undefined) return ok(undefined);
  const text = await ctx.stdin();
  if (new TextEncoder().encode(text).length > HOOK_PAYLOAD_MAX_BYTES) {
    return err(invalid("hook payload가 너무 크다"));
  }
  let payload: unknown = {};
  if (text.trim() !== "") {
    try {
      payload = JSON.parse(text);
    } catch {
      return err(invalid("hook payload가 JSON이 아니다"));
    }
  }
  const sent = await callRoute(ctx.client, {
    route: codingHook,
    input: { harness: input.harness, event: input.event, payload },
  });
  return sent.ok ? ok(undefined) : sent;
}

export const HOOK_COMMANDS: readonly CommandEntry[] = [
  entryOf("hook", "harness hook 내용을 core에 넘긴다(stdin JSON)", {
    positional: ["harness", "event"],
    run: runHook,
  }),
];
