import { err, ok, type Result } from "../../../base/mod.ts";
import type { ModelLimits, PromptRequest, WirePack } from "./model.ts";

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

// 이미지 하나를 token으로 센 값이다. provider별 공식(약 1.1k~1.9k token)을 쓰지 않는 보수 값이다.
export const IMAGE_TOKENS = 4096;

// tool 정의·지시·포장·자료·결과를 모두 담은 wire body의 UTF-8 byte에 전송 adapter가 따로 쥔
// opaque 상태 byte를 더한다. chars/4나 bytes/4로 줄이지 않는다(token 수는 byte 수 이하라 보수 상한이다).
// 이미지는 base64 byte가 아니라 고정 token으로 센다. byte=token 가정이 이미지에는 맞지 않아
// screenshot 하나가 입력 한계를 넘는다. body에 base64가 없으면(이미지를 못 받는 model) 더하지 않는다.
export function measureWire(pack: WirePack, request: PromptRequest): number {
  const json = JSON.stringify(pack.body);
  let total = encoder.encode(json).byteLength + pack.opaque_bytes;
  for (const message of request.messages) {
    for (const part of message.parts) {
      if (
        part.kind === "tool_result_image" &&
        json.includes(part.data_base64)
      ) {
        total += IMAGE_TOKENS - part.data_base64.length;
      }
    }
  }
  return total;
}
