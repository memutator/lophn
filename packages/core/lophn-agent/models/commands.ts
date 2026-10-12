import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type CatalogEntry,
  changeModelDefaults,
  changeModelFavorites,
  MODEL_DEFAULT_SLOTS,
  type ModelChoice,
  type ModelDefaults,
  modelDefaultsChanged,
  type ModelDefaultSlot,
  modelFavoritesChanged,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  type CommandDefinition,
  parseActor,
  type RequestContext,
  type Tx,
} from "../../../protocol/platform/mod.ts";
import { validateOptionValues } from "./options.ts";
import { loadDefaults, loadFavorites } from "./store.ts";

// 등록 순서: actor 검사 → 입력(schema는 registry, provider·목록·option은 여기) → CAS → 쓰기 →
// event. 짧은 transaction 하나다.

// 저장 검사가 provider와 catalog에서 알아야 하는 것이다. 같은 Tx의 provider 표와 동봉·갱신 catalog에서
// 채운다. 이 모듈은 그 출처를 모른다.
export type ModelCommandDeps = {
  // provider 기록의 provider 정의 key다. 기록이 없으면 undefined다.
  definitionKey(provider: string): string | undefined;
  // provider 정의의 확인된 model 목록에 그 이름이 있는지다. 목록을 확인하지 못했으면 null이다(R10).
  modelListed(definition: string, modelName: string): boolean | null;
  catalogEntry(
    definition: string,
    modelName: string,
  ): CatalogEntry | undefined;
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

// 저장 때 provider 목록에 없는 이름은 거절하고 목록을 확인하지 못했으면 미확인으로 저장한다(R10).
// 고른 option 값은 그 model의 축과 값 안에 있어야 한다. catalog 항목이 없으면 축을 모르므로 값 없이만
// 저장한다(R16, R24). 호출 때의 한계 검사는 run 준비의 몫이다.
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

function upsertSlot(
  tx: Tx,
  slot: ModelDefaultSlot,
  choice: ModelChoice | null,
  settingsSeq: string,
): void {
  // null은 선택만 지우고 줄을 남긴다. 설정 seq는 유지해 CAS 근거가 남는다.
  tx.sql.run(
    `insert into agent_model_defaults
       (slot, provider, model_name, option_values, settings_seq)
     values (?, ?, ?, ?, ?)
     on conflict (slot) do update set
       provider = excluded.provider,
       model_name = excluded.model_name,
       option_values = excluded.option_values,
       settings_seq = excluded.settings_seq`,
    [
      slot,
      choice?.provider ?? null,
      choice?.model_name ?? null,
      JSON.stringify(choice?.option_values ?? {}),
      settingsSeq,
    ],
  );
}

export function createModelCommands(
  deps: ModelCommandDeps | ((tx: Tx) => ModelCommandDeps),
): {
  changeDefaults: CommandDefinition<typeof changeModelDefaults>;
  changeFavorites: CommandDefinition<typeof changeModelFavorites>;
} {
  const resolve = (tx: Tx): ModelCommandDeps =>
    typeof deps === "function" ? deps(tx) : deps;
  return {
    changeDefaults: {
      route: changeModelDefaults,
      handle(tx, ctx, input, compare) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        const changed = MODEL_DEFAULT_SLOTS.filter((slot) =>
          input[slot] !== undefined
        );
        const known = resolve(tx);
        for (const slot of changed) {
          const choice = input[slot];
          if (choice === null || choice === undefined) continue;
          const checked = checkChoice(known, slot, choice);
          if (!checked.ok) return checked;
        }
        const current = loadDefaults(tx.sql);
        if (current.settings_seq !== compare.settings_seq) return conflict();
        const next: ModelDefaults = { ...current };
        for (const slot of changed) next[slot] = input[slot] ?? null;
        // 새 seq는 이 event의 seq라 payload에는 비교한 이전 seq를 싣는다.
        const nextSeq = tx.emit(modelDefaultsChanged, null, {
          settings_seq: current.settings_seq,
          slots: changed,
          defaults: next,
        });
        for (const slot of changed) {
          upsertSlot(tx, slot, next[slot], nextSeq);
        }
        return ok({ defaults: { ...next, settings_seq: nextSeq } });
      },
    },
    changeFavorites: {
      route: changeModelFavorites,
      handle(tx, ctx, input, compare) {
        const person = requireUser(ctx);
        if (!person.ok) return person;
        // 즐겨찾기는 catalog에서 사라져도 지우지 않는다(R12). 목록과 catalog는 보지 않고 provider만 본다.
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
        const nextSeq = tx.emit(modelFavoritesChanged, null, {
          settings_seq: current.settings_seq,
          items: input.items,
        });
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
