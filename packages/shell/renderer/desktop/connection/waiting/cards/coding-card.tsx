// coding agent의 권한 물음. lophn에서 답하지 않고 그 앱 공간의 터미널 탭으로 focus가 간다.
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/wording";
import type { WaitingEntry } from "../../events/waiting-store.ts";
import type { CardView } from "../model.ts";
import styles from "../waiting.module.css";
import { Head } from "./head.tsx";

export function CodingCard({
  entry,
  view,
  onAnswerInTerminal,
}: {
  entry: WaitingEntry;
  view: CardView;
  onAnswerInTerminal: (session: string) => void;
}) {
  return (
    <article className={styles.request} data-kind="coding">
      <Head view={view} agent={entry.agent} />
      <div className={styles.actions}>
        <Button
          size="sm"
          variant="primary"
          disabled={entry.session === null}
          onClick={() => {
            if (entry.session !== null) onAnswerInTerminal(entry.session);
          }}
        >
          {t("waiting.button.answer-in-terminal")}
        </Button>
      </div>
    </article>
  );
}
