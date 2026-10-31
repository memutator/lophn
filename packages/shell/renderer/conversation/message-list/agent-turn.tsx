// 대화 줄의 부품. agent의 말 한 덩어리(AgentTurn과 Said), 내 메시지(UserMessage), 일하는 중
// 줄(WorkingRow). 조립은 부르는 쪽이 한다. 이 부품들은 children을 놓기만 하고 source 값을 읽지 않는다.
import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import { Avatar, type AvatarProfile } from "../../parts/avatar/avatar.tsx";
import { Icon, IconButton, useCopy } from "@lophn/ui/primitives";
import { Shimmer, useDelayedLoading } from "@lophn/ui/feedback";
import { Tooltip } from "@lophn/ui/overlay";
import { iconPixels, systemClipboard } from "@lophn/ui/shared";
import { conversationIcons, editorIcons } from "../../icons/mod.ts";
import { t } from "@lophn/i18n";

import { duration } from "../activity/worked-for.tsx";
import styles from "./turns.module.css";

// 일하는 중 줄에 걸린 시간을 붙이기 시작하는 때. 1~2초짜리 일에 숫자가 깜빡이지 않을 만큼 기다리되, omp의 5초처럼
// 오래 침묵하지 않고 ChatGPT처럼 1초부터 숫자가 튀지도 않게 3초를 고른다.
const ELAPSED_AFTER_MS = 3_000;
// 답이 더디면 한 줄로 이유를 짐작하게 한다. 30초는 느린 편, 90초는 큰 turn이나 붐비는 기계를 말한다.
const SLOW_AFTER_MS = 30_000;
const LONG_AFTER_MS = 90_000;
const TICK_MS = 1000;

/**
 * agent가 일하는 동안 대화 끝에 서는 한 줄. 300ms 안에 끝나는 일에는 보이지 않고, 3초가 넘으면 걸린 시간을
 * 붙인다. `clock`은 core가 센 active와 그 기준 시각이고, 모르면 이 줄이 처음 선 때부터 잰다.
 *
 * 사람이 답할 것(허락·질문)을 기다리는 동안에는 일하는 중이 아니라 그 사실을 말한다. 걸린 시간은 사람을
 * 기다린 시간을 빼고 센 값이라 그때는 붙이지 않는다. 글을 쓰는 중이면 그 글 자체가 진행 표시라 30초 줄은
 * 생략하고, 90초가 넘으면 쓰는 중이어도 오래 걸린다고 말한다.
 */
export function WorkingRow({
  clock,
  now,
  waiting,
  streaming = false,
  activity,
}: {
  clock: { activeMs: number; at: number } | null;
  now: () => number;
  /** 사람의 답을 기다리는 종류. 없으면 agent가 일하는 중이다. */
  waiting?: "approval" | "answer";
  /** 쓰는 중인 글이 보이고 있다. */
  streaming?: boolean;
  /**
   * 지금 하는 일 한 줄(도는 tool의 제목, 또는 reasoning 중이면 "Thinking"). Messages 보기는 tool 줄과 reasoning을 숨겨
   * 오래 걸리는 turn이 멈춘 것처럼 보이므로 이 줄이 진행을 말한다. 모든 보기에서 같은 한 줄을 보인다.
   */
  activity?: string | undefined;
}): ReactElement | null {
  const shown = useDelayedLoading(true);
  const [start] = useState(now);
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  if (!shown) return null;
  if (waiting !== undefined) {
    return (
      <div
        className={styles.working}
        data-working=""
        data-waiting=""
        role="status"
      >
        {waiting === "approval"
          ? t("conversation.label.status-waiting-approval")
          : t("conversation.label.status-waiting-answer")}
      </div>
    );
  }
  const elapsed =
    clock === null
      ? Math.max(0, now() - start)
      : Math.max(0, clock.activeMs + now() - clock.at);
  const hint =
    elapsed >= LONG_AFTER_MS
      ? t("conversation.label.status-slow")
      : elapsed >= SLOW_AFTER_MS && !streaming
        ? t("conversation.label.status-still-working")
        : null;
  return (
    <div className={styles.working} data-working="" role="status">
      <Shimmer>{t("conversation.label.status-working")}</Shimmer>
      {elapsed >= ELAPSED_AFTER_MS ? (
        <span className={styles.elapsed} aria-hidden="true">
          {duration(elapsed)}
        </span>
      ) : null}
      {activity === undefined ? null : (
        <span className={styles.activity} data-activity="">
          {t("conversation.label.status-activity", { activity })}
        </span>
      )}
      {hint === null ? null : (
        <span
          className={styles.hint}
          data-long={elapsed >= LONG_AFTER_MS ? "" : undefined}
        >
          {hint}
        </span>
      )}
    </div>
  );
}

/**
 * agent의 말 한 덩어리. 왼쪽 열에 avatar·이름·시각이 위에 한 번 있고, 이어지는 말과 tool 줄·카드는 같은 덩어리
 * 안에서 그 아래에 이름 없이 이어진다. 카드는 이 열의 폭을 다 쓴다. 아래 줄에 시각과 [Copy]·[Fork from here]를,
 * 마지막으로 끝난 turn의 덩어리면 [Retry]도 둔다. 대화의 마지막 덩어리면 늘 보이며 그 밖에는 hover에서 보인다.
 */
export function AgentTurn({
  agent,
  time,
  actionTime,
  copyText,
  onFork,
  onRetry,
  children,
}: {
  agent: { readonly name: string; readonly profile: AvatarProfile };
  time: string;
  /** 아래 줄의 시각. 사람 메시지와 같은 모양이다. */
  actionTime?: string;
  /** 덩어리에서 글이 비어 있지 않은 마지막 agent 메시지. 누를 때 읽는다. */
  copyText?: () => string;
  /** 이 덩어리의 마지막 agent 메시지까지를 새 session으로 복사한다. */
  onFork?: () => void;
  /** 끝난 turn의 입력을 새 메시지로 다시 보낸다. */
  onRetry?: () => void;
  children: ReactNode;
}): ReactElement {
  const forkLabel = t("conversation.button.fork-here");
  const retryLabel = t("conversation.button.retry");
  return (
    <div className={styles.agentTurn} data-agent-turn="" data-side="start">
      <div className={styles.agentHead}>
        <Avatar profile={agent.profile} size="md" />
        <span className={styles.agentName} data-agent-name="">
          {agent.name}
        </span>
        <span className={styles.agentTime} data-turn-time="">
          {time}
        </span>
      </div>
      <div className={styles.agentBody}>{children}</div>
      {actionTime === undefined &&
      copyText === undefined &&
      onFork === undefined &&
      onRetry === undefined ? null : (
        <div className={styles.messageActions} data-message-actions="">
          {actionTime === undefined || actionTime === "" ? null : (
            <span className={styles.messageTime} data-message-time="">
              {actionTime}
            </span>
          )}
          {copyText === undefined ? null : <CopyText text={copyText} />}
          {onFork === undefined ? null : (
            <Tooltip content={forkLabel}>
              <IconButton
                icon={conversationIcons.newSession}
                label={forkLabel}
                size="sm"
                onClick={onFork}
              />
            </Tooltip>
          )}
          {onRetry === undefined ? null : (
            <Tooltip content={retryLabel}>
              <IconButton
                icon={conversationIcons.resend}
                label={retryLabel}
                size="sm"
                onClick={onRetry}
              />
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

/** agent의 글. */
export function Said({
  children,
  id,
}: {
  children: ReactNode;
  id?: string;
}): ReactElement {
  return (
    <div
      className={styles.said}
      data-message={id}
      data-actor={id === undefined ? undefined : "agent"}
    >
      {children}
    </div>
  );
}

/**
 * 내 메시지. 오른쪽 bubble이고 이름·avatar는 없다. bubble 아래 줄에 시각과 [Copy]·[Rewind to here]·[Fork]가
 * 있고 hover나 focus에서 보인다. [Rewind to here]를 누르면 부르는 쪽이 rewind panel을 연다. 도는 turn에 steer로
 * 들어간 메시지는 rewind 시점이 아니라서 그 단추 대신 steer 표시가 붙는다. 보내는 중인 말은 bubble이 옅다.
 */
export function UserMessage({
  children,
  id,
  steer = false,
  sending = false,
  time,
  copyText,
  rewindOpen = false,
  onRewind,
  onFork,
}: {
  children: ReactNode;
  id?: string;
  steer?: boolean;
  /** 아직 받았다는 답이 오지 않았다. */
  sending?: boolean;
  time?: string;
  /** 메시지 글. 누를 때 읽는다. */
  copyText?: () => string;
  /** rewind panel이 이 메시지를 가리켜 열려 있다. 단추가 계속 보인다. */
  rewindOpen?: boolean;
  onRewind?: () => void;
  /** 이 메시지까지의 확정 메시지를 복사한다. */
  onFork?: () => void;
}): ReactElement {
  const rewindable = onRewind !== undefined && !steer;
  const rewindLabel = t("conversation.button.rewind-here");
  const forkLabel = t("conversation.button.fork-here");
  return (
    <div
      className={styles.userTurn}
      data-message={id}
      data-actor={id === undefined ? undefined : "user"}
      data-side="end"
      data-open={rewindOpen ? "" : undefined}
      data-sending={sending ? "" : undefined}
    >
      <div className={styles.bubble}>{children}</div>
      {steer ? (
        <span className={styles.steerMark} data-steer="">
          <Icon icon={conversationIcons.steer} pixels={iconPixels("small")} />
          {t("conversation.label.steer")}
        </span>
      ) : null}
      <div className={styles.messageActions} data-message-actions="">
        {time === undefined || time === "" ? null : (
          <span className={styles.messageTime} data-message-time="">
            {time}
          </span>
        )}
        {copyText === undefined ? null : <CopyText text={copyText} />}
        {rewindable ? (
          <Tooltip content={rewindLabel}>
            <IconButton
              icon={editorIcons.restore}
              label={rewindLabel}
              size="sm"
              aria-expanded={rewindOpen}
              onClick={onRewind}
            />
          </Tooltip>
        ) : null}
        {onFork === undefined ? null : (
          <Tooltip content={forkLabel}>
            <IconButton
              icon={conversationIcons.newSession}
              label={forkLabel}
              size="sm"
              onClick={onFork}
            />
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/** 메시지 글을 복사하는 단추. 복사하면 잠시 check로 바뀐다. */
function CopyText({ text }: { text: () => string }): ReactElement {
  const { failed, copied, copy } = useCopy(systemClipboard);
  const label = t("common.button.copy");
  return (
    <Tooltip
      content={
        failed
          ? t("common.copy.failed")
          : copied
            ? t("common.label.copied")
            : label
      }
    >
      <IconButton
        icon={copied ? conversationIcons.copied : conversationIcons.copy}
        label={label}
        size="sm"
        data-copy-message=""
        onClick={() => copy(text())}
      />
    </Tooltip>
  );
}
