// series 새 멤버 쓰기(flow write-series 2·5). 가족 draft(key·예정 문서)가 선 뒤 같은 lophn 편집기로
// 내용을 쓴다. 판이 없어 입력 멈춤에 쓸 곳이 없으므로 글은 창의 편집 session 묶음이 붙들고, 편집
// 종료(읽기 전환·CommandOrControl+S·화면 떠남·창 닫기)가 첫 판을 만든다. 그 저장이 같은
// transaction에서 멤버 가입과 draft 비움을 한다(documents). 메타 줄은 draft 보존과 판 확정을 다른
// 상태로 보이고(shell/editor#R2), 저장 버튼은 없다(R12). 첫 판 뒤의 고침은 그 문서의 working copy로
// 파일 통로를 탄다.
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  Button,
  editorIcons,
  IconButton,
  Kbd,
  ReadingFrame,
  Tooltip,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { editShortcut } from "../../../editor/document-head.tsx";
import { MarkdownEditor } from "../../../editor/markdown-editor.tsx";
import {
  type DraftDocumentFacts,
  DraftDocumentSession,
} from "../../../editor/draft-document.ts";
import type { EditorSessions } from "../../../editor/sessions.ts";
import { documentNameForKey } from "../model.ts";
import type { LophnSource, Series } from "../source.ts";
import readerStyles from "../documents/reader.module.css";
import styles from "./series.module.css";

export interface MemberWriterProps {
  source: LophnSource;
  sessions: EditorSessions;
  /** draft가 선 가족. */
  series: Series;
  /** 첫 판이 생겼다. 그 멤버를 읽는다. */
  onSaved: (document: string, version: string) => void;
  /** 판 없이 가족으로 돌아간다(draft를 버렸거나 고친 글이 없다). */
  onBack: () => void;
}

function statusText(facts: DraftDocumentFacts): string {
  switch (facts.state) {
    case "draft":
      return t("documents.status.draft");
    case "saving":
      return t("document.label.saving");
    case "saved":
      return t("document.status.version-saved");
    case "conflict":
      return t("documents.status.draft-conflict");
    case "failed":
      return t("documents.status.draft-failed");
    case "offline":
      return t("document.status.offline");
    case "unknown":
      return t("document.status.unknown");
  }
}

export function MemberWriter(
  { source, sessions, series, onSaved, onBack }: MemberWriterProps,
) {
  const draft = series.draft!;
  const [session] = useState(() =>
    sessions.holdDraft(
      draft.document,
      draft.key,
      () =>
        new DraftDocumentSession({
          text: `# ${draft.key}\n\n`,
          port: {
            async create(input) {
              // 가족 draft가 아직 이 예정 문서를 가리킬 때만 저장한다. 바뀌었으면 가입 없는 문서가
              // 생기므로 저장하지 않는다.
              const current = await source.series(series.id);
              if (!current.ok) {
                return {
                  ok: true,
                  value: {
                    outcome: "failed",
                    version: null,
                    failure: current.code,
                  },
                };
              }
              const now = current.value.series.draft;
              const name = documentNameForKey(draft.key);
              if (
                now?.document !== draft.document || now.key !== draft.key ||
                name === null
              ) {
                return {
                  ok: true,
                  value: { outcome: "conflict", version: null, failure: null },
                };
              }
              return await sessions.createDocument({
                document: draft.document,
                request_key: input.request_key,
                title: draft.key,
                place: series.place,
                name,
                bytes: input.bytes,
              });
            },
            async lookup() {
              const found = await source.latestVersion(draft.document);
              return found.ok ? found.value : undefined;
            },
          },
        }),
    )
  );
  const [facts, setFacts] = useState(session.facts);
  const latest = useRef({ onSaved, onBack });
  latest.current = { onSaved, onBack };
  const reported = useRef(false);

  useEffect(() => {
    setFacts(session.facts);
    const stop = session.subscribe(setFacts);
    return () => {
      stop();
      // 화면을 떠나는 것도 편집 종료다. 고친 글이 있으면 첫 판을 만든다(R1).
      sessions.releaseDraft(draft.document);
    };
  }, [session, sessions, draft.document]);

  useEffect(() => {
    if (
      facts.state === "saved" && facts.version !== null && !reported.current
    ) {
      reported.current = true;
      latest.current.onSaved(draft.document, facts.version);
    }
  }, [facts, draft.document]);

  // 읽기 전환과 CommandOrControl+S는 편집 종료다. 고친 글이 없으면 판 없이 가족으로 돌아간다.
  const finish = () => {
    void session.flush(true).then(() => {
      if (!session.facts.edited && session.facts.state === "draft") {
        latest.current.onBack();
      }
    });
  };

  const discard = async () => {
    session.discard();
    const current = await source.series(series.id);
    if (current.ok && current.value.series.draft?.document === draft.document) {
      await source.clearDraft(current.value.series);
    }
    latest.current.onBack();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key !== "s" && key !== "e") return;
    event.preventDefault();
    event.stopPropagation();
    finish();
  };

  const action = facts.state === "failed" || facts.state === "offline"
    ? { label: t("common.button.retry"), run: () => session.retry() }
    : facts.state === "unknown"
    ? {
      label: t("document.button.check-again"),
      run: () => void session.check(),
    }
    : null;
  const readLabel = t("document.button.read");
  const discardLabel = t("documents.button.discard-draft");

  const header = (
    <div className={readerStyles.head} data-writer-head="">
      <div className={styles.titleRow}>
        <h1 className={readerStyles.title} data-document-title="">
          {draft.key}
        </h1>
        <div className={styles.actions}>
          <Tooltip
            content={
              <span>
                {readLabel} <Kbd keys={editShortcut()} />
              </span>
            }
          >
            <IconButton
              icon={editorIcons.read}
              label={readLabel}
              variant="ghost"
              aria-keyshortcuts="Control+E Meta+E"
              disabled={facts.state === "saving"}
              data-edit-toggle=""
              onClick={finish}
            />
          </Tooltip>
          <Tooltip content={discardLabel}>
            <IconButton
              icon={editorIcons.close}
              label={discardLabel}
              variant="ghost"
              disabled={facts.state === "saving"}
              data-discard-draft=""
              onClick={() => void discard()}
            />
          </Tooltip>
        </div>
      </div>
      <p className={readerStyles.meta} data-document-meta="">
        <span data-draft-document={facts.state} role="status">
          {statusText(facts)}
        </span>
        {action
          ? (
            <Button
              variant="ghost"
              size="sm"
              data-draft-document-action=""
              onClick={action.run}
            >
              {action.label}
            </Button>
          )
          : null}
      </p>
    </div>
  );

  return (
    <div
      className={readerStyles.reader}
      data-member-writer={draft.key}
      onKeyDownCapture={onKeyDown}
    >
      <ReadingFrame width="default" header={header}>
        <MarkdownEditor
          initialText={session.text}
          label={draft.key}
          onChange={(text) => session.edit(text)}
        />
      </ReadingFrame>
    </div>
  );
}
