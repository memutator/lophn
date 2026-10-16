// Agent 화면 대화 줄 안의 본문. 확정 메시지 본문을 읽은 결과를 글과 앱 카드로 보이고, 사람 말 아래에 전달 상태와
// 다음 행동을 둔다.
import type { ReactElement, ReactNode } from "react";
import { IconButton, Tooltip } from "@lophn/design/components";
import { conversationIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import { VisualBlock } from "../../workspace/visuals/block-frame.tsx";
import { cardOfBlock } from "../../workspace/visuals/registry.ts";
import type { DeliveryLabel } from "../agent-view-model.ts";
import type { DeliveryAction } from "../delivery-state.ts";
import type { BodyState } from "../drafts.ts";
import styles from "./message-body.module.css";

const DELIVERY_LABEL: Record<
  DeliveryLabel,
  | "conversation.label.delivery-sending"
  | "conversation.label.delivery-received"
  | "conversation.label.delivery-not-sent"
  | "conversation.label.delivery-unconfirmed"
> = {
  sending: "conversation.label.delivery-sending",
  received: "conversation.label.delivery-received",
  "not-sent": "conversation.label.delivery-not-sent",
  unconfirmed: "conversation.label.delivery-unconfirmed",
};

function Text({ text }: { text: string }): ReactElement {
  return <p className={styles.text}>{text}</p>;
}

export interface MessageBodyProps {
  message: string;
  /** 확정 메시지 본문을 읽은 결과(ReadMessageBody). */
  body: BodyState | undefined;
  /** 이 창이 보낸 말의 글. 본문을 읽기 전 자리를 채운다. */
  fallback?: string | undefined;
}

/**
 * 읽은 본문의 글과 블록을 차례로 보인다. 읽기 전이나 읽지 못했을 때 이 창이 보낸 글이 있으면 그것을,
 * 없으면 그 상태를 말한다. 빈 말로 보이지 않는다.
 */
export function MessageBody(
  { message, body, fallback }: MessageBodyProps,
): ReactElement {
  if (body?.state === "ready") {
    // 앱 카드는 본문 순서 그대로 글 사이 자리에 그린다.
    return (
      <div className={styles.body} data-body="ready">
        {body.parts.map((part, index) => {
          switch (part.kind) {
            case "text":
              return <Text key={index} text={part.text} />;
            case "app_card":
              return (
                <VisualBlock
                  key={index}
                  message={message}
                  block={`card-${index}`}
                  card={{ app: part.app, release: null, view: part.view }}
                  title={part.view}
                />
              );
            case "visual": {
              const found = cardOfBlock(part.block);
              return (
                <VisualBlock
                  key={index}
                  message={message}
                  block={`card-${index}`}
                  card={found?.card ?? null}
                  title={found?.title ??
                    t("conversation.label.visual-untitled")}
                />
              );
            }
            case "attached":
              return (
                <p key={index} className={styles.attached} data-attached="">
                  {part.line === undefined
                    ? part.name
                    : `${part.name} · ${part.line}`}
                </p>
              );
          }
        })}
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

export interface UserBodyProps extends MessageBodyProps {
  delivery: DeliveryLabel;
  /** 아직 확정되지 않은 말이다. */
  provisional: boolean;
  /** 전달 상태가 사람에게 요구하는 다음 행동. 확정 메시지는 "none"이다. */
  action: DeliveryAction;
  onCheck: () => void;
  onResend: () => void;
}

/** 내 말의 본문. 접수 표시를 말 아래에 두고, 보내지 못했거나 결과를 모르면 다음 행동을 곁들인다. */
export function UserBody(
  { delivery, provisional, action, onCheck, onResend, ...rest }: UserBodyProps,
): ReactElement {
  return (
    <div
      className={styles.mine}
      data-user-body=""
      data-provisional={provisional || undefined}
    >
      <MessageBody {...rest} />
      <span className={styles.meta}>
        <span data-delivery={delivery}>{t(DELIVERY_LABEL[delivery])}</span>
      </span>
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
    </div>
  );
}

function Notice(
  { children, action }: { children: ReactNode; action?: ReactNode },
): ReactElement {
  return (
    <div className={styles.notice}>
      <span>{children}</span>
      {action}
    </div>
  );
}
