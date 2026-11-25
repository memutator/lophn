// workflow 화면의 새 run 칸. 입력 글 아래에 step들이 위에서 아래로 서고, step마다 그 step의 설정(그 step이 쓰는 입력, session을
// 탭으로 열지, 여기서 시작할지)이 접힌 채 붙는다. 서로 대신하는 step(같은 다음 step으로 가는 이웃)은 한 단계의 선택지로 보이고,
// 시작하는 단계에서 하나를 고르면 그 step에서 run이 시작된다. step에 붙지 않은 입력과 flow의 session 열기는 Run settings에 있다.
// 선언적 `inputs`는 제출 직전에 core와 같은 규칙으로 검증한다. 시작이 실패하면 적은 것을 지키고(알림은 탭 위쪽 toast), 성공하면 비운다.

import { t } from "@lophn/i18n";
import {
  Field,
  Input,
  SegmentedControl,
  Select,
  Textarea,
} from "@lophn/ui/input";
import { Tooltip } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";
import { type MouseEvent, type ReactNode, useState } from "react";

import {
  PERMISSION_MODES,
  type PermissionMode,
} from "../../../protocol/lophn-agent/turn-values.ts";
import {
  resolveInputDefaults,
  validateWorkflowInputs,
  type WorkflowInputField,
} from "../../../protocol/workflows/inputs.ts";
import { actionIcons, commonIcons } from "../icons/mod.ts";
import type {
  CallableAgentOptionView,
  WorkflowEntryView,
} from "../workspace/source.ts";
import { InputsForm, visibleInputKeys } from "./inputs-form.tsx";
import {
  assigneeText,
  cellsOfEntry,
  type FaceOf,
  formatInputValue,
  type StepCell,
  stagesOf,
  workflowProblemText,
} from "./model.ts";
import { Rail, RailStage } from "./rail.tsx";
import styles from "./start-box.module.css";
import type { ParticipantModeSpec } from "./use-workflow.ts";
import { WhoMark } from "./who.tsx";

type SessionOpenMode = "tab" | "background";
type EntryStep = NonNullable<WorkflowEntryView["steps"]>[number];

const RUN_PANEL = "run";

/** 접힌 설정 옆에 보이는 지금 값. select는 선택지의 label로 읽는다. */
function inputValueText(field: WorkflowInputField, value: unknown): string {
  const labelOf = (one: unknown): string => {
    const option = field.options?.find(
      (item) => (typeof item === "string" ? item : item.value) === one,
    );
    return option === undefined || typeof option === "string"
      ? formatInputValue(one)
      : (option.label ?? option.value);
  };
  return Array.isArray(value) ? value.map(labelOf).join(", ") : labelOf(value);
}

function StepLine({
  cell,
  faceOf,
}: {
  cell: StepCell;
  faceOf: FaceOf | undefined;
}) {
  return (
    <span className={styles.stepLine}>
      <WhoMark who={cell.who} faceOf={faceOf} />
      <span className={styles.stepText}>
        <span className={styles.stepName}>{cell.name}</span>
        <span className={styles.stepWho}>{assigneeText(cell, faceOf)}</span>
      </span>
    </span>
  );
}

/** 접었다 펴는 설정 칸의 머리 단추와 지금 값 요약. */
function SettingsToggle({
  summary,
  open,
  onToggle,
}: {
  summary: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <span className={styles.settings}>
      {open || summary === "" ? null : (
        <span className={styles.summary}>{summary}</span>
      )}
      <Button
        size="sm"
        variant="ghost"
        icon={commonIcons.settings}
        trailingIcon={open ? commonIcons.collapse : commonIcons.expand}
        aria-expanded={open}
        onClick={onToggle}
        data-settings-toggle=""
      >
        {t("workflow.button.settings")}
      </Button>
    </span>
  );
}

/** 선언 기본값과 현재 입력값이 같은지 비교한다. */
function sameInputDefault(
  field: WorkflowInputField,
  saved: unknown,
  current: unknown,
): boolean {
  if (field.type === "multiselect") {
    const left = Array.isArray(saved) ? saved : [];
    const right = Array.isArray(current) ? current : [];
    return (
      left.length === right.length &&
      left.every((item, index) => item === right[index])
    );
  }
  if (field.type === "boolean") {
    return (saved === true) === (current === true);
  }
  if (saved === undefined) {
    return current === undefined || current === "";
  }
  return Object.is(saved, current);
}

/** 기본값으로 저장할 값으로 정규화한다. 빈 값으로 지웠으면 null(default 삭제), 유효하지 않으면 undefined. */
function defaultPayloadFor(
  field: WorkflowInputField,
  current: unknown,
  callableAgents: readonly CallableAgentOptionView[],
): { valid: true; value: unknown } | { valid: false } {
  if (current === undefined || current === "") {
    if (field.type === "string" || field.type === "text") {
      return current === undefined
        ? { valid: true, value: null }
        : field.default === undefined
          ? { valid: false }
          : { valid: true, value: null };
    }
    return field.default === undefined
      ? { valid: false }
      : { valid: true, value: null };
  }
  const checked = validateWorkflowInputs(
    { field: { ...field, required: false, when: undefined } },
    { field: current },
    callableAgents.length > 0
      ? { callableAgents: new Set(callableAgents.map((item) => item.name)) }
      : {},
  );
  if (!checked.ok) return { valid: false };
  return { valid: true, value: checked.value["field"] ?? null };
}

export function StartBox({
  entry,
  callableAgents = [],
  participantModes = [],
  faceOf,
  onStart,
  onSaveDefault,
  onRememberModes,
}: {
  entry: WorkflowEntryView;
  callableAgents?: readonly CallableAgentOptionView[];
  participantModes?: readonly ParticipantModeSpec[];
  faceOf?: FaceOf;
  /** 성공하면 true. */
  onStart: (
    text: string,
    step: string | undefined,
    inputs: Record<string, unknown> | undefined,
    options?: {
      readonly title?: string;
      readonly open?: SessionOpenMode;
      readonly stepOpen?: Record<string, SessionOpenMode>;
      readonly participantModes?: Record<string, PermissionMode>;
    },
  ) => Promise<boolean>;
  /** 바뀐 항목 하나를 workflow.yaml 기본값으로 저장한다. */
  onSaveDefault?: (patch: {
    readonly default_step?: string | null;
    readonly open?: SessionOpenMode | null;
    readonly step_open?: Readonly<Record<string, SessionOpenMode | null>>;
    readonly inputs?: Readonly<Record<string, unknown>>;
  }) => Promise<boolean>;
  /** 참가자별 권한 단계를 `approvals.workflow_modes` 설정에 기억한다. */
  onRememberModes?: (
    modes: Readonly<Record<string, PermissionMode>>,
  ) => Promise<boolean>;
}) {
  const isFlow = entry.kind === "flow";
  const steps = entry.steps ?? [];
  const cells = cellsOfEntry(entry);
  const stages = stagesOf(steps);
  const declarations = entry.inputs ?? {};
  const inputKeys = Object.keys(declarations);
  const savedDefaults = resolveInputDefaults(declarations);
  const savedStartStep =
    entry.default_step !== undefined &&
    steps.some((item) => item.name === entry.default_step)
      ? entry.default_step
      : (steps[0]?.name ?? "");
  const savedFlowOpen: "default" | SessionOpenMode = entry.open ?? "default";

  // 입력은 `steps`가 가리키는 step이 있는 첫 단계에 붙는다. 가리키는 step이 없으면 run 전체의 설정이다.
  const panelOfInput = (key: string): string => {
    const named = declarations[key]?.steps ?? [];
    const stage = stages.findIndex((members) =>
      members.some((index) => named.includes(steps[index].name)),
    );
    return stage === -1 ? RUN_PANEL : String(stage);
  };
  const keysOfPanel = (panel: string) =>
    inputKeys.filter((key) => panelOfInput(key) === panel);

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [startStep, setStartStep] = useState(savedStartStep);
  const [flowOpen, setFlowOpen] = useState<"default" | SessionOpenMode>(
    savedFlowOpen,
  );
  const [stepOpenOverrides, setStepOpenOverrides] = useState<
    Record<string, SessionOpenMode>
  >({});
  const [modeOverrides, setModeOverrides] = useState<
    Record<string, PermissionMode>
  >({});
  const [rememberingModes, setRememberingModes] = useState(false);
  const [modesRemembered, setModesRemembered] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    resolveInputDefaults(declarations),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  // 처음에는 값을 꼭 채워야 하는 입력(보이는 required인데 기본값이 없다)이 있는 설정 칸만 열려 있다.
  const [openPanels, setOpenPanels] = useState<ReadonlySet<string>>(() => {
    const defaults = resolveInputDefaults(declarations);
    const shown = visibleInputKeys(declarations, defaults);
    return new Set(
      inputKeys
        .filter(
          (key) =>
            shown.has(key) &&
            declarations[key].required === true &&
            defaults[key] === undefined,
        )
        .map(panelOfInput),
    );
  });
  const [resetCount, setResetCount] = useState(0);
  const [starting, setStarting] = useState(false);
  const [savingDefaultKey, setSavingDefaultKey] = useState<string | null>(null);
  const ready = entry.startable && text.trim() !== "" && !starting;
  const locked = !entry.startable || starting;

  const displayedValues = resolveInputDefaults(declarations, values);
  const visible = visibleInputKeys(declarations, displayedValues);
  const startStage = Math.max(
    0,
    stages.findIndex((members) =>
      members.some((index) => steps[index].name === startStep),
    ),
  );

  const saveDefault = (
    key: string,
    patch: Parameters<NonNullable<typeof onSaveDefault>>[0],
    onSaved?: () => void,
  ) => {
    if (onSaveDefault === undefined || savingDefaultKey !== null) return;
    setSavingDefaultKey(key);
    void onSaveDefault(patch)
      .then((ok) => {
        if (ok) onSaved?.();
      })
      .finally(() => setSavingDefaultKey(null));
  };

  const defaultButton = (
    key: string,
    onClick: (event: MouseEvent<HTMLButtonElement>) => void,
  ) => {
    const busy = savingDefaultKey === key;
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled={locked || savingDefaultKey !== null}
        onClick={onClick}
        data-set-default={key}
      >
        {busy
          ? t("workflow.button.saving-default")
          : t("workflow.button.set-default")}
      </Button>
    );
  };

  const togglePanel = (panel: string) =>
    setOpenPanels((prev) => {
      const next = new Set(prev);
      if (!next.delete(panel)) next.add(panel);
      return next;
    });

  const changeInput = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (prev[key] === undefined) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const stepOpenOf = (item: EntryStep): SessionOpenMode =>
    stepOpenOverrides[item.name] ?? item.open ?? "background";

  const setStepOpen = (item: EntryStep, mode: SessionOpenMode) =>
    setStepOpenOverrides((prev) => {
      const updated = { ...prev };
      if (mode === (item.open ?? "background")) delete updated[item.name];
      else updated[item.name] = mode;
      return updated;
    });

  const openLabel = (mode: SessionOpenMode) =>
    t(
      mode === "tab"
        ? "workflow.label.session-open-tab"
        : "workflow.label.session-open-background",
    );

  const inputsSummary = (keys: readonly string[]): string[] =>
    keys
      .filter((key) => visible.has(key))
      .map((key) => {
        const value = inputValueText(declarations[key], displayedValues[key]);
        return value === ""
          ? ""
          : t("workflow.label.setting-value", {
              label: declarations[key].label ?? key,
              value,
            });
      })
      .filter((item) => item !== "");

  const renderInputAction = (key: string): ReactNode => {
    if (onSaveDefault === undefined) return null;
    const field = declarations[key];
    if (field === undefined) return null;
    const current = displayedValues[key];
    if (sameInputDefault(field, savedDefaults[key], current)) return null;
    const payload = defaultPayloadFor(field, current, callableAgents);
    if (!payload.valid) return null;
    return defaultButton(`input:${key}`, () =>
      saveDefault(`input:${key}`, { inputs: { [key]: payload.value } }, () => {
        setValues((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }),
    );
  };

  const inputsForm = (keys: readonly string[]): ReactNode =>
    keys.some((key) => visible.has(key)) ? (
      <InputsForm
        key={resetCount}
        declarations={declarations}
        values={displayedValues}
        errors={errors}
        callableAgents={callableAgents}
        disabled={locked}
        keys={keys}
        onChange={changeInput}
        renderFieldAction={renderInputAction}
      />
    ) : null;

  const start = () => {
    if (!ready) return;
    let normalizedInputs: Record<string, unknown> | undefined;
    if (inputKeys.length > 0) {
      const validated = validateWorkflowInputs(
        declarations,
        displayedValues,
        callableAgents.length > 0
          ? {
              callableAgents: new Set(callableAgents.map((item) => item.name)),
            }
          : {},
      );
      if (!validated.ok) {
        setErrors(validated.errors);
        // 틀린 칸이 접힌 설정 안에 있으면 보이게 연다.
        setOpenPanels(
          (prev) =>
            new Set([
              ...prev,
              ...Object.keys(validated.errors).map(panelOfInput),
            ]),
        );
        return;
      }
      setErrors({});
      normalizedInputs = validated.value;
    }
    const trimmedTitle = title.trim();
    const titleOption = trimmedTitle === "" ? undefined : trimmedTitle;
    const openOption = isFlow && flowOpen !== "default" ? flowOpen : undefined;
    const stepOpenOption =
      !isFlow && Object.keys(stepOpenOverrides).length > 0
        ? stepOpenOverrides
        : undefined;
    const participantModesOption =
      participantModes.length > 0
        ? Object.fromEntries(
            participantModes.map((item) => [
              item.key,
              modeOverrides[item.key] ?? item.mode,
            ]),
          )
        : undefined;
    const options =
      titleOption !== undefined ||
      openOption !== undefined ||
      stepOpenOption !== undefined ||
      participantModesOption !== undefined
        ? {
            ...(titleOption === undefined ? {} : { title: titleOption }),
            ...(openOption === undefined ? {} : { open: openOption }),
            ...(stepOpenOption === undefined
              ? {}
              : { stepOpen: stepOpenOption }),
            ...(participantModesOption === undefined
              ? {}
              : { participantModes: participantModesOption }),
          }
        : undefined;
    setStarting(true);
    void onStart(
      text,
      isFlow || startStep === "" ? undefined : startStep,
      normalizedInputs,
      options,
    )
      .then((started) => {
        if (started) {
          setTitle("");
          setText("");
          setStartStep(savedStartStep);
          setFlowOpen(savedFlowOpen);
          setStepOpenOverrides({});
          setValues(resolveInputDefaults(declarations));
          setErrors({});
          setOpenPanels(new Set());
          setResetCount((count) => count + 1);
        }
      })
      .finally(() => setStarting(false));
  };

  const runKeys = keysOfPanel(RUN_PANEL);
  const runPanelOpen = openPanels.has(RUN_PANEL);
  const hasRunSettings = isFlow || runKeys.some((key) => visible.has(key));
  const runSummary = [
    ...inputsSummary(runKeys),
    ...(isFlow && flowOpen !== "default" ? [openLabel(flowOpen)] : []),
  ].join(" · ");

  const button = (
    <Button
      variant="primary"
      icon={actionIcons.run}
      disabled={!ready}
      onClick={start}
      data-start=""
    >
      {t("workflow.button.start")}
    </Button>
  );

  return (
    <section className={styles.box} data-start-box="">
      <Field label={t("workflow.label.run-title")}>
        <Input
          value={title}
          placeholder={t("workflow.placeholder.run-title")}
          disabled={!entry.startable}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              start();
            }
          }}
        />
      </Field>
      <Field
        label={t("workflow.label.new-run")}
        help={t(
          isFlow ? "workflow.note.input-help-flow" : "workflow.note.input-help",
        )}
      >
        <Textarea
          rows={3}
          value={text}
          disabled={!entry.startable}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              start();
            }
          }}
        />
      </Field>
      {stages.length === 0 ? null : (
        <div className={styles.plan}>
          <span className={styles.planTitle}>{t("workflow.label.steps")}</span>
          <Rail label={t("workflow.label.steps")}>
            {stages.map((members, stage) => {
              const panel = String(stage);
              const open = openPanels.has(panel);
              const single = members.length === 1;
              const isStart = !isFlow && stage === startStage;
              const skipped = !isFlow && stage < startStage;
              // 시작하는 단계에서는 고른 선택지 하나만 돈다. 그 뒤 단계의 선택지는 앞 step이 run 중에 고른다.
              const active = members.filter(
                (index) =>
                  !isStart || single || steps[index].name === startStep,
              );
              const withSession = isFlow
                ? []
                : active.filter((index) => cells[index].who.kind !== "program");
              const keys = keysOfPanel(panel);
              const canStartHere = !isFlow && stages.length > 1 && !isStart;
              const hasPanel =
                keys.some((key) => visible.has(key)) ||
                withSession.length > 0 ||
                canStartHere;
              const summary = [
                ...inputsSummary(keys),
                ...(withSession.length === 1
                  ? [openLabel(stepOpenOf(steps[withSession[0]]))]
                  : []),
              ].join(" · ");
              return (
                <RailStage
                  key={steps[members[0]].name}
                  marker={stage + 1}
                  tone={isStart ? "start" : skipped ? "skipped" : "idle"}
                  data-stage={members
                    .map((index) => steps[index].name)
                    .join(" ")}
                  data-skipped={skipped ? "" : undefined}
                >
                  <div className={styles.stageHead}>
                    {single ? (
                      <StepLine cell={cells[members[0]]} faceOf={faceOf} />
                    ) : (
                      <span className={styles.choiceTitle}>
                        {t(
                          isStart
                            ? "workflow.label.choice-pick"
                            : "workflow.label.choice-one-of",
                        )}
                      </span>
                    )}
                    <span className={styles.stageSide}>
                      {skipped ? (
                        <span className={styles.badge}>
                          {t("workflow.label.step-skipped")}
                        </span>
                      ) : isStart && startStage > 0 ? (
                        <span className={styles.badge} data-tone="start">
                          {t("workflow.label.starts-here")}
                        </span>
                      ) : null}
                      {hasPanel ? (
                        <SettingsToggle
                          summary={skipped ? "" : summary}
                          open={open}
                          onToggle={() => togglePanel(panel)}
                        />
                      ) : null}
                    </span>
                  </div>
                  {single ? null : (
                    <div
                      className={styles.choices}
                      role={isStart ? "radiogroup" : "list"}
                      aria-label={t("workflow.label.choice-pick")}
                    >
                      {members.map((index) => {
                        const cell = cells[index];
                        return isStart ? (
                          <label
                            key={cell.name}
                            className={styles.choice}
                            data-choice={cell.name}
                            data-picked={
                              cell.name === startStep ? "" : undefined
                            }
                          >
                            <input
                              type="radio"
                              className={styles.choiceInput}
                              name={`start-${entry.key}-${stage}`}
                              checked={cell.name === startStep}
                              disabled={locked}
                              onChange={() => setStartStep(cell.name)}
                            />
                            <StepLine cell={cell} faceOf={faceOf} />
                            {onSaveDefault !== undefined &&
                            stage === 0 &&
                            cell.name === startStep &&
                            startStep !== savedStartStep ? (
                              <span className={styles.choiceAction}>
                                {defaultButton(
                                  `default_step:${cell.name}`,
                                  (event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    saveDefault(`default_step:${cell.name}`, {
                                      default_step: cell.name,
                                    });
                                  },
                                )}
                              </span>
                            ) : null}
                          </label>
                        ) : (
                          <div
                            key={cell.name}
                            className={styles.choice}
                            role="listitem"
                            data-choice={cell.name}
                          >
                            <StepLine cell={cell} faceOf={faceOf} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {open && hasPanel ? (
                    <div className={styles.panel} data-settings-panel={panel}>
                      {inputsForm(keys)}
                      {withSession.map((index) => (
                        <div key={steps[index].name} data-step-open-of="">
                          <Field
                            label={
                              withSession.length === 1
                                ? t("workflow.label.step-session")
                                : t("workflow.label.step-session-of", {
                                    step: steps[index].name,
                                  })
                            }
                            help={t("workflow.note.step-session")}
                          >
                            <div className={styles.controlRow}>
                              <SegmentedControl
                                size="sm"
                                label={t("workflow.label.step-session")}
                                value={stepOpenOf(steps[index])}
                                options={[
                                  { value: "tab", label: openLabel("tab") },
                                  {
                                    value: "background",
                                    label: openLabel("background"),
                                  },
                                ].map((option) => ({
                                  ...option,
                                  disabled: locked,
                                }))}
                                onValueChange={(value) =>
                                  setStepOpen(
                                    steps[index],
                                    value as SessionOpenMode,
                                  )
                                }
                              />
                              {onSaveDefault !== undefined &&
                              stepOpenOverrides[steps[index].name] !== undefined
                                ? defaultButton(
                                    `step_open:${steps[index].name}`,
                                    () => {
                                      const stepName = steps[index].name;
                                      const mode = stepOpenOverrides[stepName];
                                      if (mode === undefined) return;
                                      saveDefault(
                                        `step_open:${stepName}`,
                                        { step_open: { [stepName]: mode } },
                                        () => {
                                          setStepOpenOverrides((prev) => {
                                            const next = { ...prev };
                                            delete next[stepName];
                                            return next;
                                          });
                                        },
                                      );
                                    },
                                  )
                                : null}
                            </div>
                          </Field>
                        </div>
                      ))}
                      {canStartHere ? (
                        <div className={styles.panelRow}>
                          <span className={styles.panelNote}>
                            {t("workflow.note.start-here")}
                          </span>
                          <span className={styles.actions}>
                            <Button
                              size="sm"
                              icon={actionIcons.run}
                              disabled={locked}
                              onClick={() =>
                                setStartStep(steps[members[0]].name)
                              }
                              data-start-here=""
                            >
                              {t("workflow.button.start-here")}
                            </Button>
                          </span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </RailStage>
              );
            })}
          </Rail>
        </div>
      )}
      {hasRunSettings ? (
        <div className={styles.runSettings} data-run-settings="">
          <div className={styles.stageHead}>
            <span className={styles.runSettingsTitle}>
              {t("workflow.label.run-settings")}
            </span>
            <span className={styles.stageSide}>
              <SettingsToggle
                summary={runSummary}
                open={runPanelOpen}
                onToggle={() => togglePanel(RUN_PANEL)}
              />
            </span>
          </div>
          {runPanelOpen ? (
            <div className={styles.panel} data-settings-panel={RUN_PANEL}>
              {inputsForm(runKeys)}
              {isFlow ? (
                <div data-session-open-mode="">
                  <Field
                    label={t("workflow.label.session-open")}
                    help={t("workflow.note.session-open-flow")}
                  >
                    <div className={styles.controlRow}>
                      <SegmentedControl
                        size="sm"
                        label={t("workflow.label.session-open")}
                        value={flowOpen}
                        options={[
                          {
                            value: "default",
                            label: t("workflow.label.session-open-default"),
                          },
                          { value: "tab", label: openLabel("tab") },
                          {
                            value: "background",
                            label: openLabel("background"),
                          },
                        ].map((option) => ({ ...option, disabled: locked }))}
                        onValueChange={(value) =>
                          setFlowOpen(value as "default" | SessionOpenMode)
                        }
                      />
                      {onSaveDefault !== undefined && flowOpen !== savedFlowOpen
                        ? defaultButton("open", () =>
                            saveDefault("open", {
                              open: flowOpen === "default" ? null : flowOpen,
                            }),
                          )
                        : null}
                    </div>
                  </Field>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {participantModes.length > 0 ? (
        <div className={styles.runSettings} data-participant-modes="">
          <div className={styles.stageHead}>
            <span className={styles.runSettingsTitle}>
              {t("workflow.heading.participant-modes")}
            </span>
            {onRememberModes === undefined ? null : (
              <span className={styles.stageSide}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={locked || rememberingModes}
                  data-remember-modes=""
                  onClick={() => {
                    const current = Object.fromEntries(
                      participantModes.map((item) => [
                        item.key,
                        modeOverrides[item.key] ?? item.mode,
                      ]),
                    );
                    setRememberingModes(true);
                    setModesRemembered(false);
                    void onRememberModes(current)
                      .then((ok) => {
                        if (ok) {
                          setModeOverrides({});
                          setModesRemembered(true);
                        }
                      })
                      .finally(() => setRememberingModes(false));
                  }}
                >
                  {rememberingModes
                    ? t("workflow.button.remembering-modes")
                    : t("workflow.button.remember-modes")}
                </Button>
              </span>
            )}
          </div>
          <div className={styles.panel}>
            <p className={styles.panelNote}>
              {t("workflow.note.participant-modes")}
            </p>
            <div className={styles.modeList}>
              {participantModes.map((item) => {
                const value = modeOverrides[item.key] ?? item.mode;
                const label =
                  item.label !== item.key
                    ? `${item.key} (${item.label})`
                    : item.key;
                return (
                  <div
                    key={item.key}
                    className={styles.modeRow}
                    data-participant-mode={item.key}
                  >
                    <Field label={label}>
                      <Select
                        disabled={locked}
                        value={value}
                        options={PERMISSION_MODES.map((mode) => ({
                          value: mode,
                          label: t(`settings.label.mode-${mode}`),
                        }))}
                        onValueChange={(next) => {
                          setModesRemembered(false);
                          setModeOverrides((prev) => ({
                            ...prev,
                            [item.key]: next as PermissionMode,
                          }));
                        }}
                      />
                    </Field>
                  </div>
                );
              })}
            </div>
            {modesRemembered ? (
              <p className={styles.panelNote} data-modes-remembered="">
                {t("workflow.notice.modes-remembered")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className={styles.row}>
        <span className={styles.actions}>
          {entry.startable ? (
            button
          ) : (
            <Tooltip
              content={
                entry.problem === null ? "" : workflowProblemText(entry.problem)
              }
            >
              <span className={styles.tipTarget} tabIndex={0} data-start-tip="">
                {button}
              </span>
            </Tooltip>
          )}
        </span>
      </div>
    </section>
  );
}
