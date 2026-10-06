// 시각 블록 틀(shell/workspace#R12, R13). 제목·설명·관측 시각·출처와 내용 또는 이용 불가 이유,
// [Save as document]와 저장 뒤 고정 문서 링크를 한 자리에 둔다. 블록마다 따로 검사하고 따로 그려
// 한 블록의 실패·빈 값·열 수 없는 출처가 다른 블록이나 입력을 막지 않는다. 틀은 focus를 스스로
// 옮기지 않고 scroll을 건드리지 않는다.
//
// 문서로 남기기는 별도 저장 contract가 없다(lophn-agent Q45 (6)). 버튼은 "이 블록을 문서로 남겨
// 달라"는 요청을 대화 입력으로 보내고, agent가 visual.prepare_document와 문서 tool로 준비·저장한다.
// 고정 문서 링크는 그 요청에 답한 메시지의 결과 링크에서 온다.
import { Component, type ReactNode, useMemo, useRef, useState } from "react";
import { Button, conversationIcons } from "@lophn/design/components";
import { formatDate, t } from "@lophn/wording";

import { ChartBlock } from "./chart-block.tsx";
import { DiagramBlock } from "./diagram-block.tsx";
import { DocumentLink, type TitleRead } from "./document-block.tsx";
import {
  checkVisual,
  observedAt,
  type Unavailable,
  type VisualSource,
} from "./registry.ts";
import { TableBlock } from "./table-block.tsx";
import styles from "./visuals.module.css";

/** 문서로 남기기 요청의 진행. 창 메모리의 요청과 대화 기록에서 계산한다. */
export type SaveState =
  | { readonly state: "idle" }
  /** 요청을 보내는 중이거나 접수를 확인하는 중이다. */
  | { readonly state: "sending" }
  /** 요청을 보내지 못했다. 다시 누를 수 있다. */
  | { readonly state: "failed" }
  /** 요청이 접수됐고 아직 답이 없다. */
  | { readonly state: "requested" }
  /** 요청한 일이 끝났지만 저장한 문서가 없다. 그 이유는 답이 말한다. */
  | { readonly state: "not-saved" }
  | {
    readonly state: "saved";
    readonly links: readonly {
      readonly document: string;
      readonly version: string | null;
    }[];
  };

export const IDLE: SaveState = { state: "idle" };

export interface SaveRequest {
  readonly message: string;
  readonly block: string;
  readonly title: string;
}

/** 블록 틀이 대화 화면에서 받는 것. */
export interface VisualHost {
  documentTitle: (document: string) => Promise<TitleRead>;
  /** 고정 문서 판을 연다. 없으면 링크를 누를 수 없다. */
  open?: (document: string, version: string | null) => void;
  /** 문서로 남기기 요청을 보낸다. 없으면(끝난 세션, 읽기 전용 자리) 버튼을 두지 않는다. */
  save?: (request: SaveRequest) => void;
  /** 지금 요청을 보낼 수 없다(연결 끊김, 다른 말을 보내는 중). 버튼만 잠근다. */
  saveLocked?: boolean;
  saveState: (message: string, block: string) => SaveState;
  now: () => Date;
}

const UNAVAILABLE: Record<
  Unavailable,
  | "conversation.notice.visual-unavailable-shape"
  | "conversation.notice.visual-unavailable-kind"
  | "conversation.notice.visual-unavailable-markup"
  | "conversation.notice.visual-unavailable-drawing"
> = {
  shape: "conversation.notice.visual-unavailable-shape",
  kind: "conversation.notice.visual-unavailable-kind",
  markup: "conversation.notice.visual-unavailable-markup",
  drawing: "conversation.notice.visual-unavailable-drawing",
};

function observedLabel(at: string): string {
  return t("conversation.label.visual-observed", {
    at: formatDate(new Date(at), "en", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
  });
}

// SDK 그리기에서 난 예외를 이 블록 자리에 가둔다. 다른 블록과 메시지는 그대로 그린다.
class Contained extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Sources(
  { sources, host }: { sources: readonly VisualSource[]; host: VisualHost },
) {
  if (sources.length === 0) return null;
  return (
    <div className={styles.sources} data-visual-sources={sources.length}>
      <span className={styles.caption}>
        {t("conversation.label.visual-sources")}
      </span>
      <ul className={styles.sourceList}>
        {sources.map((item, index) => (
          <li key={index} className={styles.source}>
            {item.kind === "document"
              ? (
                <DocumentLink
                  document={item.document}
                  version={item.version}
                  section={item.section}
                  documentTitle={host.documentTitle}
                  onOpen={host.open}
                />
              )
              : (
                <span
                  className={styles.sourceText}
                  data-visual-source={item.kind}
                >
                  {item.kind === "app_command"
                    ? t("conversation.label.visual-source-app", {
                      command: item.command,
                    })
                    : t("conversation.label.visual-source-estimate", {
                      label: item.label,
                    })}
                </span>
              )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const SAVE_NOTICE = {
  sending: "conversation.notice.visual-save-sending",
  requested: "conversation.notice.visual-save-requested",
  failed: "conversation.notice.visual-save-failed",
  "not-saved": "conversation.notice.visual-not-saved",
} as const;

function Save(
  { message, block, title, host }: {
    message: string;
    block: string;
    title: string;
    host: VisualHost;
  },
) {
  const state = host.saveState(message, block);
  const busy = state.state === "sending" || state.state === "requested";
  return (
    <div className={styles.save} data-visual-save={state.state}>
      {host.save === undefined ? null : (
        <Button
          size="sm"
          icon={conversationIcons.result}
          disabled={busy || host.saveLocked === true}
          data-save-visual={block}
          onClick={() => host.save?.({ message, block, title })}
        >
          {t("conversation.button.save-visual")}
        </Button>
      )}
      {state.state === "idle" || state.state === "saved"
        ? null
        : (
          <span className={styles.caption} role="status">
            {t(SAVE_NOTICE[state.state])}
          </span>
        )}
      {state.state === "saved"
        ? (
          <div className={styles.saved} data-visual-saved={state.links.length}>
            <span className={styles.caption}>
              {t("conversation.label.visual-saved")}
            </span>
            {state.links.map((link) => (
              <DocumentLink
                key={`${link.document}@${link.version ?? ""}`}
                document={link.document}
                version={link.version}
                documentTitle={host.documentTitle}
                onOpen={host.open}
              />
            ))}
          </div>
        )
        : null}
    </div>
  );
}

export interface VisualBlockProps {
  /** 블록이 든 확정 메시지. */
  message: string;
  /** 메시지 본문의 블록 값. 받은 그대로이며 그리기 전에 registry가 검사한다. */
  block: unknown;
  host: VisualHost;
}

/** 답 안의 시각 블록 하나. */
export function VisualBlock({ message, block, host }: VisualBlockProps) {
  const checked = useMemo(() => checkVisual(block), [block]);
  const description = useRef<HTMLParagraphElement>(null);
  // 다시 그리기는 이 블록만 새로 mount한다. 저장된 값은 그대로다.
  const [attempt, setAttempt] = useState(0);
  const readDescription = () => description.current?.focus();
  const retry = () => setAttempt((count) => count + 1);
  const now = host.now();
  const at = observedAt(checked.sources);

  const unavailable = (reason: Unavailable) => (
    <p className={styles.unavailable} data-visual-unavailable={reason}>
      {t(UNAVAILABLE[reason])}
    </p>
  );

  let content: ReactNode;
  if (!checked.ok) content = unavailable(checked.reason);
  else if (checked.content.kind === "table") {
    content = (
      <TableBlock
        content={checked.content}
        onReadDescription={readDescription}
        onRetry={retry}
        now={now}
      />
    );
  } else if (checked.content.kind === "chart") {
    content = (
      <ChartBlock
        content={checked.content}
        onReadDescription={readDescription}
        onRetry={retry}
        now={now}
      />
    );
  } else if (checked.content.kind === "diagram") {
    content = (
      <DiagramBlock
        content={checked.content}
        onReadDescription={readDescription}
        onRetry={retry}
      />
    );
  } else {
    // 앱 카드 갈래는 shell#T44가 앱 frame으로 그린다. 그 전까지 설명·출처와 안내만 둔다.
    content = (
      <p className={styles.unavailable} data-visual-app-card="">
        {t("conversation.notice.visual-app-card")}
      </p>
    );
  }

  return (
    <section
      className={styles.block}
      data-visual={checked.ok ? checked.content.kind : "unavailable"}
      data-visual-key={checked.key ?? undefined}
      aria-label={checked.title ?? t("conversation.label.visual-untitled")}
    >
      <header className={styles.head}>
        <span className={styles.title}>
          {checked.title ?? t("conversation.label.visual-untitled")}
        </span>
        {at === null
          ? null
          : (
            <span className={styles.caption} data-visual-observed={at}>
              {observedLabel(at)}
            </span>
          )}
      </header>
      {checked.description === null ? null : (
        <p
          ref={description}
          className={styles.description}
          data-visual-description=""
          tabIndex={-1}
        >
          {checked.description}
        </p>
      )}
      <div className={styles.content} key={attempt}>
        <Contained fallback={unavailable("drawing")}>{content}</Contained>
      </div>
      <Sources sources={checked.sources} host={host} />
      {checked.ok && checked.key !== null
        ? (
          <Save
            message={message}
            block={checked.key}
            title={checked.title}
            host={host}
          />
        )
        : null}
    </section>
  );
}
