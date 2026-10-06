/**
 * 사람 확인이 필요한 command(`confirmation: "required"`)를 실제 core에서 시험할 때 쓰는
 * handle 발급 준비. 사람이 confirmation window에서 본 내용으로 handle을 내는 것과 같다.
 * 제품 main.ts에는 없다. 사람 데이터 root는 열지 않는다.
 */
import { confirmationBinding } from "../../../packages/platform/identity/mod.ts";
import type { Server } from "./approvals-fixture.ts";

export async function confirmationFor(
  server: Server,
  route: {
    name: string;
    binding?: readonly string[];
  },
  input: Record<string, unknown>,
): Promise<string> {
  const binding = await confirmationBinding(route, input);
  if (!binding) throw new Error("confirmation binding이 없다");
  const issued = await server.confirmation({
    action: "issue",
    request: {
      type: "confirmation_handle_register",
      window_id: `win-${route.name}-${crypto.randomUUID()}`,
      target_ref: binding.target,
      content_hash: binding.content,
      allowed_decisions: [route.name],
      expires_at: new Date(server.clock.nowMs() + 120_000).toISOString(),
    },
  });
  if (!issued.ok) throw new Error(issued.error.message);
  return (issued.value as { confirmation: string }).confirmation;
}
