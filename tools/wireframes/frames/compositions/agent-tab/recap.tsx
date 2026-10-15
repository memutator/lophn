// `/recap`의 결과. session을 짧게 요약해 대화 끝에 보이고, 이력은 그대로 둔다(요약은 대화에 들어가지 않는다).
import { Button } from "@lophn/design/components";

import { RECAP } from "./data.ts";
import t from "./agent-tab.module.css";

export function RecapCard({ onDismiss }: { onDismiss?: () => void }) {
  return (
    <section className={t.recap} aria-label="Recap">
      <p className={t.recapHead}>Recap</p>
      <ul className={t.recapList}>
        {RECAP.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <div className={t.recapFoot}>
        <span className={t.cardNote}>
          Only shown here. The conversation itself is unchanged.
        </span>
        <Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>
      </div>
    </section>
  );
}
