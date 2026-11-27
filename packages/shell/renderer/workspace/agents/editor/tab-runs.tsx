// Runs on 탭(무엇으로 도나): runtime(lophn·custom·즐겨찾기 harness), model(lophn은 provider picker, harness는 CLI catalog picker),
// 받고 내는 것. 즐겨찾기 밖 지원 harness는 보조 menu로 고를 수 있고, 이미 저장된 runtime은 즐겨찾기에서 빠져도 보존한다.
import { t } from "@lophn/i18n";
import { SegmentedControl } from "@lophn/ui/input";
import { Menu, MenuIcon } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";

import type { GuiHarness } from "../../../../../protocol/coding-agent/gui-harness.ts";
import { HARNESS_ADAPTER_OF_RUNTIME } from "../../../../../protocol/coding-agent/harness-adapter.ts";
import type { HarnessId } from "../../../../../protocol/coding-agent/harness-id.ts";
import {
  HARNESS_RUNTIMES,
  type HarnessRuntime,
  isHarnessRuntime,
} from "../../../../../protocol/lophn-agent/agent-values.ts";
import { CODING_BUILTINS } from "../../../../../protocol/lophn-agent/workspaces.ts";
import { useFollowedRead } from "../../../desktop/connection/core-read.ts";
import { DEFAULT_CODING_PREFS } from "../../../desktop/settings/connections/prefs.ts";
import { commonIcons } from "../../../icons/mod.ts";
import {
  VendorIcon,
  vendorOf,
} from "../../../parts/vendor-icon/vendor-icon.tsx";
import { runtimeLabel } from "../agent-glance.tsx";
import type {
  AgentDraft,
  AgentsSource,
  CodingChoices,
  ModelsView,
} from "../source.ts";
import styles from "./agent-editor.module.css";
import {
  type AgentFacts,
  type FormProps,
  issuesOf,
  withField,
} from "./editor-model.ts";
import { Group, Issues } from "./form-kit.tsx";
import { ModalityToggles } from "./modality-toggles.tsx";
import {
  HarnessModelField,
  type HarnessModelFieldSource,
  ModelField,
  type ModelFieldSource,
} from "./model-field.tsx";

type RunsTabSource = ModelFieldSource &
  HarnessModelFieldSource &
  Pick<AgentsSource, "codingChoices">;

interface RunsTabProps extends FormProps {
  readonly facts: AgentFacts;
  readonly models: ModelsView | null;
  readonly workspace: string | null;
  /** Model 칸과 runtime 즐겨찾기·harness catalog를 읽는 통로. */
  readonly source: RunsTabSource;
}

const RUNTIME_OF_HARNESS: Readonly<Partial<Record<HarnessId, HarnessRuntime>>> =
  Object.fromEntries(
    CODING_BUILTINS.map((builtin) => [builtin.harness, builtin.runtime]),
  );

function harnessOfRuntime(runtime: HarnessRuntime): GuiHarness {
  return HARNESS_ADAPTER_OF_RUNTIME[runtime];
}

/**
 * 기본 runtime 선택지: 즐겨찾기한 지원 harness(즐겨찾기 순) + 지금 저장된 runtime이 즐겨찾기 밖이어도 보존한다.
 * 나머지 지원 harness는 감지된 것을 먼저 두고 보조 menu에 넣는다.
 */
function partitionHarnesses(
  choices: CodingChoices,
  current: AgentFacts["runtime"],
): {
  readonly primary: readonly HarnessRuntime[];
  readonly more: readonly HarnessRuntime[];
} {
  const primary: HarnessRuntime[] = [];
  for (const harness of choices.favorites) {
    const rt = RUNTIME_OF_HARNESS[harness];
    if (rt !== undefined && !primary.includes(rt)) primary.push(rt);
  }
  if (isHarnessRuntime(current) && !primary.includes(current)) {
    primary.push(current);
  }
  const rest = HARNESS_RUNTIMES.filter((rt) => !primary.includes(rt));
  const detectedSet = new Set(choices.detected);
  const more = [
    ...rest.filter((rt) => detectedSet.has(HARNESS_ADAPTER_OF_RUNTIME[rt])),
    ...rest.filter((rt) => !detectedSet.has(HARNESS_ADAPTER_OF_RUNTIME[rt])),
  ];
  return { primary, more };
}

const DEFAULT_CHOICES: CodingChoices = {
  favorites: DEFAULT_CODING_PREFS.favorites,
  detected: [],
};

export function RunsTab(props: RunsTabProps) {
  const { detail, definition, facts, models, workspace, onChange } = props;
  const { lophn, coding, runtime, harness } = facts;
  const issues = (name: Parameters<typeof issuesOf>[1]) =>
    issuesOf(props.issues, name);

  const choicesRead = useFollowedRead(
    () => props.source.codingChoices(),
    ["settings"],
    "",
  ).loaded;
  const choices =
    choicesRead.state === "ready" ? choicesRead.value : DEFAULT_CHOICES;
  const { primary, more } = partitionHarnesses(choices, runtime);

  const runtimeOptions = [
    { value: "lophn", label: t("agents.label.runtime-lophn") },
    { value: "custom", label: t("agents.label.runtime-custom") },
    ...primary.map((one) => ({
      value: one,
      label: runtimeLabel(one),
    })),
  ].map((one) => ({ ...one, disabled: coding }));

  // runtime을 바꾸면 새 runtime이 허용하지 않거나 뜻이 달라지는 칸(model, harness_config, tools, skills)을 함께 비운다.
  const setRuntime = (picked: string) => {
    if (picked === runtime) return;
    const next: Record<string, unknown> = { ...definition };
    if (isHarnessRuntime(picked as never)) {
      next.runtime = picked;
      delete next.model;
      delete next.tools;
      delete next.skills;
      delete next.harness_config;
    } else if (picked === "custom") {
      next.runtime = "custom";
      delete next.harness_config;
      delete next.open;
    } else {
      delete next.runtime;
      delete next.harness_config;
      delete next.open;
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
          {!coding && more.length > 0 ? (
            <div className={styles.runtimeMoreRow} data-more-harnesses="">
              <Menu
                trigger={
                  <Button
                    size="sm"
                    variant="ghost"
                    trailingIcon={commonIcons.collapse}
                    data-action="more-harnesses"
                  >
                    {t("agents.button.more-harnesses")}
                  </Button>
                }
                items={more.map((one) => {
                  const vendor = vendorOf(one);
                  return {
                    id: one,
                    label: runtimeLabel(one),
                    data: { "data-more-runtime": one },
                    ...(vendor === undefined
                      ? {}
                      : {
                          leading: (
                            <MenuIcon>
                              <VendorIcon vendor={vendor} size={14} />
                            </MenuIcon>
                          ),
                        }),
                  };
                })}
                onSelect={(id) => setRuntime(id)}
              />
              <span className={styles.note}>
                {t("agents.notice.runtime-favorites-help")}
              </span>
            </div>
          ) : null}
          <p className={styles.note}>
            {coding
              ? t("agents.notice.fixed-coding")
              : t("agents.notice.runtime-help")}
          </p>
          <Issues issues={issues("runtime")} />
        </Group>
      )}

      {harness && isHarnessRuntime(runtime) ? (
        <>
          <HarnessModelField
            runtime={runtime}
            harness={harnessOfRuntime(runtime)}
            workspace={workspace}
            source={props.source}
            value={definition.harness_config}
            onChange={(next) =>
              onChange(withField(definition, "harness_config", next))
            }
          />
          <Issues issues={issues("model")} />
          <Group name="open" heading={t("agents.heading.session-open")}>
            <SegmentedControl
              size="sm"
              label={t("agents.label.session-open")}
              value={definition.open ?? (coding ? "tab" : "background")}
              options={[
                { value: "tab", label: t("agents.label.session-open-tab") },
                {
                  value: "background",
                  label: t("agents.label.session-open-background"),
                },
              ]}
              onValueChange={(picked) => {
                const defaultOpen = coding ? "tab" : "background";
                onChange(
                  withField(
                    definition,
                    "open",
                    picked === defaultOpen ? undefined : picked,
                  ),
                );
              }}
            />
            <p className={styles.note}>
              {t("agents.notice.session-open-help")}
            </p>
            <Issues issues={issues("open")} />
          </Group>
        </>
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
