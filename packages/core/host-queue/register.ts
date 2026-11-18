// host queue의 core 등록. handler는 wiring(core/main/daemon/wiring/host-queue.ts)이 붙인다.
// extension tool의 route(목록 올리기·읽기·호출)도 같은 queue를 쓰므로 여기서 등록하고 handler는 wiring/extension-tools.ts가 붙인다.
import { EXTENSION_TOOL_ROUTES } from "../../protocol/lophn-agent/extension-tools.ts";
import { HOST_QUEUE_MEMORY_ROUTES } from "../../protocol/lophn-agent/host-queue.ts";
import {
  INPUT_REQUEST_ROUTES,
  inputRequestAnswerSecret,
} from "../../protocol/lophn-agent/input-request.ts";

export function createCoreRegistration() {
  return {
    // 입력 요청(login·secret)은 탭 표와 origin 재기를 host queue로 하므로 같이 등록하고 handler는 wiring/input-request.ts가 붙인다.
    memoryRoutes: [
      ...HOST_QUEUE_MEMORY_ROUTES,
      ...EXTENSION_TOOL_ROUTES,
      ...INPUT_REQUEST_ROUTES,
    ],
    // secret 요청에 값을 답하는 바이트 입구다. handler는 wiring/input-request.ts가 붙인다.
    uploadRoutes: [inputRequestAnswerSecret],
  };
}
