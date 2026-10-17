import {
  modelDefaultRead,
  modelFavoritesRead,
  projectModelRead,
} from "../../../protocol/lophn-agent/mod.ts";
import { err, ok } from "../../../base/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
} from "../../../protocol/server/mod.ts";
import { GLOBAL_SCOPE, loadChoice, loadFavorites } from "./store.ts";
import { createCatalogRead } from "./work.ts";

// 읽기는 ledger snapshot에서 읽는다. 줄이 없으면 처음 값(null, 빈 목록)이다.
// 읽기는 catalog를 보지 않는다. catalog에서 사라진 model도 저장된 선택 그대로 돌려준다.
export function createModelReads(deps: {
  // project 표를 가진 module의 읽기다. 조립이 꽂는다.
  projectExists(sql: ReadSnapshot["sql"], project: string): boolean;
}): {
  modelDefault: ReadDefinition<typeof modelDefaultRead>;
  projectModel: ReadDefinition<typeof projectModelRead>;
  favorites: ReadDefinition<typeof modelFavoritesRead>;
  catalog: ReturnType<typeof createCatalogRead>;
} {
  return {
    modelDefault: {
      route: modelDefaultRead,
      handle(snapshot) {
        return ok({
          default: loadChoice(snapshot.sql, GLOBAL_SCOPE),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    projectModel: {
      route: projectModelRead,
      handle(snapshot, _ctx, input) {
        if (!deps.projectExists(snapshot.sql, input.project)) {
          return err({ code: "not_found", message: "project not found" });
        }
        return ok({
          model: loadChoice(snapshot.sql, input.project),
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
    // derived catalog read다. reader worker 등록과 함께
    // leaf를 끼우고, core 정적 graph는 leaf import이 없다.
    catalog: createCatalogRead(),
  };
}
