import { err, ok, type Result } from "../../../base/mod.ts";
import { confirmationRefSchema } from "../../../protocol/base/mod.ts";
import {
  type ConfirmationBridge,
  type RouteConfirmation,
  routeConfirmation,
} from "./confirmation-bridge.ts";
import { confirmationBinding } from "./confirmation-binding.ts";

// file·worker route는 ledger transaction이 없다. core의 registry가 대상·내용과 맞는지
// 확인하고 메모리에서 원자적으로 소비한 뒤에만 worker로 넘긴다.
// 넘긴 뒤 worker가 conflict를 내도 handle은 소비된 채다. 사람이 다시 확인한다.
export async function consumeRouteConfirmation(
  bridge: ConfirmationBridge | RouteConfirmation,
  route: {
    confirmation?: "required";
    binding?: readonly string[];
    name: string;
  },
  input: unknown,
  confirmation: string | undefined,
): Promise<Result<void>> {
  if (route.confirmation !== "required") return ok(undefined);
  const ref = confirmationRefSchema.safeParse(confirmation);
  const binding = await confirmationBinding(route, input);
  if (!ref.success || binding === undefined) {
    return err({ code: "forbidden", message: "사람 결정 확인이 없다" });
  }
  const use = { ref: ref.data, decision: route.name, binding };
  return await ("useOnce" in bridge
    ? bridge
    : routeConfirmation(bridge)
  ).useOnce(use);
}
