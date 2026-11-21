// agent 정의를 네 묶음(누구, 무엇으로 도나, 무엇을 보나, 어떻게 일하나)으로 보이는 조각. 목록 카드 앞면과 editor의 Overview가 같이 쓴다.
// 값은 core가 준 행·명함·요약 그대로이고, runtime이 자기 것을 쓰는 칸(harness의 model·tool·skill·memory)은 숨기지 않고 "its own"으로 보인다.
import { t } from "@lophn/i18n";
import { Fragment, type ReactElement, type ReactNode } from "react";

import {
  type AgentRuntime,
  isHarnessRuntime,
} from "../../../../protocol/lophn-agent/agent-values.ts";
import type { ModelChoice } from "../../../../protocol/lophn-agent/models.ts";
import { isLophn } from "../../../../protocol/lophn-agent/workspaces.ts";
import { ProfileMark } from "../../browser/browser-chrome.tsx";
import { useBrowserProfiles } from "../../browser/profiles.tsx";
import { VendorIcon, vendorOf } from "../../parts/vendor-icon/vendor-icon.tsx";
import { scopeLabel } from "./agent-card.tsx";
import { modelLabelOf } from "./model-picker-data.ts";
import type { AgentListRow, ModelsView } from "./source.ts";
import styles from "./agent-glance.module.css";

/** custom이 memory를 쓰려면 이 tool을 골라야 한다(`architecture/agent-definition.md`의 memory). */
export const MEMORY_TOOL = "agent.memory";

export const runtimeLabel = (runtime: AgentRuntime): string =>
  t(`agents.label.runtime-${runtime}`);

/** runtime 이름. harness는 그 제품의 vendor 아이콘을 앞에 붙인다. */
export function RuntimeName({
  runtime,
}: {
  runtime: AgentRuntime;
}): ReactElement {
  const vendor = isHarnessRuntime(runtime) ? vendorOf(runtime) : undefined;
  return (
    <span className={styles.withIcon} data-runtime={runtime}>
      {vendor === undefined ? null : <VendorIcon vendor={vendor} size={14} />}
      {runtimeLabel(runtime)}
    </span>
  );
}

/** model과 option 값("Sonnet 5.5 · High"). provider의 vendor 아이콘을 앞에 붙인다. */
export function ModelName({
  choice,
  models,
}: {
  choice: ModelChoice;
  models: ModelsView | null;
}): ReactElement {
  const definition = models?.providers.find(
    (one) => one.id === choice.provider,
  )?.definition;
  const vendor = definition === undefined ? undefined : vendorOf(definition);
  return (
    <span className={styles.withIcon} data-model="">
      {vendor === undefined ? null : <VendorIcon vendor={vendor} size={14} />}
      {modelLabelOf(models)(choice)}
    </span>
  );
}

/**
 * 값 조각들을 잇는다. 조각 안에서는 줄을 바꾸지 않는다. 가운뎃점(dot)은 한 줄에 드는 짧은 묶음(runtime · model)에,
 * 쉼표(comma)는 좁으면 줄을 바꾸는 목록에 쓴다: 쉼표는 앞 조각에 붙어 바뀐 줄이 구분자로 시작하지 않는다.
 */
export function Bits({
  items,
  join = "dot",
}: {
  items: readonly (ReactNode | null)[];
  join?: "dot" | "comma";
}): ReactElement {
  const shown = items.filter((one) => one !== null && one !== false);
  if (shown.length === 0) {
    return <span className={styles.dot}>{t("agents.label.value-none")}</span>;
  }
  return (
    <span className={styles.bits}>
      {shown.map((item, at) => (
        <Fragment key={at}>
          {at === 0 || join === "comma" ? null : (
            <span className={styles.dot} aria-hidden="true">
              ·
            </span>
          )}
          <span className={styles.bit}>
            {item}
            {join === "comma" && at < shown.length - 1 ? "," : null}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/** 이름 칸과 값 칸 한 줄. 카드와 Overview가 같은 열 맞춤을 쓴다. */
export function GlanceRow({
  name,
  label,
  children,
}: {
  name: string;
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className={styles.row} data-glance={name}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>{children}</dd>
    </div>
  );
}

type MemoryState = "workspace" | "on" | "off";

function memoryState(row: AgentListRow, runtime: AgentRuntime): MemoryState {
  if (isLophn(row.assignment)) return "workspace";
  if (runtime !== "custom") return "on";
  return row.glance?.tools.includes(MEMORY_TOOL) ? "on" : "off";
}

/**
 * 카드 앞면의 세 줄: Runs on, Sees, Works how. 누구(avatar, 이름, 역할 한 줄)는 카드 머리가 보인다.
 * workspaceName은 범위 표시에 쓰는 이름이다(Home 목록의 범위 agent는 자기 workspace의 이름).
 */
export function CardGlance({
  row,
  models,
  workspaceName,
}: {
  row: AgentListRow;
  models: ModelsView | null;
  workspaceName: string;
}): ReactElement {
  const profile = useBrowserProfiles().find(
    (one) => one.id === row.browserProfile,
  );
  const runtime = row.card?.runtime ?? "lophn";
  const harness = isHarnessRuntime(runtime);
  const glance = row.glance;
  // 틀린 정의 file(이나 읽지 못한 정의)은 셀 것이 없어 그렇다는 한 줄이다.
  if (glance === undefined) {
    return (
      <p className={styles.unread} data-card-glance="unread">
        {t("project-workspace.label.agent-counts-unknown")}
      </p>
    );
  }
  // 범위는 범위 agent만 보인다(전역이 보통이다). lophn은 머리의 역할 줄이 자기 workspace를 말한다.
  const scope =
    row.workspace === null || isLophn(row.assignment)
      ? null
      : scopeLabel(row.workspace, workspaceName);

  return (
    <dl className={styles.glance} data-card-glance="">
      <GlanceRow name="runs" label={t("agents.label.tab-runs")}>
        <Bits
          items={[
            <RuntimeName key="runtime" runtime={runtime} />,
            harness ? (
              t("agents.label.own-model")
            ) : glance.model === null ? (
              t("project-workspace.label.agent-no-model")
            ) : (
              <ModelName key="model" choice={glance.model} models={models} />
            ),
          ]}
        />
      </GlanceRow>
      <GlanceRow name="sees" label={t("agents.label.tab-sees")}>
        <Bits
          join="comma"
          items={[
            scope,
            profile === undefined ? null : (
              <span className={styles.withIcon} data-card-profile="">
                <ProfileMark profile={profile} />
                {profile.name}
              </span>
            ),
            glance.apps === 0
              ? null
              : t("agents.label.glance-apps", { count: glance.apps }),
            glance.remoteApps === 0
              ? null
              : t("agents.label.glance-remote-apps", {
                  count: glance.remoteApps,
                }),
            harness
              ? t("agents.label.glance-own-tools")
              : row.counts.mcp === null || row.counts.mcp === 0
                ? null
                : t("agents.label.glance-mcp", { count: row.counts.mcp }),
            runtime !== "custom"
              ? null
              : t("agents.label.glance-tools", { count: glance.tools.length }),
            glance.skip ? t("agents.label.glance-skip") : null,
          ]}
        />
      </GlanceRow>
      <GlanceRow name="works" label={t("agents.label.tab-works")}>
        <Bits
          join="comma"
          items={[
            t("agents.label.glance-instructions", {
              has: String(glance.instructions),
            }),
            harness
              ? t("agents.label.glance-own-skills")
              : t("agents.label.glance-skills", {
                  count: row.counts.skills ?? 0,
                }),
            harness
              ? null
              : t("agents.label.glance-memory", {
                  state: memoryState(row, runtime),
                }),
          ]}
        />
      </GlanceRow>
    </dl>
  );
}
