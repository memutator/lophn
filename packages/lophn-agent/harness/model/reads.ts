import {
  modelDefaultsRead,
  modelFavoritesRead,
} from "../../../contracts/lophn-agent/mod.ts";
import { ok } from "../../../base/mod.ts";
import type { ReadDefinition } from "../../../contracts/platform/mod.ts";
import { loadDefaults, loadFavorites } from "./store.ts";
import { createCatalogRead } from "./work.ts";

// 기본값·즐겨찾기 read는 ledger snapshot에서 읽는다. 줄이 없으면 처음 값(모두 null, 빈 목록)이다(R9).
// 읽기는 catalog를 보지 않는다. catalog에서 사라진 model도 저장된 선택 그대로 돌려준다(R12).
export function createModelReads(): {
  defaults: ReadDefinition<typeof modelDefaultsRead>;
  favorites: ReadDefinition<typeof modelFavoritesRead>;
  catalog: ReturnType<typeof createCatalogRead>;
} {
  return {
    defaults: {
      route: modelDefaultsRead,
      handle(snapshot) {
        return ok({
          defaults: loadDefaults(snapshot.sql),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    favorites: {
      route: modelFavoritesRead,
      handle(snapshot) {
        return ok({
          favorites: loadFavorites(snapshot.sql),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    // derived catalog read다(plan/lophn-agent Q28). reader worker 등록과 함께
    // leaf를 끼우고, core 정적 graph는 leaf import이 없다.
    catalog: createCatalogRead(),
  };
}
