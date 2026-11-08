// host queue의 core 등록. 메모리 route만 있고 handler는 wiring(core/main/daemon/wiring/host-queue.ts)이 붙인다.
import { HOST_QUEUE_MEMORY_ROUTES } from "../../protocol/lophn-agent/host-queue.ts";

export function createCoreRegistration() {
  return { memoryRoutes: HOST_QUEUE_MEMORY_ROUTES };
}
