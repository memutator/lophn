import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type CatalogEntry,
  changeModelFavorites,
  type ModelChoice,
  modelDefaultChange,
  projectModelChange,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { validateOptionValues } from "./options.ts";
import { GLOBAL_SCOPE, loadFavorites, saveChoice } from "./store.ts";

// 등록 순서: actor 검사 → 입력(schema는 registry, provider·목록·option은 여기) → CAS → 쓰기.
// 짧은 transaction 하나다. 바뀐 것은 command의 결과를 받은 화면이 다시 읽어 안다.

// 저장 검사가 provider와 catalog에서 알아야 하는 것이다. 같은 Tx의 provider 표와 동봉·갱신 catalog에서
// 채운다. 이 모듈은 그 출처를 모른다.
export type ModelCommandDeps = {
  // provider 기록의 provider 정의 key다. 기록이 없으면 undefined다.
  definitionKey(provider: string): string | undefined;
  // provider 정의의 확인된 model 목록에 그 이름이 있는지다. 목록을 확인하지 못했으면 null이다.
  modelListed(definition: string, modelName: string): boolean | null;
  catalogEntry(
    definition: string,
    modelName: string,
  ): CatalogEntry | undefined;
  // project 표를 가진 module의 읽기다. 조립이 꽂는다.
  projectExists(project: string): boolean;
};

function requireUser(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "user" ? ok(undefined) : err({
    code: "forbidden",
    message: "model settings are user only",
  });
}

function conflict(): Result<never> {
  return err({ code: "conflict", message: "settings seq가 바뀌었다" });
}

// 저장 때 provider 목록에 없는 이름은 거절하고 목록을 확인하지 못했으면 미확인으로 저장한다.
// 고른 option 값은 그 model의 축과 값 안에 있어야 한다. catalog 항목이 없으면 축을 모르므로 값 없이만
// 저장한다. 호출 때의 한계 검사는 turn 준비의 몫이다.
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
  if (deps.modelListed(definition, choice.model_name) === false) {
    return err({
      code: "invalid_input",
      message: `${slot}: provider 목록에 없는 model 이름이다`,
    });
  }
  const entry = deps.catalogEntry(definition, choice.model_name);
  if (entry === undefined) {
    return Object.keys(choice.option_values).length === 0
      ? ok(undefined)
      : err({
        code: "invalid_input",
        message:
          `${slot}: option을 확인할 수 없는 model에는 option 값을 고를 수 없다`,
      });
  }
  const checked = validateOptionValues(entry, choice.option_values);
  return checked.ok ? ok(undefined) : err({
    code: "invalid_input",
    message: `${slot}: ${checked.error.message}`,
  });
}

export function createModelCommands(
  deps: ModelCommandDeps | ((tx: Tx) => ModelCommandDeps),
): {
  changeDefault: CommandDefinition<typeof modelDefaultChange>;
  changeProject: CommandDefinition<typeof projectModelChange>;
  changeFavorites: CommandDefinition<typeof changeModelFavorites>;
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
        return ok({ default: input.default });
      },
    },
    changeProject: {
      route: projectModelChange,
      handle(tx, ctx, input) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        const resolved = resolve(tx);
        if (!resolved.projectExists(input.project)) {
          return err({ code: "not_found", message: "project not found" });
        }
        if (input.model !== null) {
          const checked = checkChoice(resolved, "project", input.model);
          if (!checked.ok) return checked;
        }
        saveChoice(tx.sql, input.project, input.model);
        return ok({ model: input.model });
      },
    },
    changeFavorites: {
      route: changeModelFavorites,
      handle(tx, ctx, input, compare) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        // 즐겨찾기는 catalog에서 사라져도 지우지 않는다. 목록과 catalog는 보지 않고 provider만 본다.
        const known = resolve(tx);
        for (const item of input.items) {
          if (known.definitionKey(item.provider) === undefined) {
            return err({
              code: "not_found",
              message: "즐겨찾기의 provider를 찾을 수 없다",
            });
          }
        }
        const current = loadFavorites(tx.sql);
        if (current.settings_seq !== compare.settings_seq) return conflict();
        const nextSeq = String(Number(current.settings_seq) + 1);
        tx.sql.run(
          `insert into model_favorites_seq (one, seq) values (1, ?)
           on conflict (one) do update set seq = excluded.seq`,
          [nextSeq],
        );
        // 목록을 통째로 바꾼다. rank를 0부터 빈틈 없이 다시 매긴다.
        tx.sql.run("delete from model_favorites", []);
        input.items.forEach((item, rank) => {
          tx.sql.run(
            "insert into model_favorites (provider, model_name, rank) values (?, ?, ?)",
            [item.provider, item.model_name, rank],
          );
        });
        return ok({
          favorites: { items: input.items, settings_seq: nextSeq },
        });
      },
    },
  };
}
