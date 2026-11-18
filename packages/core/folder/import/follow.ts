// 다른 기계의 새 release를 따라갈 때 사람에게 묻는가. 이 규칙은 여기 한 곳에 둔다(사람이 바꿀 수 있다).
// 따라가기는 늘어난 권한이 없으면 묻지 않고 다른 기계의 code를 깔고 켠다. `computers`로 온 release는 그 기계가 서명한
// 것이지만 연결과 폰으로도 온다. 명단에서 이 컴퓨터의 터미널을 쓸 수 있는 컴퓨터(`terminal_input`)는 이미 여기서 무엇이든
// 할 수 있으니 묻지 않는다. 그 밖의 컴퓨터가 낸 release는 들이되 사람의 동의를 기다린다(도둑맞은 노트북이 앱 code로 이
// 컴퓨터에서 도는 것을 막는다). 이름 붙인 폴더로 온 것은 지금처럼 묻지 않는다.
import type { Id } from "../../../protocol/base/ids.ts";
import { COMPUTERS_DESTINATION } from "../../../protocol/folder/carry.ts";

/** 그 release를 활성 release로 싣는 다른 기계의 앱 기록(출처와 읽은 destination). */
export type ReleaseOffer = { machine: Id<"mch">; destination: string };

export function followAsksPerson(
  offers: readonly ReleaseOffer[],
  terminalInput: (machine: Id<"mch">) => boolean,
): boolean {
  return !offers.some(
    (offer) =>
      offer.destination !== COMPUTERS_DESTINATION ||
      terminalInput(offer.machine),
  );
}
