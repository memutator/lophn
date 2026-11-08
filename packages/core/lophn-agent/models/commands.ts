import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type CatalogEntry,
  changeShownModels,
  type ModelChoice,
  modelDefaultChange,
  removeUserModelInfo,
  saveUserModelInfo,
  type Workspace,
  workspaceModelChange,
  workspaceOfKey,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { validateOptionValues } from "./options.ts";
import { builtinProviderDefinition } from "../providers/mod.ts";
import {
  bumpShownSeq,
  bumpUserModelsSeq,
  defaultIfUnset,
  GLOBAL_SCOPE,
  loadShown,
  loadUserModels,
  saveChoice,
  showChosen,
} from "./store.ts";

// 등록 순서: actor 검사 → 입력(schema는 registry, provider·목록·option은 여기) → CAS → 쓰기.
// 짧은 transaction 하나다. 바뀐 것은 command의 결과를 받은 화면이 다시 읽어 안다.

// 저장 검사가 provider와 catalog에서 알아야 하는 것이다. 같은 Tx의 provider 표와 동봉·갱신 catalog에서
// 채운다. 이 모듈은 그 출처를 모른다.
export type ModelCommandDeps = {
  // provider 기록의 provider 정의 key다. 기록이 없으면 undefined다.
  definitionKey(provider: string): string | undefined;
  catalogEntry(definition: string, modelName: string): CatalogEntry | undefined;
  // project·앱 표를 가진 module의 읽기다. 조립이 꽂는다. Home은 늘 있어 묻지 않는다.
  workspaceExists(workspace: Workspace): boolean;
};

function requireUser(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "user"
    ? ok(undefined)
    : err({
        code: "forbidden",
        message: "model settings are user only",
      });
}

function conflict(): Result<never> {
  return err({ code: "conflict", message: "settings seq가 바뀌었다" });
}

// 직접 적은 이름은 목록에 없어도 저장한다(구독 계정의 허락 목록도 저장 때는 보지 않는다). 고른 option 값은
// 그 model의 축과 값 안에 있어야 한다. catalog 항목이 없으면 축을 모르므로 값 없이만 저장한다.
// 호출 때의 한계 검사는 turn 준비의 몫이다.
function checkChoice(
  deps: ModelCommandDeps,
  slot: string,
  choice: ModelChoice,
): Result<void> {
  const definition = deps.definitionKey(choice.provider);
  if (definition === undefined) {
    return err({
      code: "not_found",
      message: `${slot}: provider를 찾을 수 없다`,
    });
  }
  const entry = deps.catalogEntry(definition, choice.model_name);
  if (entry === undefined) {
    return Object.keys(choice.option_values).length === 0
      ? ok(undefined)
      : err({
          code: "invalid_input",
          message: `${slot}: option을 확인할 수 없는 model에는 option 값을 고를 수 없다`,
        });
  }
  const checked = validateOptionValues(entry, choice.option_values);
  return checked.ok
    ? ok(undefined)
    : err({
        code: "invalid_input",
        message: `${slot}: ${checked.error.message}`,
      });
}

export function createModelCommands(
  deps: ModelCommandDeps | ((tx: Tx) => ModelCommandDeps),
): {
  changeDefault: CommandDefinition<typeof modelDefaultChange>;
  changeWorkspace: CommandDefinition<typeof workspaceModelChange>;
  changeShown: CommandDefinition<typeof changeShownModels>;
  saveUserInfo: CommandDefinition<typeof saveUserModelInfo>;
  removeUserInfo: CommandDefinition<typeof removeUserModelInfo>;
} {
  const resolve = (tx: Tx): ModelCommandDeps =>
    typeof deps === "function" ? deps(tx) : deps;
  return {
    changeDefault: {
      route: modelDefaultChange,
      handle(tx, ctx, input) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        if (input.default !== null) {
          const checked = checkChoice(resolve(tx), "default", input.default);
          if (!checked.ok) return checked;
        }
        saveChoice(tx.sql, GLOBAL_SCOPE, input.default);
        if (input.default !== null) showChosen(tx.sql, input.default);
        return ok({ default: input.default });
      },
    },
    changeWorkspace: {
      route: workspaceModelChange,
      handle(tx, ctx, input) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        const resolved = resolve(tx);
        const workspace = workspaceOfKey(input.workspace);
        if (workspace !== null && !resolved.workspaceExists(workspace)) {
          return err({
            code: "not_found",
            message: `${workspace.kind} not found`,
          });
        }
        if (input.model !== null) {
          const checked = checkChoice(resolved, "workspace", input.model);
          if (!checked.ok) return checked;
        }
        saveChoice(tx.sql, input.workspace, input.model);
        if (input.model !== null) {
          showChosen(tx.sql, input.model);
          defaultIfUnset(tx.sql, input.model);
        }
        return ok({ model: input.model });
      },
    },
    changeShown: {
      route: changeShownModels,
      handle(tx, ctx, input, compare) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        // 켠 model은 catalog에서 사라져도 지우지 않는다. 끊은 provider의 줄은 버린다: 남겨 두면 화면이 보내는
        // 목록마다 그 줄이 끼어 모든 켜고 끄기가 거절된다.
        const known = resolve(tx);
        const items = input.items.filter(
          (item) => known.definitionKey(item.provider) !== undefined,
        );
        const current = loadShown(tx.sql);
        if (current.settings_seq !== compare.settings_seq) return conflict();
        const nextSeq = bumpShownSeq(tx.sql);
        // 목록을 통째로 바꾼다.
        tx.sql.run("delete from model_shown", []);
        for (const item of items) {
          tx.sql.run(
            "insert into model_shown (provider, model_name) values (?, ?)",
            [item.provider, item.model_name],
          );
        }
        return ok({
          shown: { items, settings_seq: nextSeq },
        });
      },
    },
    saveUserInfo: {
      route: saveUserModelInfo,
      handle(tx, ctx, input, compare) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        // 내장·구독 OAuth 정의의 catalog를 사람이 덮는 길은 없다. custom 정의의 key만 받는다.
        if (builtinProviderDefinition(input.provider_definition).ok) {
          return err({
            code: "invalid_input",
            message: "model info can only be saved for a custom provider",
          });
        }
        const current = loadUserModels(tx.sql);
        if (current.seq !== compare.seq) return conflict();
        tx.sql.run(
          `insert into model_user_info (provider_definition, model_name, info, saved_at)
           values (?, ?, ?, ?)
           on conflict (provider_definition, model_name) do update set
             info = excluded.info, saved_at = excluded.saved_at`,
          [
            input.provider_definition,
            input.model_name,
            JSON.stringify(input.info),
            tx.now(),
          ],
        );
        bumpUserModelsSeq(tx.sql, current.seq);
        return ok(loadUserModels(tx.sql));
      },
    },
    removeUserInfo: {
      route: removeUserModelInfo,
      handle(tx, ctx, input, compare) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        const current = loadUserModels(tx.sql);
        if (current.seq !== compare.seq) return conflict();
        tx.sql.run(
          "delete from model_user_info where provider_definition = ? and model_name = ?",
          [input.provider_definition, input.model_name],
        );
        bumpUserModelsSeq(tx.sql, current.seq);
        return ok(loadUserModels(tx.sql));
      },
    },
  };
}
