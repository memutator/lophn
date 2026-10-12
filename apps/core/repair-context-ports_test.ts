// repair context 제품 경로 테스트가 쓰는 문제 상태 port. 제품 등록(tickets.ts)은 문제 read 소유 구현이
// 붙기 전까지 이 port를 올리지 않아 repair ticket 생성이 fail-closed다. 여기서는 열린 문제로 답한다.
import { ok } from "../../packages/base/mod.ts";
import { PROBLEM_STATUSES_PORT } from "../../packages/core/apps/tickets/commands.ts";

export function createCoreRegistration() {
  return {
    ports: [{
      key: PROBLEM_STATUSES_PORT,
      create: () => ({
        problems(ids: readonly string[]) {
          return ok(ids.map((id) => ({ id, status: "open" })));
        },
      }),
    }],
  };
}
