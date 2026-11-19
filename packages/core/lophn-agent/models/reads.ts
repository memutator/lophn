import {
  modelDefaultRead,
  shownModelsRead,
  userModelInfoRead,
  workspaceModelRead,
  workspaceOfKey,
  type Workspace,
} from "../../../protocol/lophn-agent/mod.ts";
import { err, ok } from "../../../base/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
} from "../../../protocol/server/mod.ts";
import {
  GLOBAL_SCOPE,
  loadChoice,
  loadShown,
  loadUserModels,
} from "./store.ts";
import { userEntryOf } from "./user-entry.ts";
import { bundledSnapshot } from "./snapshot-catalog.ts";
import { createCatalogRead } from "./work.ts";

// 읽기는 ledger snapshot에서 읽는다. 줄이 없으면 처음 값(null, 빈 목록)이다.
// 읽기는 catalog를 보지 않는다. catalog에서 사라진 model도 저장된 선택 그대로 돌려준다.
export function createModelReads(deps: {
  // project·앱 표를 가진 module의 읽기다. 조립이 꽂는다. Home은 늘 있어 묻지 않는다.
  workspaceExists(sql: ReadSnapshot["sql"], workspace: Workspace): boolean;
  // derived catalog 파일의 동기 reader다. 조립이 꽂는다.
  readDerived(sql: ReadSnapshot["sql"], name: string): string | null;
}): {
  modelDefault: ReadDefinition<typeof modelDefaultRead>;
  workspaceModel: ReadDefinition<typeof workspaceModelRead>;
  shown: ReadDefinition<typeof shownModelsRead>;
  userInfo: ReadDefinition<typeof userModelInfoRead>;
  catalog: ReturnType<typeof createCatalogRead>;
} {
  return {
    modelDefault: {
      route: modelDefaultRead,
      handle(snapshot) {
        const chosen = loadChoice(snapshot.sql, GLOBAL_SCOPE);
        // 끊긴 provider를 가리키는 전역 기본은 없는 것으로 읽는다(DB 줄은 남겨 같은 정의를 다시 이으면 이어진다).
        const exists =
          chosen !== null &&
          snapshot.sql.get("select id from providers where id = ?", [
            chosen.provider,
          ]) !== undefined;
        return ok({
          default: exists ? chosen : null,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    workspaceModel: {
      route: workspaceModelRead,
      handle(snapshot, _ctx, input) {
        const workspace = workspaceOfKey(input.workspace);
        if (
          workspace !== null &&
          !deps.workspaceExists(snapshot.sql, workspace)
        ) {
          return err({
            code: "not_found",
            message: `${workspace.kind} not found`,
          });
        }
        return ok({
          model: loadChoice(snapshot.sql, input.workspace),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    shown: {
      route: shownModelsRead,
      handle(snapshot) {
        return ok({
          shown: loadShown(snapshot.sql),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    userInfo: {
      route: userModelInfoRead,
      handle(snapshot) {
        return ok({
          ...loadUserModels(snapshot.sql),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    catalog: createCatalogRead({
      readDerived: deps.readDerived,
      userEntries: (sql, base) =>
        loadUserModels(sql).items.map((record) =>
          userEntryOf(
            record,
            base.find(
              (entry) =>
                entry.provider_definition === record.provider_definition &&
                entry.model_name === record.model_name,
            ),
          ),
        ),
      snapshot: bundledSnapshot,
    }),
  };
}
