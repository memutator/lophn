// Version 탭. activation 진행 상태(적용 중, 적용됨, 적용 실패)와 이전 release로 돌아가기 하나만 있다.
// 사람이 release를 고르거나 쓰기 시작하는 단추는 없다.
import { useState } from "react";
import { Button, DiffMark, StatusMark } from "@lophn/design/components";

import { CURRENT_SCHEMA, EARLIER_RELEASES } from "./data.ts";
import { Facts, Note, Section } from "./parts.tsx";
import { PaneToast } from "./toast.tsx";
import styles from "./app-space.module.css";

export type ActivationState = "applied" | "applying" | "failed";

const STEPS: readonly { label: string; state: "done" | "now" | "wait" }[] = [
  { label: "Stopped taking new calls (2 calls are held)", state: "done" },
  { label: "Waiting for the running call to finish", state: "now" },
  { label: "Confirm the previous process has stopped", state: "wait" },
  { label: "Apply data migration (2 steps)", state: "wait" },
  { label: "Start r8 and check that it responds", state: "wait" },
];

/** 비교는 대기 목록 카드와 같다. 늘어난 선언과 손실 단계만 보인다. */
function Changes({ from, to }: { from: string; to: string }) {
  return (
    <Section title={`What changes, ${from} to ${to}`}>
      <div className={styles.card}>
        <span className={styles.strong}>Wider declarations</span>
        <div className={styles.diffRow}>
          <DiffMark kind="add" />
          <span>Network host</span>
          <span className={styles.mono}>api.shipbob.com</span>
        </div>
        <div className={styles.diffRow}>
          <DiffMark kind="add" />
          <span>Writes to another app</span>
          <span className={styles.mono}>Inventory › stock.reserve</span>
        </div>
        <span className={styles.strong}>Steps that can lose data</span>
        <div className={styles.diffRow}>
          <DiffMark kind="delete" />
          <span>Drops column</span>
          <span className={styles.mono}>orders.legacy_note</span>
        </div>
      </div>
    </Section>
  );
}

function Earlier({ busy }: { busy: boolean }) {
  const [went, setWent] = useState<string | null>(null);
  const [toast, setToast] = useState(false);
  return (
    <Section title="Earlier releases">
      {went === null || !toast ? null : (
        <PaneToast
          below
          title={`Went back to ${went}`}
          body="Only the app code changed. The database stays as it is."
          onClose={() => setToast(false)}
        />
      )}
      <ul className={styles.list}>
        {EARLIER_RELEASES.map((release) => {
          const same = release.schema === CURRENT_SCHEMA;
          const reason = busy
            ? "Not available while a release is being applied."
            : same
            ? null
            : `Data schema ${release.schema} differs from the current ${CURRENT_SCHEMA}.`;
          return (
            <li key={release.id} className={styles.item}>
              <div className={styles.rowText}>
                <span className={styles.rowTitle}>
                  {release.id}{" "}
                  <span className={styles.muted}>
                    · data schema {release.schema}
                  </span>
                </span>
                <span className={styles.muted}>
                  Replaced {release.replaced}
                </span>
                {reason === null
                  ? null
                  : <span className={styles.muted}>{reason}</span>}
              </div>
              {went === release.id
                ? <StatusMark tone="good" label="Active now" />
                : (
                  <Button
                    size="sm"
                    disabled={reason !== null}
                    onClick={() => {
                      setWent(release.id);
                      setToast(true);
                    }}
                  >
                    {`Go back to ${release.id}`}
                  </Button>
                )}
            </li>
          );
        })}
      </ul>
      <p className={styles.muted}>
        Going back changes only the app code. The database stays as it is.
      </p>
    </Section>
  );
}

function ActiveRelease() {
  return (
    <div className={styles.card}>
      <div className={styles.row}>
        <span className={styles.rowTitle}>r7</span>
        <StatusMark tone="good" label="Applied" />
      </div>
      <Facts
        rows={[
          ["Applied", "Oct 15, 13:58"],
          ["Commit", <span key="c" className={styles.mono}>3f9a1c2</span>],
          ["Data schema", CURRENT_SCHEMA],
        ]}
      />
    </div>
  );
}

export function VersionTab({ state = "applied" }: { state?: ActivationState }) {
  return (
    <div className={styles.tab}>
      {state === "applying"
        ? (
          <Section title="Being applied">
            <div className={styles.card}>
              <div className={styles.row}>
                <span className={styles.rowTitle}>r8</span>
                <StatusMark tone="warning" label="Applying" />
              </div>
              <p className={styles.text}>
                This started on its own after App Engineer's change was
                verified. r7 keeps serving until r8 is ready.
              </p>
              <ol className={styles.steps}>
                {STEPS.map((step) => (
                  <li
                    key={step.label}
                    className={`${styles.step} ${
                      step.state === "done"
                        ? styles.stepDone
                        : step.state === "wait"
                        ? styles.stepWait
                        : ""
                    }`}
                  >
                    <span aria-hidden="true">
                      {step.state === "done"
                        ? "✓"
                        : step.state === "now"
                        ? "…"
                        : "·"}
                    </span>
                    <span>{step.label}</span>
                  </li>
                ))}
              </ol>
            </div>
          </Section>
        )
        : null}
      {state === "failed"
        ? (
          <Section title="Last activation">
            <div className={styles.card}>
              <div className={styles.row}>
                <span className={styles.rowTitle}>r8</span>
                <StatusMark tone="critical" label="Apply failed" />
              </div>
              <Facts
                rows={[
                  ["Failed", "Oct 15, 15:07"],
                  [
                    "Reason",
                    "Migration step 2 of 2 failed: NOT NULL constraint failed on orders.carrier. The database was restored from the backup.",
                  ],
                ]}
              />
              <Note title="r7 is still the active release">
                Nothing you use has changed. App Engineer was called and will
                pick this up.
              </Note>
            </div>
          </Section>
        )
        : null}
      <Section
        title={state === "applied" ? "Active release" : "Active release (r7)"}
      >
        <ActiveRelease />
      </Section>
      <Changes
        from={state === "applied" ? "r6" : "r7"}
        to={state === "applied" ? "r7" : "r8"}
      />
      <Earlier busy={state === "applying"} />
    </div>
  );
}
