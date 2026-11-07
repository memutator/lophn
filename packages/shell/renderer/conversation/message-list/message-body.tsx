// Agent 화면 대화 줄 안의 본문. 메시지의 본문(ACP의 content block, reasoning, 앱 카드)을 글(agent는 markdown,
// 사람은 plain)과 앱 카드, reasoning 줄로 보이고, 보내지 못했거나 결과를 모르는 사람 말 아래에 다음 행동을 둔다.
import type { ReactElement, ReactNode } from "react";
import { memo } from "react";
import { IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { conversationIcons } from "../../icons/mod.ts";
import { t } from "@lophn/i18n";

import { VisualBlock } from "../../workspace/visuals/block-frame.tsx";
import type { DeliveryAction } from "../delivery-state.ts";
import type { BodyPart } from "../agent-tab-source.ts";
import type { ArtifactsSlice } from "../../workspace/kinds/host.ts";
import { ArtifactText } from "./artifact-text.tsx";
import { ChatMarkdown } from "./chat-markdown.tsx";
import { MessageAttachments } from "./message-attachments.tsx";
import { Reasoning } from "./reasoning.tsx";
import styles from "./message-body.module.css";

interface MessageBodyProps {
  message: string;
  parts: readonly BodyPart[];
  /** 글 안 artifact path를 link로 그리는 길. 없으면 글 그대로다. */
  artifacts?: ArtifactsSlice | undefined;
  /** image block의 그림 주소. */
  imageUrl?: ((id: string) => Promise<string | null>) | undefined;
  /** 첨부한 파일 chip을 눌렀다. */
  onOpenFile?: ((path: string) => void) | undefined;
  /** 사람 글. markdown으로 읽지 않고 글 그대로 보인다. */
  plain?: boolean;
  /** reasoning part를 그린다. 없으면 false다. 사람 말과 받은 메시지는 넘기지 않는다. */
  reasoning?: boolean;
}

/** 본문의 글과 블록을 차례로 보인다. 다 쓴 message는 live 글이 자라도 다시 그리지 않는다. */
export const MessageBody = memo(function MessageBody({
  message,
  parts,
  artifacts,
  imageUrl,
  onOpenFile,
  plain,
  reasoning,
}: MessageBodyProps): ReactElement {
  // 이미지와 링크는 한 줄로 모아 글 위에 보이고, 앱 카드는 본문 순서 그대로 글 사이 자리에 그린다.
  const images = parts.flatMap((part) =>
    part.kind === "image" ? [part.blob] : [],
  );
  const links = parts.flatMap((part) =>
    part.kind === "resource_link" ? [{ uri: part.uri, name: part.name }] : [],
  );
  return (
    <div className={styles.body} data-body="ready">
      <MessageAttachments
        links={links}
        images={images}
        imageUrl={imageUrl}
        onOpenFile={onOpenFile}
      />
      {parts.map((part, index) => {
        switch (part.kind) {
          case "text":
            return plain ? (
              <ArtifactText
                key={index}
                text={part.text}
                artifacts={artifacts}
              />
            ) : (
              <ChatMarkdown
                key={index}
                text={part.text}
                artifacts={artifacts}
              />
            );
          case "image":
          case "resource_link":
            return null;
          case "resource":
            return (
              <div key={index} className={styles.resource} data-resource="">
                <span className={styles.resourceUri}>{part.uri}</span>
                <ArtifactText text={part.text} artifacts={artifacts} />
              </div>
            );
          case "app_card":
            return (
              <VisualBlock
                key={index}
                message={message}
                block={`card-${index}`}
                card={{
                  app: part.app,
                  release: null,
                  view: part.view,
                  ...(part.params === undefined ? {} : { params: part.params }),
                }}
                title={part.view}
              />
            );
          case "reasoning":
            return reasoning === true ? (
              <Reasoning
                key={index}
                text={part.text}
                durationMs={part.durationMs}
                thinking={false}
                artifacts={artifacts}
              />
            ) : null;
        }
      })}
    </div>
  );
});

interface UserBodyProps extends MessageBodyProps {
  /** 전달 상태가 사람에게 요구하는 다음 행동. 확정 메시지는 "none"이다. */
  action: DeliveryAction;
  onCheck: () => void;
  onResend: () => void;
}

/**
 * 내 말의 본문. 이미지와 파일 chip은 글 위에 보인다. 잘 받은 말에는 표시가 없고, 보내지 못했거나 결과를 모르면
 * 다음 행동을 곁들인다.
 */
export function UserBody({
  action,
  onCheck,
  onResend,
  ...rest
}: UserBodyProps): ReactElement {
  return (
    <div className={styles.mine} data-user-body="">
      <MessageBody {...rest} plain />
      {action === "edit" ? (
        <Notice>{t("conversation.notice.not-sent")}</Notice>
      ) : null}
      {action === "check" ? (
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
      ) : null}
      {action === "resend" ? (
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
      ) : null}
    </div>
  );
}

function Notice({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}): ReactElement {
  return (
    <div className={styles.notice}>
      <span>{children}</span>
      {action}
    </div>
  );
}
