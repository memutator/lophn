// workflow 화면의 새 run 칸. 입력 글을 적고 [Start]를 누르면 run이 시작된다. flow는 입력 글만 받고,
// step이 여럿인 agent workflow는 시작할 step을 고를 수 있다(기본은 첫 step).
// 선언적 `inputs`가 있으면 InputsForm을 함께 그리고 제출 직전에 core와 같은 규칙으로 검증한다.
// 시작이 실패하면 적은 글을 지키고(알림은 탭 위쪽 toast), 성공하면 비운다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, SegmentedControl, Select, Textarea } from "@lophn/ui/input";
import { Tooltip } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import {
  resolveInputDefaults,
  validateWorkflowInputs,
} from "../../../protocol/workflows/inputs.ts";
import { actionIcons } from "../icons/mod.ts";
import type {
  CallableAgentOptionView,
  WorkflowEntryView,
} from "../workspace/source.ts";
import { InputsForm } from "./inputs-form.tsx";
import { workflowProblemText } from "./model.ts";
import styles from "./start-box.module.css";

type SessionOpenMode = "tab" | "background";

export function StartBox({
  entry,
  callableAgents = [],
  onStart,
}: {
  entry: WorkflowEntryView;
  callableAgents?: readonly CallableAgentOptionView[];
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
  const declarations = entry.inputs;
  const hasInputs =
    declarations !== undefined && Object.keys(declarations).length > 0;
  const [text, setText] = useState("");
  const [step, setStep] = useState(steps[0]?.name ?? "");
  const [flowOpen, setFlowOpen] = useState<"default" | SessionOpenMode>(
    "default",
  );
  const [stepOpenOverrides, setStepOpenOverrides] = useState<
    Record<string, SessionOpenMode>
  >({});
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    declarations === undefined ? {} : resolveInputDefaults(declarations),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resetCount, setResetCount] = useState(0);
  const [starting, setStarting] = useState(false);
  const ready = entry.startable && text.trim() !== "" && !starting;

  const displayedValues =
    declarations === undefined
      ? values
      : resolveInputDefaults(declarations, values);

  const changeInput = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (prev[key] === undefined) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const effectiveStepOpen = (
    item: NonNullable<WorkflowEntryView["steps"]>[number],
  ): SessionOpenMode =>
    stepOpenOverrides[item.name] ?? item.open ?? "background";

  const toggleStepOpen = (
    item: NonNullable<WorkflowEntryView["steps"]>[number],
  ) => {
    const base: SessionOpenMode = item.open ?? "background";
    const next: SessionOpenMode =
      effectiveStepOpen(item) === "tab" ? "background" : "tab";
    setStepOpenOverrides((prev) => {
      const updated = { ...prev };
      if (next === base) delete updated[item.name];
      else updated[item.name] = next;
      return updated;
    });
  };

  const start = () => {
    if (!ready) return;
    let normalizedInputs: Record<string, unknown> | undefined;
    if (hasInputs && declarations !== undefined) {
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
    void onStart(text, isFlow ? undefined : step, normalizedInputs, options)
      .then((started) => {
        if (started) {
          setText("");
          setFlowOpen("default");
          setStepOpenOverrides({});
          setValues(
            declarations === undefined
              ? {}
              : resolveInputDefaults(declarations),
          );
          setErrors({});
          setResetCount((count) => count + 1);
        }
      })
      .finally(() => setStarting(false));
  };
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
      {hasInputs && declarations !== undefined ? (
        <div className={styles.inputs}>
          <InputsForm
            key={resetCount}
            declarations={declarations}
            values={displayedValues}
            errors={errors}
            callableAgents={callableAgents}
            disabled={!entry.startable || starting}
            onChange={changeInput}
          />
        </div>
      ) : null}
      {isFlow ? (
        <div className={styles.openModes} data-session-open-mode="">
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
                { value: "tab", label: t("workflow.label.session-open-tab") },
                {
                  value: "background",
                  label: t("workflow.label.session-open-background"),
                },
              ]}
              onValueChange={(value) =>
                setFlowOpen(value as "default" | SessionOpenMode)
              }
            />
          </Field>
        </div>
      ) : steps.length > 0 ? (
        <div className={styles.openModes} data-session-open-steps="">
          <Field
            label={t("workflow.label.session-open")}
            help={t("workflow.note.session-open-steps")}
          >
            <div className={styles.stepOpenList}>
              {steps.map((item) => {
                const mode = effectiveStepOpen(item);
                return (
                  <button
                    key={item.name}
                    type="button"
                    className={styles.stepOpenChip}
                    data-step-open={mode}
                    data-step-name={item.name}
                    disabled={!entry.startable || starting}
                    aria-pressed={mode === "tab"}
                    onClick={() => toggleStepOpen(item)}
                  >
                    <span className={styles.stepOpenName}>{item.name}</span>
                    <span className={styles.stepOpenBadge}>
                      {mode === "tab"
                        ? t("workflow.label.session-open-tab")
                        : t("workflow.label.session-open-background")}
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      ) : null}
      <div className={styles.row}>
        {isFlow || steps.length < 2 ? null : (
          <div className={styles.step}>
            <Field label={t("workflow.label.first-step")}>
              <Select
                value={step}
                onValueChange={setStep}
                options={steps.map((item) => ({
                  value: item.name,
                  label: item.name,
                }))}
              />
            </Field>
          </div>
        )}
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
