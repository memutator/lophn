import { nextFromSeq } from "../../base/mod.ts";

// 느린 구독은 끊고 재연결한다. 자격 회수·종료는 이후 전달하지 않는다.

// from_seq는 포함한다. 빈 배열은 제한하지 않는다.
// 이름 있는 구독은 명시 from이 없으면 저장 ack 다음부터 시작한다.
// schema는 그 시작 seq를 정하지 않는다. "저장 ack + 1"과 "저장 없으면 0"의 해석은
// platform runtime의 몫이고, 여기서는 '0'을 주입하지 않는다. 현재 principal·이름으로
// 저장된 위치와 그 재연결을 잇는 일도 runtime이 한다.

// 이름 있는 구독의 derived 전송 위치. ledger 반응 cursor와 다르다.

// 원문·stack·token 없는 안전한 거절.

// 문자열 frame을 frame 값으로 읽는다. JSON이 아니거나 schema 밖이면 invalid_input.

// 처리 위치 P 다음 재생 시작. from_seq는 그 위치를 포함한다.
export { nextFromSeq };
