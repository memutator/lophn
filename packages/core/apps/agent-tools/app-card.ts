import { err, ok, type Result } from "../../../base/mod.ts";
import { validateInput } from "../../../protocol/apps/declaration/schema.ts";
import type { InputSchema } from "../../../protocol/apps/declaration/types.ts";

type CardScreen = {
  key: string;
  places: readonly string[];
  params?: unknown;
};

// 앱 카드는 선언의 화면 가운데 card place를 선언한 것만 보인다.
// 없는 화면과 card place가 없는 화면은 같은 거절이라 받은 값을 알려 주지 않는다.
export function cardViewDeclared(
  screens: readonly { key: string; places: readonly string[] }[],
  view: string,
): boolean {
  return screens.some(
    (screen) => screen.key === view && screen.places.includes("card"),
  );
}

// 카드 인자는 그 화면 선언의 params schema로 검사한다. 선언이 없는 화면은 인자를 받지 않는다.
export function cardParams(
  screens: readonly CardScreen[],
  view: string,
  params: Record<string, unknown> | undefined,
): Result<Record<string, unknown> | undefined> {
  if (params === undefined) return ok(undefined);
  const screen = screens.find((item) => item.key === view);
  const checked = validateInput(
    (screen?.params ?? null) as InputSchema | null,
    params,
  );
  if (!checked.ok) {
    return err({ code: "invalid_input", message: checked.error.message });
  }
  return ok((checked.value ?? {}) as Record<string, unknown>);
}
