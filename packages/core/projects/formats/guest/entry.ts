// QuickJS guest 진입점. host는 이 함수의 인자 JSON만 넘기고 반환 JSON만 받는다.
// model.ts(선언, canonicalize, contracts)는 host라 여기 넣지 않는다.
import { extractFormat, validateFormat } from "../guest.ts";
import type { FormatKind } from "../guest.ts";
import type { FormatModuleInput } from "../pure/input.ts";

export type GuestRequest = {
  operation: "validate" | "extract";
  name: FormatKind;
  input: FormatModuleInput;
};

export function dispatch(request: GuestRequest): unknown {
  if (request.operation === "validate") {
    return validateFormat(request.name, request.input);
  }
  return extractFormat(request.name, request.input);
}
