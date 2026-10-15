// 앱 rewind panel. Activity 탭 안에 있고 확인 창이 아니다. 고른 invocation부터 최신까지 함께 되돌아갈 목록을 보이고,
// 사람이 [Rewind Orders]를 눌러야 시작한다. 진행과 결과도 같은 panel에서 본다.
import { Button, StatusMark } from "@lophn/design/components";

import { APP_NAME, INVOCATIONS, REWIND_FROM } from "./data.ts";
import { EffectPill, Mono, Note, Section } from "./parts.tsx";
import styles from "./app-space.module.css";

export type RewindStage = "confirm" | "running" | "done" | "conflict";

type Outcome = "undone" | "stays" | "cannot";

/** 고른 호출부터 최신까지. 아직 시작하지 않은 대기 호출은 목록에 없다. */
function affected() {
  const from = INVOCATIONS.findIndex((item) => item.id === REWIND_FROM);
  return INVOCATIONS.slice(0, from + 1)
    .filter((item) => item.state !== "waiting" && item.effect !== "read")
    .map((item) => ({
      item,
      outcome:
        (item.effect === "external"
          ? "stays"
          : item.state === "unknown"
          ? "cannot"
          : "undone") as Outcome,
    }));
}

const OUTCOME: Record<Outcome, string> = {
  undone: "Will be undone",
  stays: "Won't be undone",
  cannot: "Can't be undone",
};

function List({ stage }: { stage: RewindStage }) {
  const rows = affected();
  return (
    <ul className={styles.list}>
      {rows.map(({ item, outcome }) => (
        <li
          key={item.id}
          className={`${styles.rewindRow} ${
            outcome === "undone" ? "" : styles.rewindRowMuted
          }`}
        >
          <span>{item.time}</span>
          <EffectPill effect={item.effect} />
          <span className={styles.cell}>
            <Mono>{item.api}</Mono>
            <span className={styles.muted}>{item.caller.label}</span>
          </span>
          <span className={outcome === "undone" ? styles.strong : undefined}>
            {outcome !== "undone"
              ? OUTCOME[outcome]
              : stage === "done"
              ? "Undone"
              : stage === "conflict"
              ? "Not changed"
              : OUTCOME[outcome]}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Counts() {
  const rows = affected();
  const count = (outcome: Outcome) =>
    rows.filter((row) => row.outcome === outcome).length;
  return (
    <p className={styles.text}>
      {count("undone")} changes will be undone. {count("stays")}{" "}
      external effect stays. {count("cannot")}{" "}
      call can't be undone because its result is unknown.
    </p>
  );
}

export function RewindPanel(
  { stage, onStart, onBack }: {
    stage: RewindStage;
    onStart: () => void;
    onBack: () => void;
  },
) {
  return (
    <div className={styles.tab} data-rewind={stage}>
      <div className={styles.row}>
        <h4 className={styles.issueTitle}>
          {stage === "confirm" || stage === "running"
            ? `Rewind ${APP_NAME} to before 14:32`
            : stage === "done"
            ? "Rewound"
            : "Rewind cancelled"}
        </h4>
        {stage === "running"
          ? <StatusMark tone="warning" label="In progress" />
          : stage === "done"
          ? <StatusMark tone="good" label="Done" />
          : stage === "conflict"
          ? <StatusMark tone="critical" label="Cancelled" />
          : null}
      </div>

      {stage === "confirm"
        ? (
          <Note title="Everyone's changes go together">
            {APP_NAME}{" "}
            goes back to just before the 14:32 markShipped call. Changes by your
            screen, agent sessions and other apps after that point disappear
            with it. This can't be redone.
          </Note>
        )
        : null}

      {stage === "running"
        ? (
          <Section title="Progress">
            <ol className={styles.steps}>
              <li className={`${styles.step} ${styles.stepDone}`}>
                <span aria-hidden="true">✓</span>
                <span>Stopped taking new calls.</span>
              </li>
              <li className={styles.step}>
                <span aria-hidden="true">…</span>
                <span>
                  Waiting for 1 running call to finish:{" "}
                  <Mono>orders.exportToSheet</Mono>, started 14:38.
                </span>
              </li>
              <li className={`${styles.step} ${styles.stepWait}`}>
                <span aria-hidden="true">·</span>
                <span>Undo the changes below in one step.</span>
              </li>
            </ol>
            <Note title="2 calls are held">
              Calls that arrive now wait. They continue on the rewound{" "}
              {APP_NAME} when this finishes.
            </Note>
          </Section>
        )
        : null}

      {stage === "done"
        ? (
          <Note title={`${APP_NAME} is back to just before 14:32`}>
            2 changes were undone. The 14:38 export to the sheet was not, and
            the 14:36 refund could not be. Open app screens were refreshed and
            the 2 held calls continued.
          </Note>
        )
        : null}

      {stage === "conflict"
        ? (
          <Note title="Nothing changed">
            Conflict: the row <Mono>orders.1042</Mono>{" "}
            was changed after this call by something outside a recorded call, so
            the changes could not be reversed safely. The whole rewind was
            cancelled. New calls are accepted again and the held calls
            continued.
          </Note>
        )
        : null}

      <Section
        title={stage === "done"
          ? "What was rewound"
          : "Rewinds together, newest first"}
      >
        <List stage={stage} />
        {stage === "confirm" ? <Counts /> : null}
      </Section>

      <div className={styles.actions}>
        {stage === "confirm"
          ? (
            <>
              <Button variant="danger" onClick={onStart}>
                {`Rewind ${APP_NAME}`}
              </Button>
              <Button variant="ghost" onClick={onBack}>Cancel</Button>
            </>
          )
          : stage === "running"
          ? null
          : <Button onClick={onBack}>Back to Activity</Button>}
      </div>
    </div>
  );
}
