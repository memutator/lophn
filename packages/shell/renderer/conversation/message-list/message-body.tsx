// Agent 화면 대화 줄 안의 본문. 확정 메시지 본문을 읽은 결과를 글(agent는 markdown, 사람은 plain)과 앱 카드,
// reasoning 줄로 보이고, 보내지 못했거나 결과를 모르는 사람 말 아래에 다음 행동을 둔다.
import type { ReactElement, ReactNode } from "react";
import { memo } from "react";
import { IconButton } from "@lophn/ui/primitives";
import { Skeleton, useDelayedLoading } from "@lophn/ui/feedback";
import { Tooltip } from "@lophn/ui/overlay";
import { conversationIcons } from "../../icons/mod.ts";
import { t } from "@lophn/i18n";

import { VisualBlock } from "../../workspace/visuals/block-frame.tsx";
import type { DeliveryAction } from "../delivery-state.ts";
import type { BodyState } from "../drafts.ts";
import type { ArtifactsSlice } from "../../workspace/kinds/host.ts";
import { ArtifactText } from "./artifact-text.tsx";
import { ChatMarkdown } from "./chat-markdown.tsx";
import { MessageAttachments } from "./message-attachments.tsx";
import { Reasoning } from "./reasoning.tsx";
import styles from "./message-body.module.css";

interface MessageBodyProps {
  message: string;
  /** 확정 메시지 본문을 읽은 결과(ReadMessageBody). */
  body: BodyState | undefined;
  /** 이 창이 보낸 말의 글. 본문을 읽기 전 자리를 채운다. */
  fallback?: string | undefined;
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
  /** 본문을 읽기 전 reasoning 자리. 글이 없는 응답이 저장되는 순간 live 줄이 사라져 빈 틈이 생기지 않게 한다. */
  fallbackReasoning?: string | undefined;
}

/**
 * 읽은 본문의 글과 블록을 차례로 보인다. 읽기 전이나 읽지 못했을 때 이 창이 보낸 글이 있으면 그것을,
 * 없으면 그 상태를 말한다. 빈 말로 보이지 않는다. 다 쓴 message는 live 글이 자라도 다시 그리지 않는다.
 */
export const MessageBody = memo(function MessageBody({
  message,
  body,
  fallback,
  artifacts,
  imageUrl,
  onOpenFile,
  plain,
  reasoning,
  fallbackReasoning,
}: MessageBodyProps): ReactElement {
  if (body?.state === "ready") {
    // 이미지와 링크는 한 줄로 모아 글 위에 보이고, 앱 카드는 본문 순서 그대로 글 사이 자리에 그린다.
    const images = body.parts.flatMap((part) =>
      part.kind === "image" ? [part.blob] : [],
    );
    const links = body.parts.flatMap((part) =>
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
        {body.parts.map((part, index) => {
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
                  card={{ app: part.app, release: null, view: part.view }}
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
  }
  if (fallback !== undefined) {
    return plain ? (
      <ArtifactText text={fallback} artifacts={artifacts} />
    ) : (
      <ChatMarkdown text={fallback} artifacts={artifacts} />
    );
  }
  if (
    body?.state !== "failed" &&
    reasoning === true &&
    fallbackReasoning !== undefined
  ) {
    return (
      <div className={styles.body} data-body="loading">
        <Reasoning
          text={fallbackReasoning}
          durationMs={null}
          thinking={false}
          artifacts={artifacts}
        />
      </div>
    );
  }
  if (body?.state === "failed") {
    return (
      <p className={styles.unreadable} data-unreadable="">
        {t("conversation.error.message-body")}
      </p>
    );
  }
  return <LoadingBody />;
});

// 본문을 아직 읽는 중. 300ms 안에 끝나면 아무것도 그리지 않고, 늦어지면 자리만 보인다.
// 화면 읽기는 skeleton 대신 한 문장을 읽는다.
function LoadingBody(): ReactElement {
  const shown = useDelayedLoading(true);
  return (
    <div className={styles.loadingBody} data-body="loading">
      <span className={styles.srOnly}>
        {t("conversation.notice.message-loading")}
      </span>
      {shown ? <Skeleton lines={3} /> : null}
    </div>
  );
}

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
