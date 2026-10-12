// ticket claim 제품 경로 테스트가 쓰는 question port.
// 질문 read 소유 구현(lophn-agent#T24)이 없어, 채택된 답 하나를 여기 둔다.
// 제품 등록(tickets.ts)은 이 port를 올리지 않는다.
import { ok } from "../../packages/base/mod.ts";
import { QUESTION_ADOPTIONS_PORT } from "../../packages/core/apps/tickets/commands.ts";

const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const VER = "ver_01arz3ndektsv4rrffq69g5fav";

export function createCoreRegistration() {
  return {
    ports: [
      {
        key: QUESTION_ADOPTIONS_PORT,
        create: () => ({
          adoptions(questions: readonly string[]) {
            const found = new Map<
              string,
              { document: string; version: string }
            >();
            for (const question of questions) {
              if (question === QUESTION) {
                found.set(question, { document: DOC, version: VER });
              }
            }
            return ok(found);
          },
        }),
      },
    ],
  };
}
