// [Instructions] 진입(shell/editor#R17, flow edit-instructions). 전역(settings)·project(project-workspace)·
// app(app-detail) 화면이 이 진입을 놓고, 누르면 지침 파일을 일반 문서와 같은 lophn 편집기로 연다.
// main이 exact 지침 파일만 resolve하고 renderer는 문서 id만 받는다(경로·안쪽 version ID는 기본
// 화면에 없다). 파일이 없으면 빈 초안이고 사람의 첫 저장이 파일을 만든다. 그 초안은 창의 편집
// session 묶음이 붙들고(창 닫기 guard가 센다), 첫 저장 뒤에는 같은 DocumentView·정보 패널·비교·
// 복원으로 바뀐다. agent의 제안은 이 통로에 없다(사람의 저장만 이 편집기를 지난다).
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  Button,
  editorIcons,
  ErrorState,
  IconButton,
  Kbd,
  ReadingFrame,
  Skeleton,
  Tooltip,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { EditorReply } from "../../ipc/editor.ts";
import type {
  InstructionsApi,
  InstructionsCreated,
  InstructionsOpened,
  InstructionsPlace,
} from "../../ipc/instructions.ts";
import {
  InfoPanel,
  type InfoTab,
} from "../workspace/info-panel-slot/info-panel.tsx";
import {
  type CompareTarget,
  DocumentView,
  type EditorDeps,
} from "./document-view.tsx";
import { editShortcut } from "./document-head.tsx";
import { DocumentInfoPanel } from "./info-panel/info-panel.tsx";
import {
  type DraftDocumentFacts,
  DraftDocumentSession,
} from "./draft-document.ts";
import { MarkdownEditor } from "./markdown-editor.tsx";
import type { EditorSessions } from "./sessions.ts";
import styles from "./instructions-entry.module.css";

/** main의 [Instructions] 통로(`lophnInstructions`). */
export type InstructionsSource = InstructionsApi;

export function windowInstructionsSource(): InstructionsSource | undefined {
  const bridge = (globalThis as { lophnInstructions?: InstructionsApi })
    .lophnInstructions;
  return bridge && typeof bridge.open === "function" ? bridge : undefined;
}

/** 화면이 놓는 [Instructions] 버튼. 누르면 호출자가 이 진입을 연다. */
export function InstructionsButton(
  { onOpen }: { onOpen: () => void },
) {
  return (
    <Button
      variant="secondary"
      size="sm"
      data-open-instructions=""
      onClick={onOpen}
    >
      {t("document.button.instructions")}
    </Button>
  );
}

function titleOf(place: InstructionsPlace): string {
  return place.layer === "project"
    ? t("document.title.project-instructions")
    : t("document.title.global-instructions");
}

function placeKey(place: InstructionsPlace): string {
  return place.layer === "global" ? "global" : `${place.layer}:${place.place}`;
}

type View =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "draft" }
  | { readonly kind: "document"; readonly document: string };

export interface InstructionsEntryProps {
  place: InstructionsPlace;
  source: InstructionsSource;
  editor: EditorDeps;
  /** 화면을 떠난다. 없으면 돌아가기 단추를 두지 않는다. */
  onBack?: () => void;
  now?: () => number;
}

export function InstructionsEntry(
  { place, source, editor, onBack, now = Date.now }: InstructionsEntryProps,
) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = placeKey(place);
  const latest = useRef({ place, source });
  latest.current = { place, source };

  useEffect(() => {
    let live = true;
    setView({ kind: "loading" });
    void latest.current.source.open({ target: latest.current.place }).then(
      (reply: EditorReply<InstructionsOpened>) => {
        if (!live) return;
        if (!reply.ok) setView({ kind: "failed" });
        else if (reply.value.document === null) setView({ kind: "draft" });
        else setView({ kind: "document", document: reply.value.document });
      },
    );
    return () => {
      live = false;
    };
  }, [key, attempt]);

  const back = onBack
    ? (
      <div className={styles.bar}>
        <Button
          variant="ghost"
          size="sm"
          data-instructions-back=""
          onClick={onBack}
        >
          {t("common.button.back")}
        </Button>
      </div>
    )
    : null;

  let body;
  if (view.kind === "document") {
    body = (
      <InstructionsDocument
        key={view.document}
        document={view.document}
        project={place.layer === "project" ? place.place : ""}
        editor={editor}
        now={now}
      />
    );
  } else if (view.kind === "loading") {
    body = (
      <div className={styles.fill} data-instructions-view="loading">
        <ReadingFrame
          width="default"
          header={<Skeleton shape="line" lines={2} />}
        >
          <Skeleton shape="line" lines={6} />
        </ReadingFrame>
      </div>
    );
  } else if (view.kind === "draft" && editor.files) {
    body = (
      <InstructionsDraft
        key={key}
        place={place}
        source={source}
        sessions={editor.files}
        onSaved={() => setAttempt((value) => value + 1)}
      />
    );
  } else {
    // 열지 못했거나 파일 통로가 없어 초안을 붙들 곳이 없다. 같게 다시 시도를 둔다.
    body = (
      <div className={styles.fill} data-instructions-view="failed">
        <ReadingFrame width="default">
          <ErrorState
            target={t("document.label.these-instructions")}
            onRetry={() => setAttempt((value) => value + 1)}
          />
        </ReadingFrame>
      </div>
    );
  }
  return (
    <div
      className={styles.entry}
      data-space="instructions"
      data-instructions={place.layer}
    >
      {back}
      {body}
    </div>
  );
}

// 파일에 연결된 문서가 있다. 일반 문서와 같은 편집·충돌·정보 패널·비교·복원이다.
function InstructionsDocument(
  { document, project, editor, now }: {
    document: string;
    project: string;
    editor: EditorDeps;
    now: () => number;
  },
) {
  const [info, setInfo] = useState<{ open: boolean; tab: InfoTab }>({
    open: false,
    tab: "versions",
  });
  const [compare, setCompare] = useState<CompareTarget | null>(null);
  const [tick, setTick] = useState(0);
  const [viewing, setViewing] = useState<string | null>(null);
  return (
    <div className={styles.document} data-instructions-view="document">
      <div className={styles.fill}>
        <DocumentView
          documentId={document}
          projectId={project}
          source={editor.source}
          readingWidth={editor.readingWidth}
          menu={editor.menu}
          files={editor.files}
          versions={editor.versions}
          infoOpen={info.open}
          onToggleInfo={() => setInfo({ ...info, open: !info.open })}
          compare={compare}
          onCompare={setCompare}
          onVersionsChanged={() => setTick((value) => value + 1)}
          onMeta={(meta) => setViewing(meta.version ?? null)}
          now={now}
        />
      </div>
      <InfoPanel
        placement={info.open ? "docked" : "hidden"}
        tab={info.tab}
        onTab={(tab) => setInfo({ ...info, tab })}
        onClose={() => setInfo({ ...info, open: false })}
      >
        {editor.versions
          ? (
            <DocumentInfoPanel
              tab={info.tab}
              document={document}
              source={editor.versions}
              viewing={viewing}
              refresh={tick}
              onCompare={(_document, before, after) =>
                setCompare({ before, after })}
              now={now}
            />
          )
          : undefined}
      </InfoPanel>
    </div>
  );
}

function statusText(facts: DraftDocumentFacts): string {
  switch (facts.state) {
    case "draft":
      return t("documents.status.draft");
    case "saving":
      return t("document.label.saving");
    case "saved":
      return t("document.status.version-saved");
    case "pending":
      return t("document.status.version-pending");
    case "conflict":
      return t("document.status.conflict");
    case "failed":
      return t("document.status.failed");
    case "offline":
      return t("document.status.offline");
    case "unknown":
      return t("document.status.unknown");
  }
}

// 파일이 아직 없다. 빈 초안을 고치고 편집 종료(읽기 전환·CommandOrControl+S·화면 떠남·창 닫기)가
// 사람의 첫 저장으로 파일을 만든다. 초안 보존(draft)과 파일 쓰기·판 확정(pending·saved)은 다른
// 상태로 보인다(shell/editor#R2). 저장 버튼은 없다(R12).
function InstructionsDraft(
  { place, source, sessions, onSaved }: {
    place: InstructionsPlace;
    source: InstructionsSource;
    sessions: EditorSessions;
    onSaved: () => void;
  },
) {
  const key = `instructions:${placeKey(place)}`;
  const title = titleOf(place);
  const [session] = useState(() =>
    sessions.holdDraft(
      key,
      title,
      () =>
        new DraftDocumentSession({
          text: "",
          port: {
            async create(input) {
              const reply: EditorReply<InstructionsCreated> = await source
                .create({
                  target: place,
                  request_key: input.request_key,
                  bytes: input.bytes,
                });
              return reply;
            },
            async lookup() {
              const opened = await source.open({ target: place });
              return opened.ok ? opened.value.version : undefined;
            },
          },
        }),
    )
  );
  const [facts, setFacts] = useState(session.facts);
  const reported = useRef(false);
  const latest = useRef(onSaved);
  latest.current = onSaved;

  useEffect(() => {
    setFacts(session.facts);
    const stop = session.subscribe(setFacts);
    return () => {
      stop();
      // 화면을 떠나는 것도 편집 종료다. 고친 글이 있으면 첫 저장을 한다(R1).
      sessions.releaseDraft(key);
    };
  }, [session, sessions, key]);

  useEffect(() => {
    if (facts.state === "saved" && !reported.current) {
      reported.current = true;
      latest.current();
    }
  }, [facts]);

  const finish = () => void session.flush(true);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod || event.altKey || event.shiftKey) return;
    const pressed = event.key.toLowerCase();
    if (pressed !== "s" && pressed !== "e") return;
    event.preventDefault();
    event.stopPropagation();
    finish();
  };
  const action = facts.state === "failed" || facts.state === "offline"
    ? { label: t("common.button.retry"), run: () => session.retry() }
    : facts.state === "unknown" || facts.state === "pending"
    ? {
      label: t("document.button.check-again"),
      run: () => void session.check(),
    }
    : null;
  const readLabel = t("document.button.read");

  const header = (
    <div className={styles.head} data-instructions-head="">
      <div className={styles.titleRow}>
        <h1 className={styles.title} data-document-title="">{title}</h1>
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
      </div>
      <p className={styles.meta} data-document-meta="">
        <span data-instructions-draft={facts.state} role="status">
          {statusText(facts)}
        </span>
        {action
          ? (
            <Button
              variant="ghost"
              size="sm"
              data-instructions-action=""
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
      className={styles.fill}
      data-instructions-view="draft"
      onKeyDownCapture={onKeyDown}
    >
      <ReadingFrame width="default" header={header}>
        <MarkdownEditor
          initialText={session.text}
          label={title}
          onChange={(text) => session.edit(text)}
        />
      </ReadingFrame>
    </div>
  );
}
