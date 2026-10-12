// composer의 model 단추와 picker가 그릴 값과 고른 값의 저장(shell/desktop#R44, lophn-agent/conversation#R23).
// 정렬·거르기·값 맞춤은 contracts의 model-picker 규칙이 하고(workspace/agents/model-picker-data.ts가
// 그 결과를 picker props로 옮긴다), 여기는 core에서 읽은 자료를 그 규칙에 먹이고 고른 값을 session에만
// 저장하는 연결이다. model 이름과 option 값은 모두 catalog가 준다.
import type { CatalogEntry } from "../../../protocol/lophn-agent/models.ts";
import {
  type PickerBinding,
  pickerProps,
} from "../workspace/agents/model-picker-data.ts";
import type { ModelFavorite, ModelsView } from "../workspace/agents/source.ts";
import type { PickerModelRef, PickerNoticeView } from "./model-picker/types.ts";
import type { ModelView, SourceResult } from "./agent-source.ts";
import type { AgentEnv } from "./agent-core-source-env.ts";
import { keyTag, type Memo, memo } from "./agent-core-source-link.ts";
import type {
  ModelChoiceValue,
  SessionValue,
} from "./agent-core-source-values.ts";

/** 읽은 model 자료와 agent 기본 model을 기억하는 시간. 검색어를 칠 때마다 다시 읽지 않게 한다. */
const MODEL_TTL_MS = 5000;

interface Loaded {
  readonly models: ModelsView;
  readonly seq: string;
}

interface Context extends Loaded {
  readonly record: SessionValue | null;
  readonly current: ModelChoiceValue | null;
}

export interface ModelPart {
  model(
    session: string | null,
    query: string,
  ): Promise<SourceResult<ModelView>>;
  chooseModel(
    session: string | null,
    model: PickerModelRef,
    query: string,
  ): Promise<SourceResult<ModelView>>;
  setModelOption(
    session: string | null,
    axis: string,
    value: string,
    query: string,
  ): Promise<SourceResult<ModelView>>;
  toggleFavorite(
    session: string | null,
    model: PickerModelRef,
    query: string,
  ): Promise<SourceResult<ModelView>>;
  /**
   * session을 열기 전에 고른 model을 방금 연 session에 저장하고 비운다. 저장하지 못해도 session은 열렸으므로
   * 실패를 알리지 않는다(그 session은 agent 기본값을 따른다).
   */
  applyPending(session: string, stateSeq: string): Promise<void>;
}

export function createModelPart(env: AgentEnv): ModelPart {
  const { link, target } = env;
  const loaded: Memo<Loaded> = memo(env.now, MODEL_TTL_MS);
  const defaults = new Map<string, Memo<ModelChoiceValue | null>>();
  let pending: ModelChoiceValue | null = null;

  async function readModels(): Promise<SourceResult<Loaded>> {
    const known = loaded.get();
    if (known !== undefined) return { ok: true, value: known };
    const providers = await link.pages<
      { id: string; name: string; definition: { key: string } }
    >("providers", "list", {}, "providers");
    if (!providers.ok) return providers;
    const catalog = await link.read<{ entries: CatalogEntry[] }>(
      "agent-model-catalog",
      "read",
      {},
    );
    // catalog를 읽지 못해도 현재 model의 이름은 보이도록 model 목록만 비운다.
    const entries = catalog.ok ? catalog.value.entries : [];
    const favorites = await link.read<
      { favorites: { items: ModelFavorite[]; settings_seq: string } }
    >("model-favorites", "read", {});
    if (!favorites.ok) return favorites;
    const value: Loaded = {
      models: {
        providers: providers.value.map((provider) => ({
          id: provider.id,
          name: provider.name,
          definition: provider.definition.key,
        })),
        catalog: entries,
        favorites: favorites.value.favorites.items.map((item) => ({
          provider: item.provider,
          model_name: item.model_name,
        })),
      },
      seq: favorites.value.favorites.settings_seq,
    };
    loaded.set(value);
    return { ok: true, value };
  }

  /** 그 자리에서 이 agent가 쓰는 model(정의·자리·Workspace 기본값을 합친 값). */
  async function defaultFor(
    place: { kind: string; id: string } | null,
  ): Promise<SourceResult<ModelChoiceValue | null>> {
    if (place === null || place.kind === "global") {
      return { ok: true, value: null };
    }
    const key = `${place.kind}:${place.id}`;
    let cache = defaults.get(key);
    if (cache === undefined) {
      cache = memo(env.now, MODEL_TTL_MS);
      defaults.set(key, cache);
    }
    const known = cache.get();
    if (known !== undefined) return { ok: true, value: known };
    const read = await link.read<
      { effective: { model: { value: ModelChoiceValue } | null } }
    >("agents", "read", {
      place: { kind: place.kind, id: place.id },
      assignment: target.assignment,
    });
    if (!read.ok) return read;
    const value = read.value.effective.model?.value ?? null;
    cache.set(value);
    return { ok: true, value };
  }

  async function context(
    session: string | null,
  ): Promise<SourceResult<Context>> {
    let record: SessionValue | null = null;
    if (session !== null) {
      const read = await link.read<{ session: SessionValue }>(
        "sessions",
        "read",
        { session },
      );
      if (!read.ok) return read;
      record = read.value.session;
    }
    const models = await readModels();
    if (!models.ok) return models;
    const chosen = record === null ? pending : record.model_selection;
    let current = chosen;
    if (current === null) {
      const fallback = await defaultFor(record?.work_place ?? target.place);
      if (!fallback.ok) return fallback;
      current = fallback.value;
    }
    return { ok: true, value: { ...models.value, record, current } };
  }

  function binding(
    models: ModelsView,
    current: ModelChoiceValue | null,
    query: string,
    capture: Partial<PickerBinding>,
  ): PickerBinding {
    return {
      models,
      state: { open: false, query, notices: [] },
      setState: () => {},
      current,
      choose: () => {},
      setFavorites: () => {},
      changeDefaults: () => {},
      ...capture,
    };
  }

  function viewOf(
    models: ModelsView,
    current: ModelChoiceValue | null,
    query: string,
    notices: readonly PickerNoticeView[] = [],
  ): ModelView {
    const props = pickerProps(binding(models, current, query, {}));
    return {
      current: props.current,
      currentLabel: props.currentLabel,
      axes: props.axes,
      optionValues: props.optionValues,
      layout: props.layout,
      notices,
    };
  }

  /** 고른 model을 session에 저장한다. session이 아직 없으면 쥐고 있다가 session을 열 때 저장한다. */
  async function store(
    session: string | null,
    record: SessionValue | null,
    choice: ModelChoiceValue,
  ): Promise<SourceResult<ModelChoiceValue>> {
    if (session === null || record === null) {
      pending = choice;
      return { ok: true, value: choice };
    }
    const written = await link.command<
      { model_selection: ModelChoiceValue | null }
    >("sessions", "change-model", {
      input: { session, model: choice },
      compare: { state: "open", state_seq: record.state_seq },
      key: `sessions-change-model-${session}-${record.state_seq}-${await keyTag(
        JSON.stringify(choice),
      )}`,
    });
    if (!written.ok) return written;
    return { ok: true, value: written.value.model_selection ?? choice };
  }

  return {
    async model(session, query) {
      const read = await context(session);
      if (!read.ok) return read;
      return {
        ok: true,
        value: viewOf(read.value.models, read.value.current, query),
      };
    },

    async chooseModel(session, model, query) {
      const read = await context(session);
      if (!read.ok) return read;
      const { models, current, record } = read.value;
      let chosen: ModelChoiceValue | null = null;
      let notices: readonly PickerNoticeView[] = [];
      pickerProps(binding(models, current, query, {
        setState: (state) => {
          notices = state.notices;
        },
        choose: (choice) => {
          chosen = choice;
        },
      })).onPick(model);
      if (chosen === null) return { ok: false, code: "invalid_input" };
      const stored = await store(session, record, chosen);
      if (!stored.ok) return stored;
      return { ok: true, value: viewOf(models, stored.value, query, notices) };
    },

    async setModelOption(session, axis, value, query) {
      const read = await context(session);
      if (!read.ok) return read;
      const { models, current, record } = read.value;
      let chosen: ModelChoiceValue | null = null;
      pickerProps(binding(models, current, query, {
        choose: (choice) => {
          chosen = choice;
        },
      })).onOptionChange(axis, value);
      if (chosen === null) return { ok: false, code: "invalid_input" };
      const stored = await store(session, record, chosen);
      if (!stored.ok) return stored;
      return { ok: true, value: viewOf(models, stored.value, query) };
    },

    async toggleFavorite(session, model, query) {
      const read = await context(session);
      if (!read.ok) return read;
      const { models, current, seq } = read.value;
      let items: readonly ModelFavorite[] | null = null;
      pickerProps(binding(models, current, query, {
        setFavorites: (next) => {
          items = next;
        },
      })).onToggleFavorite(model);
      if (items === null) return { ok: false, code: "invalid_input" };
      const written = await link.command<
        { favorites: { items: ModelFavorite[] } }
      >("model-favorites", "change", {
        input: { items },
        compare: { settings_seq: seq },
        key: `model-favorites-change-${seq}-${await keyTag(
          JSON.stringify(items),
        )}`,
      });
      if (!written.ok) return written;
      loaded.clear();
      return {
        ok: true,
        value: viewOf(
          { ...models, favorites: written.value.favorites.items },
          current,
          query,
        ),
      };
    },

    async applyPending(session, stateSeq) {
      const choice = pending;
      if (choice === null) return;
      pending = null;
      await link.command("sessions", "change-model", {
        input: { session, model: choice },
        compare: { state: "open", state_seq: stateSeq },
        key: `sessions-change-model-${session}-${stateSeq}-${await keyTag(
          JSON.stringify(choice),
        )}`,
      });
    },
  };
}
