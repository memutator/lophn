// Model 칸. 대화와 같은 picker(conversation/model-picker)를 칸 모양 trigger로 감싼다. 선택지·option 축·정렬은 모두
// catalog가 주고 화면 코드에는 model 이름도 option 값도 없다. 목록은 열 때마다 다시 읽어 Manage models 창에서 바꾼 것이 보이게 한다.

import { t } from "@lophn/i18n";
import { Button } from "@lophn/ui/primitives";
import { useEffect, useRef, useState } from "react";

import type { HarnessCatalogView } from "../../../../../protocol/acp/harness-catalog.ts";
import type { GuiHarness } from "../../../../../protocol/coding-agent/gui-harness.ts";
import type { AgentValueLayer } from "../../../../../protocol/lophn-agent/agent-definitions.ts";
import type {
  HarnessConfig,
  HarnessRuntime,
} from "../../../../../protocol/lophn-agent/agent-values.ts";
import type { ModelChoice } from "../../../../../protocol/lophn-agent/models.ts";
import { ManageModelsContext } from "../../../conversation/model-picker/manage-context.ts";
import { ModelPickerField } from "../../../conversation/model-picker/model-picker.tsx";
import type { ModelPickerProps } from "../../../conversation/model-picker/types.ts";
import { actionIcons } from "../../../icons/mod.ts";
import { runtimeLabel } from "../agent-glance.tsx";
import {
  formatHarnessOptions,
  harnessPickerProps,
  pickerProps,
} from "../model-picker-data.ts";
import type { AgentsSource, ModelsView } from "../source.ts";
import styles from "./agent-editor.module.css";

/** 칸이 목록을 다시 읽는 통로. */
export type ModelFieldSource = Pick<AgentsSource, "models">;

function useFieldPicker({
  models,
  source,
  current,
  layer,
  choose,
  showAll,
}: {
  models: ModelsView | null;
  source?: ModelFieldSource;
  current: ModelChoice | null;
  layer: AgentValueLayer | null;
  choose: (choice: ModelChoice) => void;
  showAll?: boolean;
}): ModelPickerProps {
  const [state, setState] = useState({ open: false, query: "" });
  // 연결 대화창을 거쳐 다시 열 때 onOpenChange가 옛 state를 쥐고 있어 state.open으로는 열림을 가릴 수 없다.
  const wasOpen = useRef(false);
  // 열 때와 목록을 바꾼 뒤 다시 읽은 것이 부모가 준 것보다 새롭다.
  const [reloaded, setReloaded] = useState<ModelsView | null>(null);
  const reload = () => {
    void source?.models().then((read) => {
      if (read.ok) setReloaded(read.value);
    });
  };
  const shown = reloaded ?? models;
  return {
    ...pickerProps({
      models: shown,
      state,
      setState: (next) => {
        if (next.open && !wasOpen.current) reload();
        wasOpen.current = next.open;
        setState(next.open ? next : { open: false, query: "" });
      },
      current,
      layer,
      choose,
      showAll,
    }),
    axesReady: shown !== null,
  };
}

interface ModelFieldProps {
  readonly models: ModelsView | null;
  readonly source?: ModelFieldSource;
  readonly label: string;
  /** "Use workspace default — Haiku 5.5" 같은 따르기 줄의 글. */
  readonly inheritLabel: string;
  /** 따를 때의 값. 어느 층에도 없으면 null이다. */
  readonly inherited: ModelChoice | null;
  /** 이 칸에서 고른 값. 따르는 중이면 null이다. */
  readonly value: ModelChoice | null;
  /** 지금 model이 온 층. */
  readonly layer: AgentValueLayer | null;
  readonly overrideNote?: string;
  readonly onChange: (choice: ModelChoice | null) => void;
}

/** 위 층의 값을 따르는 Model 칸(agent 정의, project). 바꾸면 Changed와 [Reset]이 붙는다. */
export function ModelField({
  models,
  source,
  label,
  inheritLabel,
  inherited,
  value,
  layer,
  overrideNote,
  onChange,
}: ModelFieldProps) {
  const current = value ?? inherited;
  const picker = useFieldPicker({
    models,
    source,
    current,
    layer,
    choose: onChange,
  });
  return (
    <ModelPickerField
      props={{
        ...picker,
        follow: {
          label: inheritLabel,
          on: value === null,
          onFollow: () => onChange(null),
        },
      }}
      label={label}
      reset={
        value === null
          ? undefined
          : { note: overrideNote, onReset: () => onChange(null) }
      }
    />
  );
}

interface DefaultModelFieldProps {
  readonly models: ModelsView | null;
  readonly source?: ModelFieldSource;
  readonly value: ModelChoice | null;
  readonly onChange: (choice: ModelChoice) => void;
  /** 고른 값을 저장하지 못한 이유 한 줄. */
  readonly error?: string;
  /** 켠 목록과 상관없이 고를 수 있는 model 전부를 보인다(provider를 막 연결해 켠 model이 없을 때). */
  readonly showAll?: boolean;
}

/** 위 층이 없는 model 칸(전역 기본). model과 그 model의 option 축을 고른다. */
export function DefaultModelField({
  models,
  source,
  value,
  onChange,
  error,
  showAll,
}: DefaultModelFieldProps) {
  const picker = useFieldPicker({
    models,
    source,
    current: value,
    layer: null,
    choose: onChange,
    showAll,
  });
  return (
    <div className={styles.group}>
      <ModelPickerField
        props={picker}
        label={t("project-workspace.heading.agent-editor-model")}
        error={error}
      />
    </div>
  );
}

/** harness model catalog를 읽고 새로 고치는 통로. */
export type HarnessModelFieldSource = Pick<
  AgentsSource,
  "harnessCatalog" | "refreshHarnessCatalog"
>;

interface HarnessModelFieldProps {
  readonly runtime: HarnessRuntime;
  readonly harness: GuiHarness;
  readonly workspace: string | null;
  readonly source: HarnessModelFieldSource;
  readonly value: HarnessConfig | undefined;
  readonly onChange: (next: HarnessConfig | undefined) => void;
}

/**
 * harness runtime의 Model·축(effort 등) 칸. 대화와 같은 `ModelPickerField`를 쓰되 lophn의 Manage models 줄은 숨긴다.
 * 열거나 harness를 고르면 cache를 읽고 없으면 lazy probe를 한 번 돌린다. 조회 실패나 목록에 없는 저장 model이어도
 * 저장된 `harness_config`는 절대 지우거나 덮지 않고 그대로 보인다.
 */
export function HarnessModelField({
  runtime,
  harness,
  workspace,
  source,
  value,
  onChange,
}: HarnessModelFieldProps) {
  const [state, setState] = useState({ open: false, query: "" });
  const [view, setView] = useState<HarnessCatalogView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    let live = true;
    const seq = ++requestId.current;
    setView(null);
    setReadFailed(false);
    setRefreshing(false);
    setLoading(true);
    setState({ open: false, query: "" });
    void source.harnessCatalog(harness, true, workspace).then((result) => {
      if (!live || seq !== requestId.current) return;
      setLoading(false);
      if (result.ok) {
        setView(result.value);
        setReadFailed(false);
      } else {
        setReadFailed(true);
      }
    });
    return () => {
      live = false;
      requestId.current += 1;
    };
  }, [source, harness, workspace]);

  const refresh = () => {
    const seq = ++requestId.current;
    setRefreshing(true);
    setReadFailed(false);
    void source.refreshHarnessCatalog(harness, workspace).then((result) => {
      if (seq !== requestId.current) return;
      setRefreshing(false);
      if (result.ok) {
        setView(result.value);
        setReadFailed(false);
      } else {
        setReadFailed(true);
      }
    });
  };

  const name = runtimeLabel(runtime);
  const catalog = view?.catalog ?? null;
  const defaultId = catalog?.defaults.model ?? null;
  const defaultModelName =
    defaultId === null
      ? null
      : (catalog?.models
          .flatMap((group) => group.models)
          .find((one) => one.id === defaultId)?.label ?? defaultId);
  const followLabel =
    defaultModelName === null
      ? t("agents.label.harness-model-default", { runtime: name })
      : t("agents.label.harness-model-default-named", {
          runtime: name,
          model: defaultModelName,
        });

  const { props: picker, matched } = harnessPickerProps({
    catalog,
    state,
    setState,
    value,
    followLabel,
    onChange,
  });

  const hasSaved = value?.model !== undefined;
  const savedOptions = formatHarnessOptions(value?.options);
  const failed = readFailed || view?.status === "error";
  const errorText = failed
    ? view?.error
      ? `${t("agents.error.harness-model-load", { runtime: name })} (${view.error})`
      : t("agents.error.harness-model-load", { runtime: name })
    : undefined;

  const statusNote = loading
    ? t("agents.notice.harness-model-loading", { runtime: name })
    : !failed && hasSaved && view !== null && !matched
      ? t("agents.notice.harness-model-missing", { runtime: name })
      : !failed && view?.stale && catalog !== null
        ? t("agents.notice.harness-model-stale", { runtime: name })
        : !failed && view?.status === "empty"
          ? t("agents.notice.harness-model-empty", { runtime: name })
          : t("agents.notice.harness-model-help", { runtime: name });

  return (
    <div
      className={styles.group}
      data-field="model"
      data-harness-model={harness}
    >
      <ManageModelsContext.Provider value={null}>
        <ModelPickerField
          props={picker}
          label={t("project-workspace.heading.agent-editor-model")}
          error={errorText}
          reset={
            !hasSaved
              ? undefined
              : {
                  note: t("agents.label.harness-model-overrides", {
                    runtime: name,
                  }),
                  onReset: () => onChange(undefined),
                }
          }
        />
      </ManageModelsContext.Provider>
      {hasSaved && !matched && savedOptions.length > 0 ? (
        <p className={styles.note} data-harness-saved-options="">
          {t("agents.label.harness-options-saved", {
            options: savedOptions.join(" · "),
          })}
        </p>
      ) : null}
      <div className={styles.harnessModelFoot}>
        <p className={styles.note} data-harness-model-status="">
          {statusNote}
        </p>
        <Button
          size="sm"
          variant="ghost"
          icon={actionIcons.refresh}
          disabled={loading || refreshing}
          onClick={refresh}
          data-action="refresh-harness-models"
        >
          {t("agents.button.refresh-models")}
        </Button>
      </div>
    </div>
  );
}
