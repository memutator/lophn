// 다른 기계의 새 release를 따라갈 때 사람에게 묻는가. 이 규칙은 여기 한 곳에 둔다(사람이 바꿀 수 있다).
// 따라가기는 늘어난 권한이 없으면 묻지 않고 다른 기계의 code를 깔고 사람이 준 권한으로 켠다. 이름 붙인 폴더로 온 것은 지금처럼
// 묻지 않는다. `computers`로만 온 release는 들이되 그 release를 낸 컴퓨터가 이 컴퓨터에서 허락한 컴퓨터(터미널 입력 허락)가 아니면
// 늘 사람의 동의를 기다린다(도둑맞은 노트북이 앱 code로 이 컴퓨터에서 돌지 못하게). 허락은 명단의 값이 아니라 이 컴퓨터의
// 표다: 명단 항목에는 컴퓨터가 스스로 서명할 수 있어 "이 컴퓨터의 사람이 허락했다"를 가르지 못한다.
import type { Id } from "../../../protocol/base/ids.ts";
import { COMPUTERS_DESTINATION } from "../../../protocol/remote/carry.ts";

/** 그 release를 활성 release로 싣는 다른 기계의 앱 기록(출처와 읽은 destination). */
export type ReleaseOffer = { machine: Id<"mch">; destination: string };

export function followAsksPerson(
  offers: readonly ReleaseOffer[],
  granted: (machine: Id<"mch">) => boolean,
): boolean {
  return !offers.some(
    (offer) =>
      offer.destination !== COMPUTERS_DESTINATION || granted(offer.machine),
  );
}
