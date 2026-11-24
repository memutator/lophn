// workflow 화면의 새 run 칸. 입력 글 아래에 step들이 위에서 아래로 서고, step마다 그 step의 설정(그 step이 쓰는 입력, session을
// 탭으로 열지, 여기서 시작할지)이 접힌 채 붙는다. 서로 대신하는 step(같은 다음 step으로 가는 이웃)은 한 단계의 선택지로 보이고,
// 시작하는 단계에서 하나를 고르면 그 step에서 run이 시작된다. step에 붙지 않은 입력과 flow의 session 열기는 Run settings에 있다.
// 선언적 `inputs`는 제출 직전에 core와 같은 규칙으로 검증한다. 시작이 실패하면 적은 것을 지키고(알림은 탭 위쪽 toast), 성공하면 비운다.
import { type ReactNode, useState } from "react";
import { Field, SegmentedControl, Textarea } from "@lophn/ui/input";
import { Tooltip } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

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

export function StartBox({
  entry,
  callableAgents = [],
  faceOf,
  onStart,
}: {
  entry: WorkflowEntryView;
  callableAgents?: readonly CallableAgentOptionView[];
  faceOf?: FaceOf;
  /** 성공하면 true. */
  onStart: (
    text: string,
    step: string | undefined,
    inputs: Record<string, unknown> | undefined,
    options?: {
      readonly open?: SessionOpenMode;
      readonly stepOpen?: Record<string, SessionOpenMode>;
    },
  ) => Promise<boolean>;
}) {
  const isFlow = entry.kind === "flow";
  const steps = entry.steps ?? [];
  const cells = cellsOfEntry(entry);
  const stages = stagesOf(steps);
  const declarations = entry.inputs ?? {};
  const inputKeys = Object.keys(declarations);

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

  const [text, setText] = useState("");
  const [startStep, setStartStep] = useState(steps[0]?.name ?? "");
  const [flowOpen, setFlowOpen] = useState<"default" | SessionOpenMode>(
    "default",
  );
  const [stepOpenOverrides, setStepOpenOverrides] = useState<
    Record<string, SessionOpenMode>
  >({});
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
    const openOption = isFlow && flowOpen !== "default" ? flowOpen : undefined;
    const stepOpenOption =
      !isFlow && Object.keys(stepOpenOverrides).length > 0
        ? stepOpenOverrides
        : undefined;
    const options =
      openOption !== undefined || stepOpenOption !== undefined
        ? {
            ...(openOption === undefined ? {} : { open: openOption }),
            ...(stepOpenOption === undefined
              ? {}
              : { stepOpen: stepOpenOption }),
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
          setText("");
          setStartStep(steps[0]?.name ?? "");
          setFlowOpen("default");
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
                        { value: "background", label: openLabel("background") },
                      ].map((option) => ({ ...option, disabled: locked }))}
                      onValueChange={(value) =>
                        setFlowOpen(value as "default" | SessionOpenMode)
                      }
                    />
                  </Field>
                </div>
              ) : null}
            </div>
          ) : null}
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
