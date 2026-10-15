// 대화 안 시각 블록은 앱 카드뿐이다. 앱이 내준 부품을 카드로 보이고 [Open]이 앱 공간에서 연다. 표·차트·도표 블록과
// 문서로 저장하는 단추는 없다.
import { Button, Card, Icon, iconPixels } from "@lophn/design/components";
import { appSpaceIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";

import t from "./agent-tab.module.css";

const ROWS: readonly { name: string; before: string; after: string }[] = [
  { name: "query-recipe-gap", before: "pass", after: "fail" },
  { name: "sched-edit", before: "pass", after: "fail" },
  { name: "wake-plant", before: "pass", after: "fail" },
];

export function AppCard() {
  return (
    <Card>
      <div className={t.appCard}>
        <div className={t.appHead}>
          <Icon icon={appSpaceIcons.app} pixels={iconPixels("base")} />
          <span className={t.appName}>Eval board</span>
          <span className={t.appSub}>Run for week 41</span>
          <span className={t.spacer} />
          <Button size="sm" icon={appSpaceIcons.newWindow}>Open</Button>
        </div>
        <div className={t.appStats}>
          <span>
            <strong className={t.appValue}>0.93</strong> pass rate
          </span>
          <span>
            <strong className={t.appValue}>3</strong> failed
          </span>
          <span>
            <strong className={t.appValue}>44</strong> scenarios
          </span>
        </div>
        <ul className={t.appRows}>
          {ROWS.map((row) => (
            <li key={row.name} className={t.appRow}>
              <span className={t.appScenario}>{row.name}</span>
              <span className={t.appBefore}>{row.before}</span>
              <span>→</span>
              <span className={t.appAfter}>{row.after}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
