// composer의 model 단추와 picker가 그릴 값과 고른 값의 저장.
// 정렬·거르기·값 맞춤은 protocol의 model-picker 규칙이 하고(workspace/agents/model-picker-data.ts가 그 결과를 picker
// props로 옮긴다), 여기는 core에서 읽은 자료를 그 규칙에 먹이고 고른 값을 session에만 저장하는 연결이다. model 이름과
// option 값은 모두 catalog가 준다. 바꾼 값 맞춤은 안내 없이 조용히 맞춘다.
import {
  type CatalogEntry,
  hiddenModelsRead,
  modelCatalogRead,
  type ModelChoice,
} from "../../../protocol/lophn-agent/models.ts";
import {
  agentDefinitionRead,
  type AgentValueLayer,
} from "../../../protocol/lophn-agent/agent-definitions.ts";
import { providerList } from "../../../protocol/lophn-agent/providers.ts";
import { changeSessionModel } from "../../../protocol/lophn-agent/sessions.ts";
import {
  type PickerBinding,
  pickerProps,
  providerChoiceOf,
} from "../workspace/agents/model-picker-data.ts";
import type { ModelsView } from "../workspace/agents/source.ts";
import type { PickerModelRef } from "./model-picker/types.ts";
import type { AgentSession } from "../../../protocol/lophn-agent/agent-sessions.ts";
import type { ModelView, SourceResult } from "./agent-tab-source.ts";
import {
  type Env,
  keyTag,
  type Memo,
  memo,
} from "./agent-tab-core-source-env.ts";
import { readSession } from "./agent-tab-core-source-sessions.ts";

/** catalog와 agent 기본 model을 기억하는 시간. 검색어를 칠 때마다 다시 읽지 않게 한다. */
const MODEL_TTL_MS = 5000;

interface Context {
  readonly models: ModelsView;
  readonly record: AgentSession | null;
  readonly current: ModelChoice | null;
  /** current가 온 층. current가 없으면 null이다. */
  readonly layer: AgentValueLayer | null;
}

/** agent가 쓰는 model과 그것이 온 층(정의·project·Workspace 기본). */
interface Inherited {
  readonly model: ModelChoice | null;
  readonly layer: AgentValueLayer | null;
}

interface ModelPart {
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
  /**
   * session을 열기 전에 고른 model을 방금 연 session에 저장하고 비운다. 저장하지 못해도 session은 열렸으므로
   * 실패를 알리지 않는다(그 session은 agent 기본값을 따른다).
   */
  applyPending(session: string, stateSeq: string): Promise<void>;
}

export function createModelPart(env: Env): ModelPart {
  // catalog는 크고 자주 바뀌지 않아 기억한다. provider와 끈 model은 Manage models 창에서 바뀌므로 매번 읽는다.
  const catalog: Memo<readonly CatalogEntry[]> = memo(env.now, MODEL_TTL_MS);
  const defaultModel: Memo<Inherited> = memo(env.now, MODEL_TTL_MS);
  let pending: ModelChoice | null = null;

  async function readModels(): Promise<SourceResult<ModelsView>> {
    const providers = await env.pages(
      providerList,
      {},
      (out) => out.providers,
    );
    if (!providers.ok) return providers;
    let entries = catalog.get();
    if (entries === undefined) {
      const read = await env.pages(modelCatalogRead, {}, (out) => out.entries);
      // catalog를 읽지 못해도 현재 model의 이름은 보이도록 model 목록만 비운다.
      entries = read.ok ? read.value : [];
      if (read.ok) catalog.set(entries);
    }
    const hidden = await env.read(hiddenModelsRead, {});
    if (!hidden.ok) return hidden;
    return {
      ok: true,
      value: {
        providers: providers.value.map((provider) =>
          providerChoiceOf(provider, entries)
        ),
        catalog: entries,
        hidden: hidden.value.hidden.items.map((item) => ({
          provider: item.provider,
          model_name: item.model_name,
        })),
      },
    };
  }

  /** 이 agent가 쓰는 model(정의·Workspace 기본값을 합친 값). */
  async function defaultFor(): Promise<SourceResult<Inherited>> {
    const known = defaultModel.get();
    if (known !== undefined) return { ok: true, value: known };
    const read = await env.read(agentDefinitionRead, { agent: env.agent });
    if (!read.ok) return read;
    const effective = read.value.effective.model;
    const value: Inherited = {
      model: effective?.value ?? null,
      layer: effective?.source ?? null,
    };
    defaultModel.set(value);
    return { ok: true, value };
  }

  async function context(
    session: string | null,
  ): Promise<SourceResult<Context>> {
    let record: AgentSession | null = null;
    if (session !== null) {
      const read = await readSession(env, session);
      if (!read.ok) return read;
      record = read.value;
    }
    const models = await readModels();
    if (!models.ok) return models;
    let current: ModelChoice | null = record === null
      ? pending
      : record.model_selection;
    let layer: AgentValueLayer | null = current === null ? null : "session";
    if (current === null) {
      const fallback = await defaultFor();
      if (!fallback.ok) return fallback;
      current = fallback.value.model;
      layer = fallback.value.layer;
    }
    return {
      ok: true,
      value: { models: models.value, record, current, layer },
    };
  }

  function binding(
    models: ModelsView,
    current: ModelChoice | null,
    query: string,
    capture: Partial<PickerBinding>,
    layer: AgentValueLayer | null = null,
  ): PickerBinding {
    return {
      models,
      state: { open: false, query },
      setState: () => {},
      current,
      layer,
      choose: () => {},
      ...capture,
    };
  }

  function viewOf(
    models: ModelsView,
    current: ModelChoice | null,
    query: string,
    layer: AgentValueLayer | null,
  ): ModelView {
    const props = pickerProps(binding(models, current, query, {}, layer));
    return {
      current: props.current,
      currentLabel: props.currentLabel,
      axes: props.axes,
      optionValues: props.optionValues,
      layout: props.layout,
      layer: props.layer,
    };
  }

  async function changeKey(
    session: string,
    stateSeq: string,
    choice: ModelChoice,
  ): Promise<string> {
    return `sessions-change-model-${session}-${stateSeq}-${await keyTag(
      JSON.stringify(choice),
    )}`;
  }

  /** 고른 model을 session에 저장한다. session이 아직 없으면 쥐고 있다가 session을 열 때 저장한다. */
  async function store(
    session: string | null,
    record: AgentSession | null,
    choice: ModelChoice,
  ): Promise<SourceResult<ModelChoice>> {
    if (session === null || record === null) {
      pending = choice;
      return { ok: true, value: choice };
    }
    const written = await env.command(changeSessionModel, {
      input: { session, model: choice },
      compare: { state: "open", state_seq: record.state_seq },
      key: await changeKey(session, record.state_seq, choice),
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
        value: viewOf(
          read.value.models,
          read.value.current,
          query,
          read.value.layer,
        ),
      };
    },

    async chooseModel(session, model, query) {
      const read = await context(session);
      if (!read.ok) return read;
      const { models, current, record } = read.value;
      let chosen: ModelChoice | null = null;
      pickerProps(binding(models, current, query, {
        choose: (choice) => {
          chosen = choice;
        },
      })).onPick(model);
      if (chosen === null) return { ok: false, code: "invalid_input" };
      const stored = await store(session, record, chosen);
      if (!stored.ok) return stored;
      return {
        ok: true,
        value: viewOf(models, stored.value, query, "session"),
      };
    },

    async setModelOption(session, axis, value, query) {
      const read = await context(session);
      if (!read.ok) return read;
      const { models, current, record } = read.value;
      let chosen: ModelChoice | null = null;
      pickerProps(binding(models, current, query, {
        choose: (choice) => {
          chosen = choice;
        },
      })).onOptionChange(axis, value);
      if (chosen === null) return { ok: false, code: "invalid_input" };
      const stored = await store(session, record, chosen);
      if (!stored.ok) return stored;
      return {
        ok: true,
        value: viewOf(models, stored.value, query, "session"),
      };
    },

    async applyPending(session, stateSeq) {
      const choice = pending;
      if (choice === null) return;
      pending = null;
      await env.command(changeSessionModel, {
        input: { session, model: choice },
        compare: { state: "open", state_seq: stateSeq },
        key: await changeKey(session, stateSeq, choice),
      });
    },
  };
}
