// Model 칸. 대화와 같은 picker(conversation/model-picker)를 칸 모양 trigger로 감싼다. 선택지·option 축·정렬은 모두
// catalog가 주고 화면 코드에는 model 이름도 option 값도 없다. 목록은 열 때마다 다시 읽어 Manage models 창에서 바꾼 것이 보이게 한다.
import { useRef, useState } from "react";
import { t } from "@lophn/wording";

import type { AgentValueLayer } from "../../../../../protocol/lophn-agent/agent-definitions.ts";
import type { ModelChoice } from "../../../../../protocol/lophn-agent/models.ts";
import { ModelPickerField } from "../../../conversation/model-picker/model-picker.tsx";
import type { ModelPickerProps } from "../../../conversation/model-picker/types.ts";
import { pickerProps } from "../model-picker-data.ts";
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
  /** "Use project default — Haiku 5.5" 같은 따르기 줄의 글. */
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

/** 위 층이 없는 model 칸(Workspace 전역 기본). model과 그 model의 option 축을 고른다. */
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
