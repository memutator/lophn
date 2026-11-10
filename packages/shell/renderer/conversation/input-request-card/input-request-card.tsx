// composer 위 agent의 입력 요청 card. 값이 가는 곳을 가장 눈에 띄게 보인다: login은 shell main이 잰 origin, secret은 core가
// 정의·선언에서 읽은 목적지다(agent가 적은 글이 아니다). [Enter]는 보호 입력 창을 연다.
// 창은 사람이 이 단추를 눌러야 열리고, 창에 보이는 값은 main이 core에서 다시 읽는다.
import { useEffect, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";
import type { InputRequestView } from "../../../../protocol/lophn-agent/input-request.ts";
import type {
  SecretInputOpenReply,
  SecretInputRequestOpen,
} from "../../../ipc/secret-input.ts";
import type { AgentTabSource } from "../agent-tab-source.ts";
import styles from "./input-request-card.module.css";

/**
 * preload의 `openSecretInput`에 요청 card의 열기를 보낸다(session과 tool call만). 창에 보일 내용은 main이 core에서 읽는다.
 * 열지 못하거나 이미 열린 창이 있으면 false다.
 */
export async function openInputRequestWindow(
  request: SecretInputRequestOpen["request"],
): Promise<boolean> {
  const shell = (
    globalThis as {
      lophnShell?: {
        openSecretInput?: (
          input: SecretInputRequestOpen,
        ) => Promise<SecretInputOpenReply>;
      };
    }
  ).lophnShell;
  const reply = await shell?.openSecretInput?.({ request }).catch(() => null);
  return reply?.ok === true;
}

interface InputRequestCardProps {
  agent: string;
  session: string;
  toolCall: string;
  /** 읽고 접는 route. 없는 source(fake·GUI)면 card는 아무것도 그리지 않는다. */
  source: Pick<AgentTabSource, "readInputRequest" | "cancelInputRequest">;
  /** 보호 창을 열고 닫힐 때까지 기다린다. 열지 못하면 false다. */
  onEnter(): Promise<boolean>;
}

function titleOf(view: InputRequestView, agent: string): string {
  if (view.kind === "login") {
    return t(`conversation.title.input-request-${view.mode}`, { agent });
  }
  return t(
    "provider" in view.slot
      ? "conversation.title.input-request-provider"
      : "conversation.title.input-request-app",
    { agent, subject: view.subject },
  );
}

export function InputRequestCard({
  agent,
  session,
  toolCall,
  source,
  onEnter,
}: InputRequestCardProps) {
  const [view, setView] = useState<InputRequestView | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void source.readInputRequest?.({ session, toolCall }).then((result) => {
      if (live && result.ok) setView(result.value);
    });
    return () => {
      live = false;
    };
  }, [source, session, toolCall]);
  if (view === null) return null;
  const enter = async () => {
    setBusy(true);
    setFailed(false);
    const opened = await onEnter();
    setBusy(false);
    setFailed(!opened);
  };
  return (
    <section
      className={styles.card}
      aria-label={t("conversation.label.input-request-card", { agent })}
    >
      <span className={styles.title}>{titleOf(view, agent)}</span>
      {view.kind === "login" ? (
        <>
          <div className={styles.site} data-login-origin="">
            <span className={styles.caption}>
              {t("conversation.label.input-request-origin")}
            </span>
            <span className={styles.origin}>{view.origin}</span>
          </div>
          {view.title === "" ? null : (
            <div className={styles.site}>
              <span className={styles.caption}>
                {t("conversation.label.input-request-tab")}
              </span>
              <span className={styles.tab}>{view.title}</span>
            </div>
          )}
        </>
      ) : (
        <>
          <div className={styles.site} data-secret-destinations="">
            <span className={styles.caption}>
              {t("conversation.label.input-request-destinations")}
            </span>
            {view.destinations.length === 0 ? (
              <span className={styles.tab}>
                {t("conversation.notice.input-request-no-destination")}
              </span>
            ) : (
              view.destinations.map((destination) => (
                <span key={destination} className={styles.origin}>
                  {destination}
                </span>
              ))
            )}
          </div>
          <div className={styles.site}>
            <span className={styles.caption}>
              {t("conversation.label.input-request-secret")}
            </span>
            <span className={styles.tab}>{view.name}</span>
          </div>
          {view.configured ? (
            <span className={styles.tab}>
              {t("conversation.notice.input-request-replaces")}
            </span>
          ) : null}
        </>
      )}
      <div className={styles.foot}>
        <p className={failed ? `${styles.note} ${styles.error}` : styles.note}>
          {failed
            ? t("conversation.notice.input-request-failed")
            : t("conversation.notice.input-request-help", { agent })}
        </p>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void source.cancelInputRequest?.({ session, toolCall })
          }
        >
          {t("conversation.button.input-request-cancel")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={() => void enter()}
        >
          {t("conversation.button.input-request-enter")}
        </Button>
      </div>
    </section>
  );
}
