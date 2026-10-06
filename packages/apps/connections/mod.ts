// mod.ts는 앱 프로세스(runtime, Zod 없음)가 부르는 통로와 순수 범위 계산만 내보낸다.
// core 쪽 준비·proof 발급(prepare.ts, confirm.ts, origin.ts)은 Zod를 쓰므로 core 조립이
// 직접 부른다(apps/invocations/mod.ts와 같은 구분).
export {
  APP_CONNECT_PATH,
  createPairPort,
  installPairPort,
  NotSent,
  PAIR_PORT,
  PAIR_SOCKET_HOST,
  ResultLost,
  unixPairDirect,
} from "./client.ts";
export type {
  PairConnectRequest,
  PairDirect,
  PairDirectRequest,
  PairPort,
  PairResponse,
} from "./client.ts";
export { pairScope, resolveCall } from "./resolve.ts";
export type { PairDeclaration, PairInput, Resolution } from "./resolve.ts";
