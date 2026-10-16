import { z } from "zod";
import { canonicalize } from "../../base/mod.ts";

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

function validJson(value: unknown): value is JsonValue {
  try {
    canonicalize(value);
    return true;
  } catch {
    return false;
  }
}

// record/json parser는 own __proto__를 지운다. 검증만 하여 고정 입력과
// canonical byte·hash의 근거가 파싱 과정에서 바뀌지 않게 한다.
export const jsonValueSchema = z.custom<JsonValue>(validJson, {
  message: "expected canonical JSON value",
});
export const jsonObjectSchema = z.custom<JsonObject>(
  (value) =>
    value !== null && typeof value === "object" &&
    !Array.isArray(value) && validJson(value),
  { message: "expected canonical JSON object" },
);
