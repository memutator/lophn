// 받은 메시지의 보낸 쪽 chip과, chip을 누르면 열리는 panel. 사람이 직접 쓰지 않은 입력(다른 agent의 부탁,
// program의 reaction, coding agent의 메시지, 배달 알림)이 chip을 단다. panel은 맡긴 글, 근거 링크, 보낸 session을
// 읽어 보인다.
import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import { VendorIcon, vendorOf } from "../../parts/vendor-icon/vendor-icon.tsx";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { type MessageKey, t } from "@lophn/wording";

import { commonIcons } from "../../icons/mod.ts";
import type {
  AgentRole,
  AgentTabSource,
  Envelope,
  EvidenceRef,
  Sender,
} from "../agent-tab-source.ts";
import styles from "./thread.module.css";

const ROLE_LABEL: Record<AgentRole, MessageKey> = {
  lophn: "conversation.label.sender-role-lophn",
  project_manager: "conversation.label.sender-role-project-manager",
  app_engineer: "conversation.label.sender-role-project-manager",
  operator: "conversation.label.sender-role-operator",
};

const EVIDENCE_LABEL: Record<EvidenceRef["kind"], MessageKey> = {
  ticket: "conversation.label.evidence-ticket",
  problem: "conversation.label.evidence-problem",
  file: "conversation.label.evidence-file",
  session: "conversation.label.evidence-session",
  annotation: "conversation.label.evidence-annotation",
};

/** chip에 보이는 보낸 쪽 이름. event만으로 이름을 모르면 종류만 말한다. */
function senderLabel(sender: Sender): string {
  switch (sender.kind) {
    case "agent": {
      const role = sender.role === null ? null : t(ROLE_LABEL[sender.role]);
      if (role === null) {
        return sender.name ?? t("conversation.label.sender-agent-other");
      }
      return sender.name === null || sender.name === role
        ? role
        : t("conversation.label.sender-agent-named", {
          role,
          name: sender.name,
        });
    }
    case "reaction":
      return sender.event === null
        ? t("conversation.label.sender-reaction-unknown")
        : t("conversation.label.sender-reaction", { event: sender.event });
    case "coding":
      return sender.product === null
        ? t("conversation.label.sender-coding-unknown")
        : t("conversation.label.sender-coding", { product: sender.product });
    case "program":
      return sender.label ?? t("conversation.label.sender-program-unknown");
  }
}

/** coding agent가 보냈으면 그 harness의 vendor 아이콘. */
function SenderIcon({ sender }: { sender: Sender }): ReactElement | null {
  if (sender.kind !== "coding" || sender.product === null) return null;
  const vendor = vendorOf(sender.product);
  return vendor === undefined ? null : <VendorIcon vendor={vendor} size={14} />;
}

interface SenderChipProps {
  sender: Sender;
  open: boolean;
  onToggle: () => void;
}

/** "From …" chip. 누르면 panel이 열린다. */
export function SenderChip(
  { sender, open, onToggle }: SenderChipProps,
): ReactElement {
  const label = senderLabel(sender);
  return (
    <button
      type="button"
      className={styles.senderChip}
      aria-expanded={open}
      aria-label={t("conversation.label.sender-sent-by", { sender: label })}
      data-sender-chip={sender.kind}
      onClick={onToggle}
    >
      <span className={styles.senderFrom}>
        {t("conversation.label.sender-from")}
      </span>
      <SenderIcon sender={sender} />
      <span className={styles.senderName}>{label}</span>
      <Icon
        icon={open ? commonIcons.collapse : commonIcons.expand}
        pixels={iconPixels("small")}
      />
    </button>
  );
}

const HEAD: Record<Sender["kind"], MessageKey> = {
  agent: "conversation.label.sender-head-handed",
  coding: "conversation.label.sender-head-handed",
  reaction: "conversation.label.sender-head-saw",
  program: "conversation.label.sender-head-why",
};

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly envelope: Envelope };

interface SenderPanelProps {
  /** 받은 메시지 id. panel이 열릴 때 봉투를 읽는다. */
  message: string;
  sender: Sender;
  source: Pick<AgentTabSource, "envelope">;
  /** ticket·problem·파일·annotation 근거 링크를 연다. 없으면 링크가 아니라 글이다. */
  onOpenRef?: ((ref: EvidenceRef) => void) | undefined;
  /** 보낸 session의 탭을 연다. 없으면 링크가 아니라 글이다. */
  onOpenSession?: ((session: string) => void) | undefined;
}

/** chip 아래로 펼쳐지는 panel: 맡긴 글, 근거 링크, 보낸 session 링크. */
export function SenderPanel(
  { message, sender, source, onOpenRef, onOpenSession }: SenderPanelProps,
): ReactElement {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  useEffect(() => {
    let live = true;
    setLoaded({ state: "loading" });
    void source.envelope(message).then((result) => {
      if (!live) return;
      setLoaded(
        result.ok
          ? { state: "ready", envelope: result.value }
          : { state: "failed" },
      );
    });
    return () => {
      live = false;
    };
  }, [source, message]);

  if (loaded.state !== "ready") {
    return (
      <section
        className={styles.senderPanel}
        aria-label={t("conversation.title.sender-details")}
        data-sender-panel={loaded.state}
      >
        <p className={styles.panelNote}>
          {t(
            loaded.state === "loading"
              ? "conversation.notice.sender-loading"
              : "conversation.notice.sender-unreadable",
          )}
        </p>
      </section>
    );
  }
  const { envelope } = loaded;
  return (
    <section
      className={styles.senderPanel}
      aria-label={t("conversation.title.sender-details")}
      data-sender-panel="ready"
    >
      <div className={styles.senderBlock}>
        <p className={styles.senderHead}>{t(HEAD[sender.kind])}</p>
        <p className={styles.senderTask} data-sender-task="">{envelope.task}</p>
      </div>
      {envelope.refs.length === 0 ? null : (
        <div className={styles.senderBlock}>
          <p className={styles.senderHead}>
            {t("conversation.label.sender-based-on")}
          </p>
          <ul className={styles.refList}>
            {envelope.refs.map((ref) => (
              <li key={`${ref.kind}:${ref.target}`} className={styles.refRow}>
                <span className={styles.refKind}>
                  {t(EVIDENCE_LABEL[ref.kind])}
                </span>
                <TextLink
                  onClick={ref.kind === "session"
                    ? onOpenSession === undefined
                      ? undefined
                      : () =>
                        onOpenSession(ref.target)
                    : onOpenRef === undefined
                    ? undefined
                    : () =>
                      onOpenRef(ref)}
                >
                  {ref.text}
                </TextLink>
              </li>
            ))}
          </ul>
        </div>
      )}
      {envelope.session === null ? null : (
        <div className={styles.senderBlock}>
          <p className={styles.senderHead}>
            {t("conversation.label.sender-sent-from")}
          </p>
          <p className={styles.sessionLink}>
            <SessionIcon sender={sender} />
            <TextLink
              onClick={onOpenSession === undefined
                ? undefined
                : () => onOpenSession(envelope.session!.id)}
            >
              {envelope.session.title}
            </TextLink>
          </p>
        </div>
      )}
    </section>
  );
}

function SessionIcon({ sender }: { sender: Sender }): ReactElement {
  const vendor = sender.kind === "coding" && sender.product !== null
    ? vendorOf(sender.product)
    : undefined;
  return vendor === undefined
    ? <Icon icon={commonIcons.openLink} pixels={iconPixels("small")} />
    : <VendorIcon vendor={vendor} size={14} />;
}

/** 누르면 탭을 여는 글. 열 길이 없으면 그냥 글이다. */
function TextLink(
  { onClick, children }: {
    onClick: (() => void) | undefined;
    children: ReactNode;
  },
): ReactElement {
  return onClick === undefined
    ? <span className={styles.plainRef}>{children}</span>
    : (
      <button type="button" className={styles.link} onClick={onClick}>
        {children}
      </button>
    );
}
