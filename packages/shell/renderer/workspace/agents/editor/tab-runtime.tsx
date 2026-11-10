// Runtime 탭: runtime(lophn·bare·harness)과 model. harness는 자기 model을 써서 model 칸이 없다.
import { SegmentedControl } from "@lophn/ui/input";
import { t } from "@lophn/i18n";

import { isHarnessRuntime } from "../../../../../protocol/lophn-agent/agent-values.ts";
import type { AgentDraft, ModelsView } from "../source.ts";
import {
  type AgentFacts,
  type FormProps,
  issuesOf,
  withField,
} from "./editor-model.ts";
import { Group, Issues } from "./form-kit.tsx";
import { ModelField, type ModelFieldSource } from "./model-field.tsx";
import styles from "./agent-editor.module.css";

interface RuntimeTabProps extends FormProps {
  readonly facts: AgentFacts;
  readonly models: ModelsView | null;
  /** Model 칸이 목록을 다시 읽는 통로. */
  readonly source: ModelFieldSource;
}

export function RuntimeTab(props: RuntimeTabProps) {
  const { detail, definition, facts, models, onChange } = props;
  const { lophn, coding, runtime, harness } = facts;
  const issues = (name: Parameters<typeof issuesOf>[1]) =>
    issuesOf(props.issues, name);

  // harness 값은 설정 `extensions.harness.enabled`가 켜졌을 때만 고르게 한다. 이미 harness인 agent는 꺼져 있어도 그 값을 보인다.
  const harnessOptions = (["claude-code", "codex", "opencode"] as const)
    .filter((one) => detail.harnessEnabled || one === runtime)
    .map((one) => ({
      value: one,
      label: t(`agents.label.runtime-${one}`),
    }));
  const runtimeOptions = [
    { value: "lophn", label: t("agents.label.runtime-lophn") },
    { value: "bare", label: t("agents.label.runtime-bare") },
    ...harnessOptions,
  ].map((one) => ({ ...one, disabled: coding }));
  // lophn에서는 tools와 skills를 쓰지 못해(저장 거절) lophn으로 돌아가면 함께 지운다. 기본값이라 runtime 칸도 지운다.
  const setRuntime = (picked: string) => {
    const next: Record<string, unknown> = { ...definition };
    if (picked === "bare" || isHarnessRuntime(picked as never)) {
      next.runtime = picked;
      if (picked !== "bare") {
        delete next.tools;
        delete next.skills;
      }
    } else {
      delete next.runtime;
      delete next.tools;
      delete next.skills;
    }
    onChange(next as unknown as AgentDraft);
  };

  // 위 층이 정한 값을 따를 때 보이는 따르기 선택지.
  const inherited = detail.inheritedModel;
  const layer = inherited?.source === "project" ? "project" : "global";
  const inheritLabel =
    inherited === null
      ? t("project-workspace.label.agent-editor-model-unset")
      : t("agents.label.model-inherit", {
          layer,
          model: inherited.value.model_name,
        });

  return (
    <div className={styles.form}>
      {lophn ? null : (
        <Group name="runtime" heading={t("agents.heading.runtime")}>
          <SegmentedControl
            size="sm"
            label={t("agents.label.runtime")}
            value={runtime}
            options={runtimeOptions}
            onValueChange={setRuntime}
          />
          <p className={styles.note}>
            {coding
              ? t("agents.notice.fixed-coding")
              : t("agents.notice.runtime-help")}
          </p>
          <Issues issues={issues("runtime")} />
        </Group>
      )}

      {harness ? null : (
        <div className={styles.group} data-field="model">
          <ModelField
            models={models}
            source={props.source}
            label={t("project-workspace.heading.agent-editor-model")}
            inheritLabel={inheritLabel}
            inherited={inherited?.value ?? null}
            value={definition.model ?? null}
            layer={
              definition.model === undefined
                ? (inherited?.source ?? null)
                : "agent"
            }
            overrideNote={t("agents.label.model-overrides", { layer })}
            onChange={(choice) =>
              onChange(withField(definition, "model", choice ?? undefined))
            }
          />
          <Issues issues={issues("model")} />
          <p className={styles.note}>
            {t("project-workspace.notice.agent-editor-model-help")}
          </p>
        </div>
      )}
    </div>
  );
}
