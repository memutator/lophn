import { resultItems } from "./app-data-items.ts";
import type { EntityAnchor, KindExtractor } from "./types.ts";

// command 결과에서 result_path로 찾은 배열의 항목 하나가 개체 하나다.
// 순서는 결과 순서이고, 경로는 app:<app>/<command>, section은 null이다.
export const appDataKind: KindExtractor<"app-data"> = (type, context) => {
  const { app, command, result_path } = type.source;
  const path = `app:${app}/${command}`;
  const result = context.appData(app, command);
  const anchors: EntityAnchor[] = resultItems(result, result_path).map(
    (item) => ({
      type: type.name,
      path,
      section: null,
      captures: {},
      scope: { kind: "item", item },
    }),
  );
  return { anchors, violations: [] };
};
