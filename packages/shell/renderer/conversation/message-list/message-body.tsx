// Agent 화면 대화 줄 안의 본문. 확정 메시지 본문을 읽은 결과를 글(agent는 markdown, 사람은 plain)과 앱 카드로
// 보이고, 보내지 못했거나 결과를 모르는 사람 말 아래에 다음 행동을 둔다.
import type { ReactElement, ReactNode } from "react";
import { IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { conversationIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import { VisualBlock } from "../../workspace/visuals/block-frame.tsx";
import type { DeliveryAction } from "../delivery-state.ts";
import type { BodyState } from "../drafts.ts";
import type { ArtifactsSlice } from "../../workspace/kinds/host.ts";
import { ArtifactText } from "./artifact-text.tsx";
import { ChatMarkdown } from "./chat-markdown.tsx";
import { MessageAttachments } from "./message-attachments.tsx";
import { splitAttachmentText } from "../../../../protocol/lophn-agent/message-attachments.ts";
import { textOfBody } from "../agent-view-model.ts";
import styles from "./message-body.module.css";

interface MessageBodyProps {
  message: string;
  /** 확정 메시지 본문을 읽은 결과(ReadMessageBody). */
  body: BodyState | undefined;
  /** 이 창이 보낸 말의 글. 본문을 읽기 전 자리를 채운다. */
  fallback?: string | undefined;
  /** 글 안 artifact path를 link로 그리는 길. 없으면 글 그대로다. */
  artifacts?: ArtifactsSlice | undefined;
  /** 사람 글. markdown으로 읽지 않고 글 그대로 보인다. */
  plain?: boolean;
}

/**
 * 읽은 본문의 글과 블록을 차례로 보인다. 읽기 전이나 읽지 못했을 때 이 창이 보낸 글이 있으면 그것을,
 * 없으면 그 상태를 말한다. 빈 말로 보이지 않는다.
 */
export function MessageBody(
  { message, body, fallback, artifacts, plain }: MessageBodyProps,
): ReactElement {
  if (body?.state === "ready") {
    // 앱 카드는 본문 순서 그대로 글 사이 자리에 그린다.
    return (
      <div className={styles.body} data-body="ready">
        {body.parts.map((part, index) => {
          switch (part.kind) {
            case "text":
              return plain
                ? (
                  <ArtifactText
                    key={index}
                    text={part.text}
                    artifacts={artifacts}
                  />
                )
                : (
                  <ChatMarkdown
                    key={index}
                    text={part.text}
                    artifacts={artifacts}
                  />
                );
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
          }
        })}
      </div>
    );
  }
  if (fallback !== undefined) {
    return plain
      ? <ArtifactText text={fallback} artifacts={artifacts} />
      : <ChatMarkdown text={fallback} artifacts={artifacts} />;
  }
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

interface UserBodyProps extends MessageBodyProps {
  /** 첨부한 이미지의 그림 주소. */
  imageUrl?: (id: string) => Promise<string | null>;
  /** 첨부한 파일 chip을 눌렀다. */
  onOpenFile?: ((path: string) => void) | undefined;
  /** 전달 상태가 사람에게 요구하는 다음 행동. 확정 메시지는 "none"이다. */
  action: DeliveryAction;
  onCheck: () => void;
  onResend: () => void;
}

/**
 * 내 말의 본문. 글 끝의 첨부 줄은 떼어 글 위에 chip과 그림으로 보인다. 잘 받은 말에는 표시가 없고, 보내지
 * 못했거나 결과를 모르면 다음 행동을 곁들인다.
 */
export function UserBody(
  { action, onCheck, onResend, imageUrl, onOpenFile, ...rest }: UserBodyProps,
): ReactElement {
  const raw = textOfBody(rest.body) ?? rest.fallback;
  const split = raw === undefined ? null : splitAttachmentText(raw);
  const attached = split !== null &&
    (split.files.length > 0 || split.images.length > 0);
  return (
    <div className={styles.mine} data-user-body="">
      {attached
        ? (
          <MessageAttachments
            files={split.files}
            images={split.images}
            imageUrl={imageUrl}
            onOpenFile={onOpenFile}
          />
        )
        : null}
      {attached && split.text === "" ? null : (
        <MessageBody
          {...rest}
          {...(attached
            ? {
              body: {
                state: "ready",
                parts: [{ kind: "text", text: split.text }],
              },
              fallback: split.text,
            }
            : {})}
          plain
        />
      )}
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
