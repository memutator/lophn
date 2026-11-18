// composer 위 agent의 입력 요청 card. 값이 가는 곳을 가장 눈에 띄게 보인다: login은 shell main이 잰 origin, secret과
// sign_in은 core가 정의·선언·설정에서 읽은 목적지다(agent가 적은 글이 아니다). [Enter]는 보호 입력 창을 연다.
// 창은 사람이 이 단추를 눌러야 열리고, 창에 보이는 값은 main이 core에서 다시 읽는다. sign_in은 넣을 값이 없어 [Sign in]이
// browser 로그인을 돌린다(Settings·앱 상세와 같은 흐름).
// 다른 기계의 창에서는 secret의 [Enter]가 그 기계로 값을 보내는 보호 창을 연다. sign_in은 provider의 device code 로그인만 단추이고
// 그 기계의 browser로 돌아와야 하는 로그인(loopback provider, 앱 OAuth, MCP OAuth)과 이 컴퓨터의 browser에 치는 login은 한 줄이다.
import { useEffect, useRef, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";
import type {
  InputRequestView,
  SignInRequestView,
} from "../../../../protocol/lophn-agent/input-request.ts";
import { oauthFlowOf } from "../../../../protocol/lophn-agent/provider-values.ts";
import type {
  SecretInputOpenReply,
  SecretInputRequestOpen,
} from "../../../ipc/secret-input.ts";
import type { AgentTabSource } from "../agent-tab-source.ts";
import { useOptionalEventClient } from "../../desktop/connection/events/hooks.tsx";
import { useWindowMachine } from "../../desktop/machines/context.tsx";
import { inputRequestTitle } from "./title.ts";
import styles from "./input-request-card.module.css";

/**
 * preload의 `openSecretInput`에 요청 card의 열기를 보낸다(session과 tool call만). 창에 보일 내용은 main이 core에서 읽는다.
 * `machine`은 card가 선 범위의 기계다(null이면 이 컴퓨터). 열지 못하거나 이미 열린 창이 있으면 false다.
 */
export async function openInputRequestWindow(
  request: SecretInputRequestOpen["request"],
  machine: string | null,
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
  const reply = await shell
    ?.openSecretInput?.(machine === null ? { request } : { request, machine })
    .catch(() => null);
  return reply?.ok === true;
}

interface InputRequestCardProps {
  agent: string;
  session: string;
  toolCall: string;
  /** 읽고 접는 route. 없는 source(fake·GUI)면 card는 아무것도 그리지 않는다. */
  source: Pick<
    AgentTabSource,
    "readInputRequest" | "cancelInputRequest" | "signInInputRequest"
  >;
  /** 보호 창을 열고 닫힐 때까지 기다린다. `machine`은 card가 선 범위의 기계다. 열지 못하면 false다. */
  onEnter: (machine: string | null) => Promise<boolean>;
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
  const events = useOptionalEventClient();
  const [failed, setFailed] = useState(false);
  // 로그인을 돌리는 중이면 그만둘 신호와 device code다.
  const [signing, setSigning] = useState<{ code: string | null } | null>(null);
  const stop = useRef<AbortController | null>(null);
  const machine = useWindowMachine();
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
  // 다른 기계의 창에서 이 card가 끝내지 못하는 요청이면 단추 대신 놓는 한 줄이다.
  const elsewhere =
    machine === null
      ? null
      : view.kind === "login"
        ? t("machines.notice.only-here", { name: machine.name })
        : view.kind === "sign_in" && !deviceCode(view)
          ? t("machines.notice.sign-in-there", {
              product: view.subject,
              name: machine.name,
            })
          : null;
  const enter = async () => {
    setBusy(true);
    setFailed(false);
    const opened = await onEnter(machine?.id ?? null);
    setBusy(false);
    setFailed(!opened);
  };
  const signIn = async (request: SignInRequestView) => {
    const controller = new AbortController();
    stop.current = controller;
    setFailed(false);
    setSigning({ code: null });
    const result = await source.signInInputRequest?.({
      session,
      toolCall,
      view: request,
      events,
      progress: {
        signal: controller.signal,
        started: (info) => setSigning({ code: info.userCode }),
      },
    });
    stop.current = null;
    setSigning(null);
    // 사람이 그만두면 요청도 접는다. 그 밖의 실패는 core가 결과로 받아 agent에게 알린다.
    if (result?.ok === false && result.code === "cancelled") {
      void source.cancelInputRequest?.({ session, toolCall });
    }
  };
  const cancel = () => {
    if (stop.current !== null) stop.current.abort();
    else void source.cancelInputRequest?.({ session, toolCall });
  };
  return (
    <section
      className={styles.card}
      aria-label={t("conversation.label.input-request-card", { agent })}
    >
      <span className={styles.title}>{inputRequestTitle(view, agent)}</span>
      {view.kind === "sign_in" ? (
        <div className={styles.site} data-sign-in-destinations="">
          <span className={styles.caption}>
            {t("conversation.label.input-request-sign-in-at")}
          </span>
          {view.destinations.map((destination) => (
            <span key={destination} className={styles.origin}>
              {destination}
            </span>
          ))}
        </div>
      ) : view.kind === "login" ? (
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
          {signing !== null
            ? signing.code === null
              ? t("conversation.notice.input-request-signing-in")
              : t("conversation.notice.input-request-user-code", {
                  code: signing.code,
                })
            : failed
              ? t("conversation.notice.input-request-failed")
              : elsewhere !== null
                ? elsewhere
                : view.kind === "sign_in"
                  ? t("conversation.notice.input-request-sign-in-help", {
                      agent,
                    })
                  : t("conversation.notice.input-request-help", { agent })}
        </p>
        <Button size="sm" variant="ghost" onClick={cancel}>
          {t("conversation.button.input-request-cancel")}
        </Button>
        {elsewhere !== null ? null : view.kind === "sign_in" ? (
          <Button
            size="sm"
            variant="primary"
            disabled={signing !== null}
            onClick={() => void signIn(view)}
          >
            {t("conversation.button.input-request-sign-in")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => void enter()}
          >
            {t("conversation.button.input-request-enter")}
          </Button>
        )}
      </div>
    </section>
  );
}

/** provider의 device code 로그인. 어느 browser에서나 끝나 다른 기계의 창에서도 단추다. */
function deviceCode(view: SignInRequestView): boolean {
  const { target } = view;
  return (
    target.type === "provider" &&
    target.login.definition.oauth !== null &&
    oauthFlowOf(target.login.definition.oauth.product) === "device_code"
  );
}
