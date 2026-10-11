// saved view command가 같이 쓰는 규칙이다: 저장하는 호출이 적용된 판에 맞는지, 이름이 판 안에서
// 겹치는지. 입력의 모양은 검색 실행기와 같은 resolveInputs로 본다. 열 때 통과하지 못할 호출을
// 저장하지 않으려는 것이다.
import {
  err,
  type ErrorCode,
  type LophnError,
  ok,
  type Result,
} from "../../../base/mod.ts";
import { bundleContentSchema } from "../../../contracts/documents/mod.ts";
import { resolveInputs } from "../search/inputs.ts";
import type { ContextApiState } from "./state.ts";

export function fail(
  code: ErrorCode,
  message: string,
): Result<never, LophnError> {
  return err({ code, message });
}

// context에 적용된 판이 검색을 선언하고 입력이 그 선언에 맞아야 한다. 판이 없으면 호출할 곳이 없다.
export function checkAppliedCall(
  state: ContextApiState,
  context: string,
  search: string,
  inputs: Record<string, unknown>,
): Result<void> {
  const applied = state.contexts.get(context)?.applied_bundle;
  const bundle = applied == null ? undefined : state.bundles.get(applied);
  if (bundle === undefined) {
    return fail("invalid_input", `context ${context} has no applied bundle`);
  }
  // 판은 submit 때 검사를 받았지만 읽는 쪽에서 모양을 다시 확인한다.
  const parsed = bundleContentSchema.safeParse(bundle.content);
  if (!parsed.success) {
    return fail("internal", "stored bundle content is invalid");
  }
  const declared = parsed.data.searches.find((candidate) =>
    candidate.name === search
  );
  if (declared === undefined) {
    return fail(
      "invalid_input",
      `search ${search} is not declared in the applied bundle`,
    );
  }
  const resolved = resolveInputs(declared, inputs);
  if (!resolved.ok) {
    const input = resolved.error.input ?? "";
    return fail(
      "invalid_input",
      `input ${input} does not fit search ${search} (${resolved.error.code})`,
    );
  }
  return ok(undefined);
}

// 이름은 다듬은 글로 비교한다. 판의 saved_views 이름 규칙과 같다. except는 고치는 자기 자신이다.
export function savedViewNameTaken(
  state: ContextApiState,
  context: string,
  name: string,
  except?: string,
): boolean {
  const wanted = name.trim();
  for (const view of state.views.values()) {
    if (
      view.context === context && view.id !== except &&
      view.name.trim() === wanted
    ) {
      return true;
    }
  }
  return false;
}
