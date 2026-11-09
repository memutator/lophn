// composer 위 agent의 login 요청 card. agent 이름, 탭, shell main이 잰 origin을 보이고 [Enter]는 보호 입력 창을 연다.
// 창은 사람이 이 단추를 눌러야 열리고, 창에 보이는 값(origin·mode)은 main이 core에서 다시 읽는다.
import { useEffect, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";
import type { LoginRequestView } from "../../../../protocol/lophn-agent/login-request.ts";
import type {
  SecretInputOpenReply,
  SecretInputRequestOpen,
} from "../../../ipc/secret-input.ts";
import type { AgentTabSource } from "../agent-tab-source.ts";
import styles from "./login-request-card.module.css";

/**
 * preload의 `openSecretInput`에 요청 card의 열기를 보낸다(session과 tool call만). 창에 보일 origin·mode는 main이 core에서 읽는다.
 * 열지 못하거나 이미 열린 창이 있으면 false다.
 */
export async function openLoginRequestWindow(
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

interface LoginRequestCardProps {
  agent: string;
  session: string;
  toolCall: string;
  /** 읽고 접는 route. 없는 source(fake·GUI)면 card는 아무것도 그리지 않는다. */
  source: Pick<AgentTabSource, "readLoginRequest" | "cancelLoginRequest">;
  /** 보호 창을 열고 닫힐 때까지 기다린다. 열지 못하면 false다. */
  onEnter(): Promise<boolean>;
}

export function LoginRequestCard({
  agent,
  session,
  toolCall,
  source,
  onEnter,
}: LoginRequestCardProps) {
  const [view, setView] = useState<LoginRequestView | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void source.readLoginRequest?.({ session, toolCall }).then((result) => {
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
      aria-label={t("conversation.label.login-request-card", { agent })}
    >
      <span className={styles.title}>
        {t(`conversation.title.login-request-${view.mode}`, { agent })}
      </span>
      <div className={styles.site} data-login-origin="">
        <span className={styles.caption}>
          {t("conversation.label.login-request-origin")}
        </span>
        <span className={styles.origin}>{view.origin}</span>
      </div>
      {view.title === "" ? null : (
        <div className={styles.site}>
          <span className={styles.caption}>
            {t("conversation.label.login-request-tab")}
          </span>
          <span className={styles.tab}>{view.title}</span>
        </div>
      )}
      <div className={styles.foot}>
        <p className={failed ? `${styles.note} ${styles.error}` : styles.note}>
          {failed
            ? t("conversation.notice.login-request-failed")
            : t("conversation.notice.login-request-help", { agent })}
        </p>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void source.cancelLoginRequest?.({ session, toolCall })
          }
        >
          {t("conversation.button.login-request-cancel")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={() => void enter()}
        >
          {t("conversation.button.login-request-enter")}
        </Button>
      </div>
    </section>
  );
}
