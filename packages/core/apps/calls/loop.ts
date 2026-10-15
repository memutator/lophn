import type { Id } from "../../../protocol/base/ids.ts";
import { APP_CALL_DEPTH_LIMIT } from "../../../protocol/apps/channel-values.ts";

// chain은 부른 invocation부터 위로 올라간 앱 목록이다. 대상 앱이 이미 있으면 루프,
// 사슬이 한도에 닿았으면 이 호출이 한도를 넘는다.
export function checkCallChain(
  target: Id<"app">,
  chain: readonly Id<"app">[],
): "call_loop" | "call_too_deep" | null {
  if (chain.includes(target)) return "call_loop";
  if (chain.length >= APP_CALL_DEPTH_LIMIT) return "call_too_deep";
  return null;
}
