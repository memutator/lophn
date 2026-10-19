// Operator 편집에서 domain 고르기. 편집 화면(Definition 탭)은 renderer의 SkillList·InstructionsBlock 같은 조각과 CSS를 쓰고,
// Domains 칸과 Skills 칸이 새 모양이다. 탭 하나만 열린 project 창이나 앱 공간 오른쪽 패널에 놓는다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import {
  Checkbox,
  Field,
  Input,
  MultiSelectFilter,
  Textarea,
} from "@lophn/ui/input";
import { t } from "@lophn/wording";

import { Avatar } from "../../../../packages/shell/renderer/parts/avatar/avatar.tsx";
import { SkillList } from "../../../../packages/shell/renderer/workspace/agents/editor/parts.tsx";
import type { SkillRow } from "../../../../packages/shell/renderer/workspace/agents/views.ts";
import editor from "../../../../packages/shell/renderer/workspace/agents/editor/agent-editor.module.css";
import {
  APP_DOMAINS,
  APP_NAME,
  APP_OPERATOR_NAME,
  APP_SKILLS,
  OPERATOR_NAME,
  PROJECT_DOMAINS,
  PROJECT_NAME,
  PROJECT_SKILLS,
  type Skill,
} from "../../mock/domain/data.ts";
import styles from "./domain.module.css";

type Place = "project" | "app";

const noop = () => {};

function rowOf(skill: Skill, withDomain: boolean): SkillRow {
  return {
    name: skill.name,
    detail: withDomain ? `${skill.domain} · ${skill.detail}` : skill.detail,
    layer: "project",
    on: true,
    builtIn: false,
  };
}

export function OperatorDraft(
  { variant, place = "project" }: { variant: "a" | "b"; place?: Place },
) {
  const app = place === "app";
  const domains = app ? APP_DOMAINS : PROJECT_DOMAINS;
  const skills = app ? APP_SKILLS : PROJECT_SKILLS;
  const name = app ? APP_OPERATOR_NAME : OPERATOR_NAME;
  const [chosen, setChosen] = useState<string[]>(
    app ? ["orders", "shipping"] : ["eval", "findings"],
  );
  const [off, setOff] = useState<readonly string[]>([]);
  const toggle = (skill: string, on: boolean) =>
    setOff(on ? off.filter((one) => one !== skill) : [...off, skill]);
  // 비면 그릇의 domain 전부다. 고른 domain의 skill만 목록에 나온다.
  const active = chosen.length === 0 ? domains.map((one) => one.name) : chosen;
  const notice = chosen.length === 0
    ? t(app ? "domain.notice.all-of-app" : "domain.notice.all-of-project")
    : t("domain.notice.only-chosen");
  return (
    <div className={editor.page} data-agent-editor="ready">
      <h1 className={editor.title}>
        <Avatar profile={{ kind: "icon", icon: "read" }} size="md" />
        {name}
        <span className={editor.chip}>
          {t("project-workspace.label.agent-kind-operator")}
        </span>
      </h1>
      <form
        className={editor.form}
        onSubmit={(event) => event.preventDefault()}
      >
        <Field label={t("project-workspace.label.agent-editor-name")}>
          <Input defaultValue={name} />
        </Field>
        <fieldset className={editor.group}>
          <legend className={editor.legend}>{t("agents.label.place")}</legend>
          <p className={editor.fixed}>
            {app
              ? t("domain.label.place-app", { name: APP_NAME })
              : t("agents.label.place-named", { name: PROJECT_NAME })}
          </p>
        </fieldset>
        <fieldset className={editor.group}>
          <legend className={editor.legend}>
            {t("project-workspace.label.agent-editor-instructions")}
          </legend>
          <p className={editor.note}>
            {t(app ? "domain.note.layers-app" : "domain.note.layers-project")}
          </p>
          <Field label={t("agents.label.agent-instructions")}>
            <Textarea
              rows={2}
              defaultValue="Answer in two sentences and name the file you read."
            />
          </Field>
        </fieldset>
        <fieldset className={editor.group} data-field="domains">
          <legend className={editor.legend}>{t("domain.heading.list")}</legend>
          {variant === "a"
            ? (
              <div>
                <MultiSelectFilter
                  dimension={t("domain.label.pick")}
                  options={domains.map((one) => ({
                    value: one.name,
                    label: one.title,
                  }))}
                  value={chosen}
                  onChange={setChosen}
                />
              </div>
            )
            : (
              <div className={styles.checks}>
                {domains.map((one) => (
                  <Checkbox
                    key={one.name}
                    size="sm"
                    label={one.title}
                    checked={chosen.includes(one.name)}
                    onCheckedChange={(on) =>
                      setChosen(
                        on
                          ? domains.map((d) => d.name).filter((n) =>
                            n === one.name || chosen.includes(n)
                          )
                          : chosen.filter((n) => n !== one.name),
                      )}
                  />
                ))}
              </div>
            )}
          <p className={editor.note}>{notice}</p>
        </fieldset>
        <fieldset className={editor.group} data-field="skills">
          <legend className={editor.legend}>
            {t("project-workspace.heading.agent-editor-skills")}
          </legend>
          {variant === "a"
            ? (
              <SkillList
                items={skills.filter((s) => active.includes(s.domain)).map((
                  s,
                ) => rowOf(s, true))}
                offNames={off}
                showLayer={false}
                onToggle={toggle}
              />
            )
            : (
              <div className={styles.stack}>
                {domains.filter((one) => active.includes(one.name)).map((
                  one,
                ) => (
                  <div key={one.name} className={styles.skillGroup}>
                    <h3 className={styles.skillGroupTitle}>{one.title}</h3>
                    <SkillList
                      items={skills.filter((s) => s.domain === one.name).map((
                        s,
                      ) => rowOf(s, false))}
                      offNames={off}
                      showLayer={false}
                      onToggle={toggle}
                    />
                  </div>
                ))}
              </div>
            )}
          {variant === "a"
            ? (
              <p className={editor.note}>
                {t("domain.notice.skills-filtered")}
              </p>
            )
            : null}
        </fieldset>
        <div className={editor.formActions}>
          <Button onClick={noop}>{t("common.button.cancel")}</Button>
          <Button variant="primary" onClick={noop}>
            {t("project-workspace.button.agent-editor-save")}
          </Button>
        </div>
      </form>
    </div>
  );
}
