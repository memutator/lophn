import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import {
  conversationIcons,
  IconButton,
  Tooltip,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { deliveryAction } from "../delivery-state.ts";
import type { BodyState } from "../drafts.ts";
import { atBottom, type DeliveryLabel, type ListItem } from "../model.ts";
import { ResultLinks } from "../result-links.tsx";
import type { BodyPart, ConversationSource } from "../source.ts";
import styles from "./message-list.module.css";

export interface MessageListProps {
  items: readonly ListItem[];
  /** 이 창이 보낸 말의 글. 메시지 id로 찾는다. 본문을 읽기 전 자리를 채운다. */
  textOf: (message: string) => string | undefined;
  /** 확정 메시지 본문을 읽은 결과(ReadMessageBody). */
  bodyOf: (message: string) => BodyState | undefined;
  source: ConversationSource;
  /** 열 때 돌아갈 읽던 위치. null이면 맨 아래다. */
  initialScroll: number | null;
  onScroll: (position: number | null) => void;
  onCheck: () => void;
  onResend: () => void;
  onOpenResult?: (document: string, version: string | null) => void;
}

const DELIVERY_LABEL: Record<
  DeliveryLabel,
  | "conversation.label.delivery-sending"
  | "conversation.label.delivery-received"
  | "conversation.label.delivery-applied"
  | "conversation.label.delivery-saved"
  | "conversation.label.delivery-not-sent"
  | "conversation.label.delivery-unconfirmed"
> = {
  sending: "conversation.label.delivery-sending",
  received: "conversation.label.delivery-received",
  applied: "conversation.label.delivery-applied",
  saved: "conversation.label.delivery-saved",
  "not-sent": "conversation.label.delivery-not-sent",
  unconfirmed: "conversation.label.delivery-unconfirmed",
};

function Text({ text }: { text: string }) {
  return <p className={styles.text}>{text}</p>;
}

// 시각 블록 자리. 블록 renderer(shell#T35)가 들어오기 전까지 제목만 글로 보이고 내용은
// 그리지 않는다. payload는 이 화면에 오지 않는다.
function VisualPending(
  { part }: { part: Extract<BodyPart, { kind: "visual" }> },
) {
  return (
    <div className={styles.visual} data-visual-pending={part.visual}>
      <span className={styles.visualTitle}>{part.title}</span>
      <span className={styles.visualNote}>
        {t("conversation.notice.visual-pending")}
      </span>
    </div>
  );
}

/**
 * 확정 메시지 본문. 읽은 본문의 글과 블록을 차례로 보인다. 읽기 전이나 읽지 못했을 때
 * 이 창이 보낸 글이 있으면 그것을, 없으면 그 상태를 말한다. 빈 말로 보이지 않는다.
 */
function Body(
  { body, fallback }: {
    body: BodyState | undefined;
    fallback: string | undefined;
  },
) {
  if (body?.state === "ready") {
    return (
      <div className={styles.body} data-body="ready">
        {body.parts.map((part, index) =>
          part.kind === "text"
            ? <Text key={index} text={part.text} />
            : <VisualPending key={index} part={part} />
        )}
      </div>
    );
  }
  if (fallback !== undefined) return <Text text={fallback} />;
  if (body?.state === "failed") {
    return (
      <p className={styles.unreadable} data-unreadable="">
        {t("conversation.error.message-body")}
      </p>
    );
  }
  return (
    <p className={styles.loading} data-body="loading">
      {t("conversation.notice.message-loading")}
    </p>
  );
}

// 대화 목록. 새 답이 와도 사람이 올려 읽던 위치와 입력 focus를 건드리지 않는다
// (shell/workspace#R13). 맨 아래를 보고 있을 때만 새 말을 따라 내려간다.
export function MessageList(
  {
    items,
    textOf,
    bodyOf,
    source,
    initialScroll,
    onScroll,
    onCheck,
    onResend,
    onOpenResult,
  }: MessageListProps,
) {
  const listRef = useRef<HTMLDivElement>(null);
  const following = useRef(initialScroll === null);
  const seen = useRef(items.length);
  const [unseen, setUnseen] = useState(0);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = initialScroll ?? list.scrollHeight;
    // 처음 위치만 돌려놓는다. 그 뒤는 사람의 scroll이 정한다.
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    const added = items.length - seen.current;
    seen.current = items.length;
    if (!list || added <= 0) return;
    if (following.current) list.scrollTop = list.scrollHeight;
    else setUnseen((count) => count + added);
  }, [items.length]);

  const handleScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const bottom = atBottom(
      list.scrollTop,
      list.scrollHeight,
      list.clientHeight,
    );
    following.current = bottom;
    if (bottom) setUnseen(0);
    onScroll(bottom ? null : list.scrollTop);
  };

  const jump = () => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
    following.current = true;
    setUnseen(0);
    onScroll(null);
  };

  return (
    <div className={styles.frame}>
      <div
        className={styles.list}
        ref={listRef}
        onScroll={handleScroll}
        data-message-list=""
        role="log"
        aria-live="off"
      >
        {items.length === 0
          ? (
            <p className={styles.empty}>
              {t("conversation.empty.no-messages")}
            </p>
          )
          : items.map((item) => (
            <Row
              key={item.key}
              item={item}
              textOf={textOf}
              bodyOf={bodyOf}
              source={source}
              onCheck={onCheck}
              onResend={onResend}
              onOpenResult={onOpenResult}
            />
          ))}
      </div>
      {unseen > 0
        ? (
          <div className={styles.jump}>
            <Tooltip content={t("conversation.button.jump-latest")}>
              <IconButton
                icon={conversationIcons.jumpLatest}
                label={t("conversation.button.jump-latest")}
                variant="secondary"
                size="sm"
                data-jump-latest={unseen}
                onClick={jump}
              />
            </Tooltip>
          </div>
        )
        : null}
    </div>
  );
}

interface RowProps {
  item: ListItem;
  textOf: (message: string) => string | undefined;
  bodyOf: (message: string) => BodyState | undefined;
  source: ConversationSource;
  onCheck: () => void;
  onResend: () => void;
  onOpenResult?: (document: string, version: string | null) => void;
}

function Row(
  { item, textOf, bodyOf, source, onCheck, onResend, onOpenResult }: RowProps,
) {
  if (item.kind === "outgoing") {
    const { outgoing } = item;
    const action = deliveryAction(outgoing);
    return (
      <Mine
        id={outgoing.id}
        text={<Text text={outgoing.text} />}
        correction={outgoing.mode === "correction"}
        delivery={item.delivery}
        provisional
      >
        {action === "edit"
          ? <Notice>{t("conversation.notice.not-sent")}</Notice>
          : null}
        {action === "check"
          ? (
            <Notice
              action={
                <Tooltip content={t("conversation.button.check-delivery")}>
                  <IconButton
                    icon={conversationIcons.checkDelivery}
                    label={t("conversation.button.check-delivery")}
                    variant="secondary"
                    size="sm"
                    data-check-delivery=""
                    onClick={onCheck}
                  />
                </Tooltip>
              }
            >
              {t("conversation.notice.unconfirmed")}
            </Notice>
          )
          : null}
        {action === "resend"
          ? (
            <Notice
              action={
                <Tooltip content={t("conversation.button.resend")}>
                  <IconButton
                    icon={conversationIcons.resend}
                    label={t("conversation.button.resend")}
                    variant="secondary"
                    size="sm"
                    data-resend=""
                    onClick={onResend}
                  />
                </Tooltip>
              }
            >
              {t("conversation.notice.not-found")}
            </Notice>
          )
          : null}
      </Mine>
    );
  }
  const { message } = item;
  if (message.actor === "user") {
    return (
      <Mine
        id={message.id}
        text={<Body body={bodyOf(message.id)} fallback={textOf(message.id)} />}
        correction={message.mode === "correction"}
        delivery={item.delivery ?? "received"}
        provisional={false}
      />
    );
  }
  if (message.actor === "machine") {
    return (
      <div
        className={styles.fact}
        data-message={message.id}
        data-actor="machine"
      >
        <span className={styles.author}>
          {t("conversation.label.author-check")}
        </span>
        <Body body={bodyOf(message.id)} fallback={undefined} />
      </div>
    );
  }
  return (
    <div className={styles.theirs} data-message={message.id} data-actor="agent">
      <span className={styles.author}>
        {t("conversation.label.author-lophn")}
      </span>
      <Body body={bodyOf(message.id)} fallback={undefined} />
      <ResultLinks
        links={message.results}
        source={source}
        onOpen={onOpenResult}
      />
    </div>
  );
}

interface MineProps {
  id: string;
  text: ReactNode;
  correction: boolean;
  delivery: DeliveryLabel;
  provisional: boolean;
  children?: ReactNode;
}

// 사람의 말. 접수 표시를 말 아래에 둔다. 확정 전 말은 임시 표시다.
function Mine(
  { id, text, correction, delivery, provisional, children }: MineProps,
) {
  return (
    <div
      className={styles.mine}
      data-message={id}
      data-actor="user"
      data-provisional={provisional || undefined}
    >
      <div className={styles.bubble}>{text}</div>
      <span className={styles.meta}>
        {correction
          ? (
            <span className={styles.tag}>
              {t("conversation.label.correction")}
            </span>
          )
          : null}
        <span data-delivery={delivery}>{t(DELIVERY_LABEL[delivery])}</span>
      </span>
      {children}
    </div>
  );
}

function Notice(
  { children, action }: { children: ReactNode; action?: ReactNode },
) {
  return (
    <div className={styles.notice}>
      <span>{children}</span>
      {action}
    </div>
  );
}
