// 같은 corpus에서 정본 Result와 작성형 throw의 판정이 요구와 같은지 본다.
// invalid corpus의 캐스트는 이 helper 안에만 둔다.

import { assert, assertEquals } from "@std/assert";
import type {
  Blueprint,
  BlueprintOptions,
} from "../../contracts/apps/blueprint.ts";
import { defineBlueprint } from "./define.ts";
import { validateBlueprint } from "./mod.ts";

export function sameVerdict(
  value: unknown,
  expectedOk: boolean,
  options?: BlueprintOptions,
): void {
  const result = validateBlueprint(value, options);
  assertEquals(result.ok, expectedOk);
  const authored = value as Blueprint;
  if (result.ok) {
    assertEquals(defineBlueprint(authored, options), result.value);
    return;
  }
  let thrown = false;
  try {
    defineBlueprint(authored, options);
  } catch (error) {
    thrown = error instanceof TypeError &&
      error.message === result.error.message;
  }
  assert(thrown);
}
