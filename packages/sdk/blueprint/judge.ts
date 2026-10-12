// 같은 corpus에서 정본 Result와 작성형 throw의 판정이 요구와 같은지 본다.
// invalid corpus의 캐스트는 이 helper 안에만 둔다.
// 정본 ValidationError에는 path가 없고 code는 invalid_input 하나다.

import { assert, assertEquals } from "@std/assert";
import type {
  Blueprint,
  BlueprintOptions,
  ValidationError,
} from "../../protocol/apps/blueprint.ts";
import { defineBlueprint } from "./define.ts";
import { validateBlueprint } from "./mod.ts";

export function sameVerdict(
  value: unknown,
  expectedOk: boolean,
  options?: BlueprintOptions,
  expected?: { message?: string },
): void {
  const result = validateBlueprint(value, options);
  assertEquals(result.ok, expectedOk);
  const authored = value as Blueprint;
  if (result.ok) {
    assertEquals(defineBlueprint(authored, options), result.value);
    return;
  }
  const error: ValidationError = result.error;
  assertEquals(error.code, "invalid_input");
  if (expected?.message !== undefined) {
    assertEquals(error.message, expected.message);
  }
  let thrown = false;
  try {
    defineBlueprint(authored, options);
  } catch (caught) {
    thrown = caught instanceof TypeError &&
      caught.message === error.message;
  }
  assert(thrown);
}
