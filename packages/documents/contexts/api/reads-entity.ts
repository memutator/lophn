// context API 읽기: context.entity·context.series_next. 둘 다 적용된 판의 index(state.entities)만 읽는다.
// entity는 개체 하나의 field와 관계 대상을, series_next는 series kind type의 개체 경로들로 다음 이름을
// 계산한다(계산은 series/next.ts). 파일을 읽지 않고 아무것도 바꾸지 않는다.
// 규칙은 docs/domain-model/documents/contexts.md "읽기"의 entity·series_next다. 구현 전(spec)이라 모두
// `not implemented`다.
import type { ContextApiReads } from "./reads.ts";
import type { ContextApiState } from "./state.ts";

type Handlers = Pick<ContextApiReads, "contextEntity" | "contextSeriesNext">;

export function createEntityReads(_state: ContextApiState): Handlers {
  const contextEntity: Handlers["contextEntity"] = () => {
    throw new Error("not implemented: context.entity");
  };
  const contextSeriesNext: Handlers["contextSeriesNext"] = () => {
    throw new Error("not implemented: context.series_next");
  };
  return { contextEntity, contextSeriesNext };
}
