// Overview 탭: editor의 첫 화면. 정의를 네 묶음(Who, Runs on, Sees, Works how)의 절로 한 장에 보이고, 절마다 오른쪽 끝
// [Edit]이 그 묶음의 탭을 연다. 값은 편집 중인 정의 그대로라 다른 탭에서 바꾼 것이 저장 전에도 여기 보인다.
// runtime이 자기 것을 쓰는 칸은 "Uses its own"으로 남긴다.

import { t } from "@lophn/i18n";
import { Button } from "@lophn/ui/primitives";
import type { ReactNode } from "react";

import type { Modality } from "../../../../../protocol/lophn-agent/agent-values.ts";
import { workspaceOfLophn } from "../../../../../protocol/lophn-agent/workspaces.ts";
import { ProfileMark } from "../../../browser/browser-chrome.tsx";
import { useBrowserProfiles } from "../../../browser/profiles.tsx";
import { actionIcons } from "../../../icons/mod.ts";
import { Avatar, type AvatarLook } from "../../../parts/avatar/avatar.tsx";
import { modalityLabel, scopeLabel } from "../agent-card.tsx";
import glance from "../agent-glance.module.css";
import {
  GlanceRow,
  MEMORY_TOOL,
  ModelName,
  RuntimeName,
  runtimeLabel,
} from "../agent-glance.tsx";
import { formatHarnessModel } from "../model-picker-data.ts";
import type { ModelsView } from "../source.ts";
import styles from "./agent-editor.module.css";
import type { AgentFacts, FormProps, Group, Ready } from "./editor-model.ts";
import { ownServers } from "./tab-sees.tsx";

const ALL_MODALITIES: readonly Modality[] = ["text", "image", "file"];

const GROUP_LABEL = {
  who: "agents.label.tab-who",
  runs: "agents.label.tab-runs",
  sees: "agents.label.tab-sees",
  works: "agents.label.tab-works",
} as const;

/** 할당 앱의 이름. Overview가 Sees 절에 보인다. 읽는 중이거나 읽지 못했으면 그 상태다. */
export type AppNames =
  | { readonly state: "loading" | "failed" | "none" }
  | {
      readonly state: "ready";
      readonly local: readonly string[];
      readonly remote: readonly string[];
    };

interface OverviewTabProps extends FormProps {
  readonly facts: AgentFacts;
  readonly face: AvatarLook | null;
  readonly name: string;
  readonly models: ModelsView | null;
  readonly apps: AppNames;
  readonly copyOf: Ready["copyOf"];
  readonly onEdit: (group: Group) => void;
}

/** 글의 첫 문장 줄. 빈 줄과 markdown 제목 줄은 건너뛰고, 제목뿐이면 첫 제목의 글이다. 없으면 null이다. */
const firstLine = (text: string): string | null => {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return (
    lines.find((line) => !line.startsWith("#")) ??
    lines[0]?.replace(/^#+\s*/, "") ??
    null
  );
};

const list = (names: readonly string[]): string =>
  names.length === 0 ? t("agents.label.value-none") : names.join(", ");

function Section({
  group,
  onEdit,
  children,
}: {
  group: Group;
  onEdit: (group: Group) => void;
  children: ReactNode;
}) {
  const label = t(GROUP_LABEL[group]);
  return (
    <section className={styles.overviewSection} data-overview={group}>
      <div className={styles.overviewHead}>
        <h2 className={styles.overviewTitle}>{label}</h2>
        <Button
          size="sm"
          icon={actionIcons.edit}
          aria-label={t("agents.label.edit-group-named", { group: label })}
          onClick={() => onEdit(group)}
        >
          {t("agents.button.edit-group")}
        </Button>
      </div>
      {children}
    </section>
  );
}

/** 값 하나. 비었거나 runtime이 쓰지 않는 값은 흐린 글이다. */
const Muted = ({ children }: { children: ReactNode }) => (
  <span className={styles.muted}>{children}</span>
);

export function OverviewTab(props: OverviewTabProps) {
  const { detail, definition, facts, models, onEdit } = props;
  const { fresh, lophn, custom, harness } = facts;
  const own = (
    <Muted>
      {t("agents.label.value-own", { runtime: runtimeLabel(facts.runtime) })}
    </Muted>
  );
  const none = <Muted>{t("agents.label.value-none")}</Muted>;
  const profiles = useBrowserProfiles();
  const browser = profiles.find((one) => one.id === definition.browser_profile);
  const scope =
    detail.assignment !== null && lophn
      ? workspaceOfLophn(detail.assignment)
      : (definition.workspace ?? null);

  // 지금 model: 이 agent가 고른 것이 아니면 위 층이 준 것이다.
  const model = definition.model ?? detail.inheritedModel?.value ?? null;
  const harnessModel = harness
    ? formatHarnessModel(definition.harness_config)
    : null;
  const layer =
    definition.model !== undefined
      ? "agent"
      : (detail.inheritedModel?.source ?? "global");
  const price = detail.card?.model?.price ?? null;

  const mcpOff = (definition.mcp_off ?? []).map((entry) => entry.server_name);
  // 이름이 같은 server는 아래 층(agent)이 덮으므로 이름 하나로 보인다.
  const mcpOn = [
    ...new Set([
      ...detail.mcpServers
        .filter((row) => row.on && !mcpOff.includes(row.name))
        .map((row) => row.name),
      ...ownServers(definition, {})
        .filter((row) => row.on)
        .map((row) => row.name),
    ]),
  ];
  const skillsOff = definition.skills_off ?? [];
  const skillsOn = custom
    ? (definition.skills ?? [])
    : detail.skills
        .filter(
          (row) => row.on && (row.builtIn || !skillsOff.includes(row.name)),
        )
        .map((row) => row.name);
  const instructions = firstLine(definition.body);
  const memoryLine =
    detail.memory === null ? null : firstLine(detail.memory.text);
  const copiedApps =
    ((definition as { apps?: readonly unknown[] }).apps?.length ?? 0) +
    ((definition as { remote_apps?: readonly unknown[] }).remote_apps?.length ??
      0);

  const apps = props.apps;
  const appsValue = (side: "local" | "remote"): ReactNode =>
    fresh ? (
      copiedApps === 0 ? (
        <Muted>{t("agents.label.value-after-create")}</Muted>
      ) : (
        t("agents.label.value-copied-apps", { count: copiedApps })
      )
    ) : apps.state === "ready" ? (
      apps[side].length === 0 ? (
        none
      ) : (
        apps[side].join(", ")
      )
    ) : apps.state === "failed" ? (
      <Muted>{t("agents.label.value-unread")}</Muted>
    ) : (
      <Muted>…</Muted>
    );
  const hasRemote = apps.state === "ready" && !fresh && apps.remote.length > 0;

  return (
    <div className={styles.overview} data-agent-overview="">
      {props.copyOf === undefined ? null : (
        <p className={`${styles.note} ${styles.copyNote}`} data-copy-of="">
          {t("agents.notice.copy-draft", { name: props.copyOf.name })}
        </p>
      )}

      <Section group="who" onEdit={onEdit}>
        <div className={styles.overviewWho}>
          {props.face === null ? null : <Avatar look={props.face} size="lg" />}
          <div className={styles.overviewWhoText}>
            <span className={styles.overviewName}>
              {props.name === ""
                ? t("project-workspace.heading.agents-new-agent")
                : props.name}
              {lophn ? null : (
                <span className={styles.handle}>
                  {definition.handle === undefined
                    ? ""
                    : `@${definition.handle}`}
                </span>
              )}
            </span>
            {lophn ? (
              <span>
                {t("agents.label.lophn-role", {
                  workspace: scopeLabel(scope, props.workspaceName, true),
                })}
              </span>
            ) : definition.description === undefined ? (
              <Muted>{t("agents.label.no-role")}</Muted>
            ) : (
              <span>{definition.description}</span>
            )}
          </div>
        </div>
      </Section>

      <Section group="runs" onEdit={onEdit}>
        <dl className={`${glance.glance} ${styles.overviewRows}`}>
          <GlanceRow name="runtime" label={t("agents.label.field-runtime")}>
            <RuntimeName runtime={facts.runtime} />
          </GlanceRow>
          <GlanceRow name="model" label={t("agents.label.field-model")}>
            {harness ? (
              (harnessModel ?? own)
            ) : model === null ? (
              <Muted>{t("agents.label.no-model-chosen")}</Muted>
            ) : (
              <span className={styles.stack}>
                <span className={glance.withIcon}>
                  <ModelName choice={model} models={models} />
                  {layer === "agent" ? null : (
                    <Muted>{t("agents.label.model-layer", { layer })}</Muted>
                  )}
                </span>
                {price === null ||
                price.input === null ||
                price.output === null ? null : (
                  <Muted>
                    {t("agents.label.model-price", {
                      input: price.input,
                      output: price.output,
                    })}
                  </Muted>
                )}
              </span>
            )}
          </GlanceRow>
          <GlanceRow name="modality" label={t("agents.label.field-modality")}>
            {t("agents.label.card-modality", {
              input: (definition.modality?.input ?? ALL_MODALITIES)
                .map(modalityLabel)
                .join(", "),
              output: (definition.modality?.output ?? ALL_MODALITIES)
                .map(modalityLabel)
                .join(", "),
            })}
          </GlanceRow>
        </dl>
      </Section>

      <Section group="sees" onEdit={onEdit}>
        <dl className={`${glance.glance} ${styles.overviewRows}`}>
          <GlanceRow name="workspace" label={t("agents.label.field-workspace")}>
            {scopeLabel(scope, props.workspaceName, lophn)}
          </GlanceRow>
          <GlanceRow
            name="browser_profile"
            label={t("agents.label.field-browser-profile")}
          >
            {browser === undefined ? (
              <Muted>{t("agents.label.value-default-profile")}</Muted>
            ) : (
              <span className={glance.withIcon}>
                <ProfileMark profile={browser} />
                {browser.name}
              </span>
            )}
          </GlanceRow>
          <GlanceRow name="apps" label={t("agents.label.field-apps")}>
            {appsValue("local")}
          </GlanceRow>
          {hasRemote ? (
            <GlanceRow
              name="remote_apps"
              label={t("agents.label.field-remote-apps")}
            >
              {appsValue("remote")}
            </GlanceRow>
          ) : null}
          <GlanceRow name="mcp" label={t("agents.label.field-mcp")}>
            {harness ? own : mcpOn.length === 0 ? none : list(mcpOn)}
          </GlanceRow>
          {custom || harness ? (
            <GlanceRow name="tools" label={t("agents.label.field-tools")}>
              {harness
                ? own
                : (definition.tools ?? []).length === 0
                  ? none
                  : list(definition.tools ?? [])}
            </GlanceRow>
          ) : null}
          <GlanceRow name="skip" label={t("agents.label.field-skip")}>
            {definition.skip === true ? (
              t("agents.label.value-on")
            ) : (
              <Muted>{t("agents.label.value-off")}</Muted>
            )}
          </GlanceRow>
        </dl>
      </Section>

      <Section group="works" onEdit={onEdit}>
        <dl className={`${glance.glance} ${styles.overviewRows}`}>
          <GlanceRow
            name="instructions"
            label={t("agents.label.field-instructions")}
          >
            {instructions === null ? (
              none
            ) : (
              <span className={styles.clip}>{instructions}</span>
            )}
          </GlanceRow>
          <GlanceRow name="skills" label={t("agents.label.field-skills")}>
            {harness ? (
              own
            ) : skillsOn.length === 0 ? (
              none
            ) : (
              <span className={styles.clip}>
                {t("agents.label.skills-on", {
                  count: skillsOn.length,
                  names: skillsOn.join(", "),
                })}
              </span>
            )}
          </GlanceRow>
          <GlanceRow name="memory" label={t("agents.label.field-memory")}>
            {harness ? (
              own
            ) : lophn ? (
              t("agents.label.value-workspace-memory", {
                workspace:
                  detail.instructions?.workspace ?? props.workspaceName,
              })
            ) : custom && !(definition.tools ?? []).includes(MEMORY_TOOL) ? (
              <Muted>{t("agents.label.value-off")}</Muted>
            ) : detail.memory === null ? (
              <Muted>{t("agents.label.value-after-create")}</Muted>
            ) : memoryLine === null ? (
              <Muted>{t("agents.label.value-empty-memory")}</Muted>
            ) : (
              <span className={styles.clip}>{memoryLine}</span>
            )}
          </GlanceRow>
        </dl>
      </Section>
    </div>
  );
}
