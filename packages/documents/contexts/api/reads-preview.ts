// context.preview의 ledger 쪽 자리. 이 읽기는 파일을 읽으므로 ledger만으로 답하지 못한다: core가 읽기를
// 덮어서 context worker에 일을 보내 답한다(apps/core/contexts-worker.ts). 덮이지 않은 등록(worker가 없는
// harness)은 빈 결과로 꾸미지 않고 unavailable이다.
import { err } from "../../../base/mod.ts";
import type { ContextApiReads } from "./reads.ts";
import { checkReader } from "./reads-common.ts";

type Handlers = Pick<ContextApiReads, "contextPreview">;

export function createPreviewReads(): Handlers {
  const contextPreview: Handlers["contextPreview"] = ({ actor }) => {
    const allowed = checkReader(actor);
    if (!allowed.ok) return allowed;
    return err({
      code: "unavailable",
      message: "context.preview needs the context worker",
    });
  };
  return { contextPreview };
}
