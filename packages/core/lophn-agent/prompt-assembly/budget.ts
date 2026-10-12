import { err, ok, type Result } from "../../../base/mod.ts";
import type { ModelLimits, WirePack } from "./model.ts";

// 입력 예산과 전체 wire 크기다. cache 적중도 창 점유를 줄이지 않으므로 빼지 않는다.

// min(입력 한계, 전체 문맥 − 예약 출력). 예약 출력이 출력 한계를 넘거나 예산이 0 이하면 호출할 수 없다.
export function inputBudget(
  limits: ModelLimits,
  reservedOutput: number,
): Result<number> {
  if (!Number.isSafeInteger(reservedOutput) || reservedOutput <= 0) {
    return err({
      code: "invalid_input",
      message: "예약 출력이 양의 정수가 아니다",
    });
  }
  if (reservedOutput > limits.output_limit) {
    return err({
      code: "invalid_input",
      message: "예약 출력이 출력 한계를 넘는다",
    });
  }
  const budget = Math.min(
    limits.input_limit,
    limits.context_limit - reservedOutput,
  );
  if (budget <= 0) {
    return err({ code: "invalid_input", message: "입력 예산이 없다" });
  }
  return ok(budget);
}

const encoder = new TextEncoder();

// tool 정의·지시·포장·자료·결과를 모두 담은 wire body의 UTF-8 byte에 전송 adapter가 따로 쥔
// opaque 상태 byte를 더한다. chars/4나 bytes/4로 줄이지 않는다(token 수는 byte 수 이하라 보수 상한이다).
export function measureWire(pack: WirePack): number {
  return encoder.encode(JSON.stringify(pack.body)).byteLength +
    pack.opaque_bytes;
}
