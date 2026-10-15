// Contexts 탭: 이 project의 context 목록. context는 Project Manager가 대화에서 만들어서 만드는 단추가 없다.
// 보관은 사람이 여기서 한다. 보관한 context는 검색과 위반 목록에서 빠진다.
import { useState } from "react";
import { Button, Card } from "@lophn/design/components";

import { contextTab } from "../phroner-data.ts";
import type { TabSpec } from "../project-window.tsx";
import {
  ARCHIVED_CARDS,
  CONTEXT_CARDS,
  type ContextCardData,
} from "./contexts-data.ts";
import { useOpenTab } from "./open-tab.ts";
import styles from "./contexts.module.css";

function ContextCard(
  { card, onArchive }: { card: ContextCardData; onArchive: () => void },
) {
  const open = useOpenTab();
  return (
    <Card>
      <div className={styles.cardHead}>
        <h3>{card.name}</h3>
      </div>
      <p className={styles.purpose}>{card.purpose}</p>
      <ul className={styles.facts}>
        <li>{card.kinds}</li>
        <li>
          Version {card.version},{" "}
          <span className={styles.good}>{card.tests}</span>
        </li>
        <li className={card.violations > 0 ? styles.warn : undefined}>
          {card.violations === 0
            ? "No violations"
            : `${card.violations} violations`}
        </li>
      </ul>
      <div className={styles.actions}>
        <Button onClick={() => open(contextTab(card.name))}>Open</Button>
        <Button variant="ghost" onClick={onArchive}>Archive</Button>
      </div>
    </Card>
  );
}

export function ContextsList(
  { archivedOpen = false }: { archivedOpen?: boolean },
) {
  const [active, setActive] = useState(CONTEXT_CARDS);
  const [archived, setArchived] = useState(ARCHIVED_CARDS);
  const [shown, setShown] = useState(archivedOpen);
  return (
    <div className={styles.list}>
      <h1 className={styles.title}>Contexts in phroner</h1>
      <div className={styles.cards}>
        {active.map((card) => (
          <ContextCard
            key={card.name}
            card={card}
            onArchive={() => {
              setActive(active.filter((item) => item !== card));
              setArchived([...archived, card]);
            }}
          />
        ))}
      </div>
      {archived.length === 0 ? null : (
        <>
          <div className={styles.archivedHead}>
            <h2>Archived ({archived.length})</h2>
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={shown}
              onClick={() => setShown(!shown)}
            >
              {shown ? "Hide" : "Show"}
            </Button>
          </div>
          {shown
            ? (
              <>
                <p className={styles.note}>
                  Archived contexts are left out of searches and violations.
                </p>
                {archived.map((card) => (
                  <div key={card.name} className={styles.archivedRow}>
                    <p>
                      <span className={styles.mono}>{card.name}</span>{" "}
                      <span className={styles.muted}>· {card.purpose}</span>
                    </p>
                    <Button
                      size="sm"
                      onClick={() => {
                        setArchived(archived.filter((item) =>
                          item !== card
                        ));
                        setActive([...active, card]);
                      }}
                    >
                      Unarchive
                    </Button>
                  </div>
                ))}
              </>
            )
            : null}
        </>
      )}
    </div>
  );
}

/** Contexts 탭. 본문을 직접 준다(종류별 본문 대신). */
export const contextsTab = (archivedOpen = false): TabSpec => ({
  key: "contexts",
  kind: "contexts",
  title: "phroner",
  body: <ContextsList archivedOpen={archivedOpen} />,
});
