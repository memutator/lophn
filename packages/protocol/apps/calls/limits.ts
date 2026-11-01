// 화면 operation의 응답(결과와 changeset)이 core를 지나 화면까지 가는 한도다. shell main이 페이지로 넘기는
// 상한이자 앱 process가 싣는 상한이며, control frame(256 KiB)을 넘는 응답은 bytes stream으로 온다.
// 바깥 명령의 결과는 이 한도가 아니라 control frame 하나(`CALL_RESPONSE_MAX_BYTES`)에 묶인다.
// Zod를 쓰지 않는 앱 runtime도 읽으므로 import가 없는 file에 둔다.
export const CALL_RESULT_MAX_BYTES = 8 * 1024 * 1024;
