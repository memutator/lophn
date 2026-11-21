// Works how 탭(어떻게 일하나): 지침 · skill · memory.
// runtime이 쓰지 않는 칸은 숨기지 않고 왜 효과가 없는지 한 줄로 보인다: harness는 자기 skill과 memory를 쓰고,
// custom은 전역·workspace 지침과 global·workspace memory를 읽지 않는다. lophn은 따로 agent memory가 없다(workspace memory를 쓴다).
import { t } from "@lophn/i18n";

import { MEMORY_MAX_BYTES } from "../../../../../protocol/lophn-agent/tool-lists.ts";
import { MEMORY_TOOL, runtimeLabel } from "../agent-glance.tsx";
import type { AgentDetail } from "../source.ts";
import {
  type AgentFacts,
  type FormProps,
  issuesOf,
  withField,
} from "./editor-model.ts";
import { Group, Issues } from "./form-kit.tsx";
import {
  InstructionsEditor,
  type InstructionsPort,
} from "./instructions-editor.tsx";
import { InstructionsBlock, SkillList } from "./parts.tsx";
import styles from "./agent-editor.module.css";

/** memory가 보기에서 보이는 줄 수. */
const MEMORY_LINES = 4;

function instructionsHead(detail: AgentDetail, workspaceName: string): string {
  const file = detail.instructions?.file ?? "LOPHN.md";
  return t("agents.label.instructions-head-placed", {
    file,
    workspace: detail.instructions?.workspace ?? workspaceName,
  });
}

interface WorksTabProps extends FormProps {
  readonly facts: AgentFacts;
  /** workspace 지침을 그 자리에서 고치는 길. */
  readonly workspaceInstructions: InstructionsPort;
  /** 이 agent의 memory를 그 자리에서 고치는 길. 저장 전 agent는 쓰지 않는다. */
  readonly memoryPort: InstructionsPort;
}

export function WorksTab(props: WorksTabProps) {
  const { detail, definition, facts, onChange } = props;
  const { custom, harness, lophn, runtime } = facts;
  const set = (key: Parameters<typeof withField>[1], value: unknown) =>
    onChange(withField(definition, key, value));
  const own = { runtime: runtimeLabel(runtime) };

  const skillsOff = definition.skills_off ?? [];
  // 정의의 skills_off는 이 agent가 끈 이름이다. 끄지 않은 skill은 보이는 대로 받는다.
  const toggleSkill = (name: string, on: boolean) =>
    set(
      "skills_off",
      on
        ? skillsOff.filter((one) => one !== name)
        : [...new Set([...skillsOff, name])],
    );
  // custom은 고른 skill만 받는다. 목록은 같고 켠 줄이 고른 것이다.
  const skillPicks = definition.skills ?? [];
  const togglePick = (name: string, on: boolean) =>
    set(
      "skills",
      on
        ? [...new Set([...skillPicks, name])]
        : skillPicks.filter((one) => one !== name),
    );

  return (
    <div className={styles.form}>
      <InstructionsBlock
        workspace={custom ? null : detail.instructions}
        head={instructionsHead(detail, props.workspaceName)}
        port={props.workspaceInstructions}
        note={
          custom
            ? t("agents.notice.custom-instructions")
            : detail.instructions?.editable === false
              ? t("agents.notice.instructions-app-none")
              : undefined
        }
        value={definition.body}
        help={
          custom
            ? t("agents.notice.instructions-help-custom")
            : detail.instructions === null
              ? t("agents.notice.instructions-help-lophn")
              : t("agents.notice.instructions-help")
        }
        issues={<Issues issues={issuesOf(props.issues, "instructions")} />}
        onChange={(body) => onChange({ ...definition, body })}
      />

      <Group
        name="skills"
        heading={t("project-workspace.heading.agent-editor-skills")}
      >
        {harness ? (
          <p className={styles.note} data-own="skills">
            {t("agents.notice.own-skills", own)}
          </p>
        ) : (
          <>
            <SkillList
              items={
                custom
                  ? detail.skills.map((row) => ({ ...row, builtIn: false }))
                  : detail.skills
              }
              offNames={
                custom
                  ? detail.skills
                      .map((row) => row.name)
                      .filter((name) => !skillPicks.includes(name))
                  : skillsOff
              }
              lockOff
              onToggle={custom ? togglePick : toggleSkill}
            />
            <p className={styles.note}>
              {t(
                custom
                  ? "agents.notice.skills-custom-pick"
                  : "agents.notice.skills-agent-only",
              )}
            </p>
          </>
        )}
        <Issues issues={issuesOf(props.issues, "skills")} />
      </Group>

      <Group name="memory" heading={t("agents.heading.memory")}>
        {harness ? (
          <p className={styles.note} data-own="memory">
            {t("agents.notice.own-memory", own)}
          </p>
        ) : lophn ? (
          <p className={styles.note}>
            {t("agents.notice.memory-lophn", {
              workspace: detail.instructions?.workspace ?? props.workspaceName,
            })}
          </p>
        ) : detail.memory === null ? (
          <p className={styles.note}>
            {t("agents.notice.memory-agent-after-create")}
          </p>
        ) : (
          <>
            <InstructionsEditor
              head={t("agents.label.memory-head-agent")}
              file={detail.memory}
              lines={MEMORY_LINES}
              empty={t("agents.empty.memory")}
              port={props.memoryPort}
              limit={MEMORY_MAX_BYTES}
            />
            <p className={styles.note}>{t("agents.notice.memory-agent")}</p>
          </>
        )}
        {custom ? (
          <p className={styles.note} data-own="memory">
            {t("agents.notice.custom-memory", {
              picked: String((definition.tools ?? []).includes(MEMORY_TOOL)),
            })}
          </p>
        ) : null}
      </Group>
    </div>
  );
}
