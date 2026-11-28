// 배포한 앱 skill 목록. 앱의 public skill 하나를 이 층(전역, workspace, agent)에 배포하거나 거둔다. 층마다 이 목록 하나를 쓴다:
// 기록은 앱의 skill을 가리킬 뿐이고 본문은 복사하지 않는다(앱의 active release가 바뀌면 따라간다).

import { t } from "@lophn/i18n";
import { Menu } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";

import type { SkillDeployment } from "../../../../../protocol/lophn-agent/skill-settings.ts";
import { actionIcons } from "../../../icons/mod.ts";
import type { DeployableSkill } from "../views.ts";
import styles from "./agent-editor.module.css";

interface DeployedSkillsProps {
  /** 이 층에 배포한 skill. */
  readonly entries: readonly SkillDeployment[];
  /** 배포할 수 있는 skill 전부. 읽는 중이거나 읽지 못했으면 null이다. */
  readonly deployable: readonly DeployableSkill[] | null;
  /** 바꾼 새 목록. 저장은 부르는 쪽이 한다. */
  readonly onChange: (next: readonly SkillDeployment[]) => void;
}

const same = (a: SkillDeployment, b: SkillDeployment): boolean =>
  a.app === b.app && a.skill === b.skill;

export function DeployedSkills({
  entries,
  deployable,
  onChange,
}: DeployedSkillsProps) {
  const open = (deployable ?? []).filter(
    (one) => !entries.some((entry) => same(entry, one)),
  );
  return (
    <div data-deployed-skills="">
      {entries.length === 0 ? (
        <p className={styles.note}>{t("agents.empty.deployed-skills")}</p>
      ) : (
        <ul className={styles.toggleList}>
          {entries.map((entry) => {
            const known = deployable?.find((one) => same(entry, one));
            return (
              <li
                key={`${entry.app}/${entry.skill}`}
                className={styles.deployedRow}
                data-deployed={`${entry.app}/${entry.skill}`}
              >
                <span className={styles.toggleMain}>
                  <span className={styles.toggleName}>{entry.skill}</span>
                  <span className={styles.toggleDetail}>
                    {known !== undefined
                      ? known.description
                      : deployable === null
                        ? ""
                        : t("agents.label.deployed-gone")}
                  </span>
                </span>
                <span className={styles.chip}>
                  {known?.appName ?? entry.app}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={actionIcons.remove}
                  onClick={() =>
                    onChange(entries.filter((one) => !same(one, entry)))
                  }
                >
                  {t("agents.button.undeploy-skill")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div className={styles.rightEnd}>
        <Menu
          trigger={
            <Button
              size="sm"
              icon={actionIcons.add}
              disabled={open.length === 0}
            >
              {t("agents.button.deploy-skill")}
            </Button>
          }
          items={open.map((one) => ({
            id: `${one.app}/${one.skill}`,
            label: `${one.appName}: ${one.skill}`,
          }))}
          onSelect={(id) => {
            const [app, skill] = id.split("/") as [string, string];
            onChange([...entries, { app, skill }]);
          }}
        />
      </div>
    </div>
  );
}
