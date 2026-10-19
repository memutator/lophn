// [Instructions] 진입. 지침 파일은 일반 경로 파일이라 같은 파일 편집기로 연다. 전역·project 자리의
// 경로는 shell main(`InstructionsApi`)이 알려 주고, 없는 파일은 빈 buffer로 열려 첫 저장이 만든다.
import { useEffect, useRef, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { ErrorState, Skeleton } from "@lophn/ui/feedback";
import { t } from "@lophn/wording";

import type {
  InstructionsApi,
  InstructionsPlace,
} from "../../ipc/instructions.ts";
import { DocumentView, type EditorDeps } from "./document-view.tsx";
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

function placeKey(place: InstructionsPlace): string {
  return place.layer === "global" ? "global" : `${place.layer}:${place.place}`;
}

type View =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "file"; readonly path: string };

interface InstructionsEntryProps {
  place: InstructionsPlace;
  source: InstructionsSource;
  editor: EditorDeps;
  /** 화면을 떠난다. 없으면 돌아가기 단추를 두지 않는다. */
  onBack?: () => void;
  now?: () => number;
}

export function InstructionsEntry(
  { place, source, editor, onBack, now }: InstructionsEntryProps,
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
      (reply) => {
        if (!live) return;
        // main이 지침 파일의 절대 경로를 `path`로 알려 준다.
        const path = reply.ok
          ? (reply.value as { path?: unknown }).path
          : undefined;
        setView(
          typeof path === "string"
            ? { kind: "file", path }
            : { kind: "failed" },
        );
      },
    );
    return () => {
      live = false;
    };
  }, [key, attempt]);

  let body;
  if (view.kind === "file") {
    const path = view.path;
    body = (
      <DocumentView
        key={path}
        path={path}
        sessions={editor.sessions}
        readingWidth={editor.readingWidth}
        now={now}
        onDelete={async () => {
          const reply = await editor.sessions.files.delete({ path });
          if (reply.ok) onBack?.();
          return reply.ok;
        }}
      />
    );
  } else if (view.kind === "loading") {
    body = <Skeleton shape="line" lines={6} />;
  } else {
    body = (
      <ErrorState
        target={t("document.label.these-instructions")}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  }
  return (
    <div
      className={styles.entry}
      data-space="instructions"
      data-instructions={place.layer}
    >
      {onBack
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
        : null}
      <div className={styles.fill} data-instructions-view={view.kind}>
        {body}
      </div>
    </div>
  );
}
