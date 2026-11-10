// Skills 탭: 이 agent가 쓰는 skill. bare는 고른 skill만 받고, 나머지는 끈 이름(`skills_off`)을 뺀 것을 받는다.
import { t } from "@lophn/i18n";

import {
  type AgentFacts,
  type FormProps,
  issuesOf,
  withField,
} from "./editor-model.ts";
import { Group, Issues } from "./form-kit.tsx";
import { SkillList } from "./parts.tsx";
import styles from "./agent-editor.module.css";

interface SkillsTabProps extends FormProps {
  readonly facts: AgentFacts;
}

export function SkillsTab(props: SkillsTabProps) {
  const { detail, definition, facts, onChange } = props;
  const { bare } = facts;
  const set = (key: Parameters<typeof withField>[1], value: unknown) =>
    onChange(withField(definition, key, value));

  const skillsOff = definition.skills_off ?? [];
  // 정의의 skills_off는 이 agent가 끈 이름이다. 끄지 않은 skill은 보이는 대로 받는다.
  const toggleSkill = (name: string, on: boolean) =>
    set(
      "skills_off",
      on
        ? skillsOff.filter((one) => one !== name)
        : [...new Set([...skillsOff, name])],
    );
  // bare는 고른 skill만 받는다. 목록은 같고 켠 줄이 고른 것이다.
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
      <Group
        name="skills"
        heading={t("project-workspace.heading.agent-editor-skills")}
      >
        <SkillList
          items={
            bare
              ? detail.skills.map((row) => ({ ...row, builtIn: false }))
              : detail.skills
          }
          offNames={
            bare
              ? detail.skills
                  .map((row) => row.name)
                  .filter((name) => !skillPicks.includes(name))
              : skillsOff
          }
          lockOff
          onToggle={bare ? togglePick : toggleSkill}
        />
        <p className={styles.note}>
          {t(
            bare
              ? "agents.notice.skills-bare-pick"
              : "agents.notice.skills-agent-only",
          )}
        </p>
        <Issues issues={issuesOf(props.issues, "skills")} />
      </Group>
    </div>
  );
}
