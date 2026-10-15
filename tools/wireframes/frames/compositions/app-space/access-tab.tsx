// Access 탭. 앱이 activation 때 허락받은 바깥 자원과 다른 앱 app-api를 보이고 거둔다. 만들지는 않는다.
// 거두기는 요청 접수와 실제 정리(이전 process 종료 확인)를 나눠 보인다.
import { useState } from "react";
import { Button, StatusMark } from "@lophn/design/components";

import { APP_APIS, RESOURCES } from "./data.ts";
import { EffectPill, Mono, Note, Pill, Section } from "./parts.tsx";
import styles from "./app-space.module.css";

type Revoke = "requested" | "cleaned";

function RevokeState({ state }: { state: Revoke }) {
  return (
    <div className={styles.actions}>
      <ol className={styles.steps}>
        <li className={`${styles.step} ${styles.stepDone}`}>
          <span aria-hidden="true">✓</span>
          <span>Revoke requested. New calls are blocked.</span>
        </li>
        <li
          className={`${styles.step} ${
            state === "cleaned" ? styles.stepDone : styles.stepWait
          }`}
        >
          <span aria-hidden="true">{state === "cleaned" ? "✓" : "…"}</span>
          <span>
            {state === "cleaned"
              ? "Previous process stopped. The app restarted without it."
              : "Waiting for the previous process to stop, then the app restarts without it."}
          </span>
        </li>
      </ol>
    </div>
  );
}

function Row(
  { title, sub, lead, revoke, onRevoke }: {
    title: string;
    sub: string;
    lead: string;
    revoke: Revoke | undefined;
    onRevoke: () => void;
  },
) {
  return (
    <li className={styles.item}>
      <div className={styles.rowText}>
        <span className={styles.rowTitle}>
          <Pill>{lead}</Pill> <Mono>{title}</Mono>
        </span>
        <span className={styles.muted}>{sub}</span>
        {revoke === undefined ? null : <RevokeState state={revoke} />}
      </div>
      {revoke === undefined
        ? <Button size="sm" onClick={onRevoke}>Revoke</Button>
        : revoke === "cleaned"
        ? <StatusMark tone="good" label="Revoked" />
        : <StatusMark tone="warning" label="Cleaning up" />}
    </li>
  );
}

export function AccessTab({ revoking = [] }: { revoking?: readonly string[] }) {
  const [state, setState] = useState<Readonly<Record<string, Revoke>>>(
    Object.fromEntries(revoking.map((id) => [id, "requested" as const])),
  );
  const revoke = (id: string) =>
    setState((now) => ({ ...now, [id]: "requested" }));
  return (
    <div className={styles.tab}>
      <Note>
        Access is set when a release is applied. It can only be taken back here,
        not added.
      </Note>
      <Section title="Outside resources">
        <ul className={styles.list}>
          {RESOURCES.map((item) => (
            <Row
              key={item.id}
              lead={item.kind}
              title={item.name}
              sub={item.detail}
              revoke={state[item.id]}
              onRevoke={() => revoke(item.id)}
            />
          ))}
        </ul>
      </Section>
      <Section title="Other apps">
        <ul className={styles.list}>
          {APP_APIS.map((item) => (
            <li key={item.id} className={styles.item}>
              <div className={styles.rowText}>
                <span className={styles.rowTitle}>
                  {item.app} › <Mono>{item.api}</Mono>
                </span>
                <span className={styles.muted}>
                  Orders may call this app-api.{" "}
                  <EffectPill effect={item.effect} />
                </span>
                {state[item.id] === undefined
                  ? null
                  : <RevokeState state={state[item.id]} />}
              </div>
              {state[item.id] === undefined
                ? (
                  <Button size="sm" onClick={() => revoke(item.id)}>
                    Revoke
                  </Button>
                )
                : <StatusMark tone="warning" label="Cleaning up" />}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
