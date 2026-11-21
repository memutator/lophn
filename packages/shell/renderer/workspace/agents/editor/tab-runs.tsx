// Runs on 탭(무엇으로 도나): runtime(lophn·custom·harness), model, 받고 내는 것. harness는 자기 model과 effort로 돌아서
// model 칸 대신 그렇다는 한 줄이 선다.
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
import { ModalityToggles } from "./modality-toggles.tsx";
import { ModelField, type ModelFieldSource } from "./model-field.tsx";
import { runtimeLabel } from "../agent-glance.tsx";
import styles from "./agent-editor.module.css";

interface RunsTabProps extends FormProps {
  readonly facts: AgentFacts;
  readonly models: ModelsView | null;
  /** Model 칸이 목록을 다시 읽는 통로. */
  readonly source: ModelFieldSource;
}

export function RunsTab(props: RunsTabProps) {
  const { detail, definition, facts, models, onChange } = props;
  const { lophn, coding, runtime, harness } = facts;
  const issues = (name: Parameters<typeof issuesOf>[1]) =>
    issuesOf(props.issues, name);

  const harnessOptions = (["claude-code", "codex", "opencode"] as const).map(
    (one) => ({
      value: one,
      label: t(`agents.label.runtime-${one}`),
    }),
  );
  const runtimeOptions = [
    { value: "lophn", label: t("agents.label.runtime-lophn") },
    { value: "custom", label: t("agents.label.runtime-custom") },
    ...harnessOptions,
  ].map((one) => ({ ...one, disabled: coding }));
  // lophn에서는 tools와 skills를 쓰지 못해(저장 거절) lophn으로 돌아가면 함께 지운다. 기본값이라 runtime 칸도 지운다.
  const setRuntime = (picked: string) => {
    const next: Record<string, unknown> = { ...definition };
    if (picked === "custom" || isHarnessRuntime(picked as never)) {
      next.runtime = picked;
      if (picked !== "custom") {
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

      {harness ? (
        <Group
          name="model"
          heading={t("project-workspace.heading.agent-editor-model")}
        >
          <p className={styles.note} data-own="model">
            {t("agents.notice.own-model", { runtime: runtimeLabel(runtime) })}
          </p>
        </Group>
      ) : (
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

      <Group name="modality" heading={t("agents.heading.modality")}>
        <ModalityToggles
          definition={definition}
          onChange={(modality) =>
            onChange(withField(definition, "modality", modality))
          }
        />
        <p className={styles.note}>{t("agents.notice.modality-help")}</p>
        <Issues issues={issues("modality")} />
      </Group>
    </div>
  );
}
