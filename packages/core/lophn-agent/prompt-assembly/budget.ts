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

// token 하나로 치는 UTF-8 byte 수다. 영어·code는 약 3.5~4, 한국어는 약 3~4.5 byte가 token 하나라
// 3이면 대개 실제보다 크게 센다. byte를 그대로 token으로 세면 영어 turn이 창의 4분의 1쯤에서 막혔다.
export const BYTES_PER_TOKEN = 3;

export function textTokens(text: string): number {
  return Math.ceil(encoder.encode(text).byteLength / BYTES_PER_TOKEN);
}

// wire body에서 이미지 base64를 뺀 UTF-8 byte(전송 adapter가 따로 쥔 opaque 상태 byte 포함)와 실은 이미지 수다.
// body에 base64가 없으면(이미지를 못 받는 model) 이미지로 세지 않는다.
export type WireSize = { bytes: number; images: number };

export function wireSize(pack: WirePack, request: PromptRequest): WireSize {
  const json = JSON.stringify(pack.body);
  let bytes = encoder.encode(json).byteLength + pack.opaque_bytes;
  let images = 0;
  for (const message of request.messages) {
    for (const part of message.parts) {
      if (
        (part.kind === "tool_result_image" || part.kind === "image") &&
        json.includes(part.data_base64)
      ) {
        bytes -= part.data_base64.length;
        images += 1;
      }
    }
  }
  return { bytes: Math.max(0, bytes), images };
}

// 같은 turn의 앞 call이 provider에게서 받은 실제 prompt token(`input + cache_read + cache_write`)과
// 그 call을 잴 때의 크기다.
export type PromptAnchor = { tokens: number } & WireSize;

// 크기만으로 센 token. 이미지는 base64 byte가 아니라 하나에 고정 token이다.
export function estimateTokens(size: WireSize): number {
  return Math.ceil(size.bytes / BYTES_PER_TOKEN) + size.images * IMAGE_TOKENS;
}

// 이 요청의 입력 token 추정이다. 같은 turn 앞 call의 실제 token이 있으면 그 값에 늘어난 byte를 token으로
// 더한다(늘어난 부분만 보수적으로 센다). 줄어든 byte는 3 byte를 한 token으로 뺀다. 없으면 크기로만 센다.
export function measureWire(
  pack: WirePack,
  request: PromptRequest,
  anchor?: PromptAnchor | null,
): number {
  return measureSize(wireSize(pack, request), anchor);
}

export function measureSize(
  size: WireSize,
  anchor?: PromptAnchor | null,
): number {
  if (anchor === null || anchor === undefined) return estimateTokens(size);
  const grown = size.bytes - anchor.bytes;
  const text = grown >= 0 ? grown : -Math.floor(-grown / BYTES_PER_TOKEN);
  return Math.max(
    0,
    anchor.tokens + text + (size.images - anchor.images) * IMAGE_TOKENS,
  );
}
