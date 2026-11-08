// host queue의 core 등록. 메모리 route만 있고 handler는 wiring(core/main/daemon/wiring/host-queue.ts)이 붙인다.
// extension tool의 route(목록 올리기·읽기·호출)도 같은 queue를 쓰므로 여기서 등록하고 handler는 wiring/extension-tools.ts가 붙인다.
import { EXTENSION_TOOL_ROUTES } from "../../protocol/lophn-agent/extension-tools.ts";
import { HOST_QUEUE_MEMORY_ROUTES } from "../../protocol/lophn-agent/host-queue.ts";

export function createCoreRegistration() {
  return {
    memoryRoutes: [...HOST_QUEUE_MEMORY_ROUTES, ...EXTENSION_TOOL_ROUTES],
  };
}
