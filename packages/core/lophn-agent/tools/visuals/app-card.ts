import { err, ok, type Result } from "../../../../base/mod.ts";
import type { AppCardReference } from "../../../../protocol/lophn-agent/mod.ts";

// 앱 카드 참조의 owner 검사. 카드는 apps/blueprint에서
// 카드 크기를 지원한 화면만 참조한다. 임의 화면·card 크기를 선언하지 않은 화면은
// 참조가 아니라 같은 거절이다. 열린 카드·탭·문서 링크가 앱 command 실행 권한을
// 늘리지 않는다는 것은 여기서 확인하지 않는다: view에는 command 통로가 없다
// (shell/app-frame, shell/workspace가 지킨다).

export type CardScreen = {
  key: string;
  sizes: readonly string[];
};

// 참조를 검사할 때 읽은 blueprint의 사실이다. 읽지 않은 호출자는 screens를 생략하고
// 그러면 카드 참조는 열리지 않는다(존재를 새지 않는 같은 거절).
export type CardView = {
  screens?: readonly CardScreen[];
};

export type CardSupportError =
  | { code: "card_screen_absent" }
  | { code: "card_size_absent"; screen: string };

// 참조의 view가 그 blueprint의 화면이고 그 화면이 card 크기를 선언했는지 본다.
// 화면이 없으면 card_screen_absent, 화면은 있지만 card 크기가 없으면
// card_size_absent다. 어느 쪽이든 visual.show의 같은 거절이며 받은 값은 싣지 않는다.
export function checkCardScreen(
  view: CardView,
  reference: Pick<AppCardReference, "view">,
): Result<void, CardSupportError> {
  const screen = view.screens?.find((entry) => entry.key === reference.view);
  if (screen === undefined) {
    return err({ code: "card_screen_absent" });
  }
  if (!screen.sizes.includes("card")) {
    return err({ code: "card_size_absent", screen: reference.view });
  }
  return ok(undefined);
}
