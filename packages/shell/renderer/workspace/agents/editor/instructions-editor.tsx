// 지침 파일(LOPHN.md, DOMAIN.md) 하나를 그 자리에서 보고 고친다. 평소에는 상자에 글을 보이고 [Edit]을 누르면 같은 자리가
// 파일 탭과 같은 markdown 편집기(live preview)가 된다. 저장은 이 파일만 통째로 쓴다. 다른 곳에서 파일이 바뀌었으면(conflict)
// 디스크를 덮지 않고 고친 글을 둔 채 [Reload]를 보인다.
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";
import { type ReactElement, useState } from "react";
import { MarkdownEditor } from "../../../editor/markdown-editor.tsx";
import type { ReadResult } from "../source.ts";
import type { InstructionsFile } from "../views.ts";
import styles from "./agent-editor.module.css";
import { actionIcons } from "../../../icons/mod.ts";

/** 지침 파일 하나를 다시 읽고 쓰는 길. */
export interface InstructionsPort {
  read(): Promise<ReadResult<InstructionsFile>>;
  /** hash가 디스크와 다르면 message가 conflict이고 파일은 그대로다. */
  write(
    text: string,
    hash: string | null,
  ): Promise<ReadResult<InstructionsFile>>;
}

interface InstructionsEditorProps {
  /** 상자 머리 글. 이 파일이 무엇인지 말하고, 고칠 때는 편집기의 이름이다. */
  readonly head: string;
  /** 화면이 처음 읽은 파일. 이 뒤로는 이 상자가 쥔다. */
  readonly file: InstructionsFile;
  /** 보기에서 보일 앞 줄 수. 없으면 전부다. */
  readonly lines?: number;
  /** 파일이 비었을 때의 한 줄. */
  readonly empty: string;
  readonly port: InstructionsPort;
  /** 있으면 보기 없이 편집으로 열리고, [Cancel]·저장·[Reload] 뒤에 이것을 부른다(줄 menu에서 연 DOMAIN.md). */
  readonly onClose?: () => void;
}

export function InstructionsEditor(
  props: InstructionsEditorProps,
): ReactElement {
  const [file, setFile] = useState(props.file);
  // 고치는 중의 글. null이면 보기다.
  const [draft, setDraft] = useState<string | null>(
    props.onClose === undefined ? null : props.file.text,
  );
  const [failure, setFailure] = useState<"conflict" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setDraft(null);
    setFailure(null);
    props.onClose?.();
  };

  if (draft === null) {
    return (
      <div className={styles.instr} data-instructions-editor="view">
        <div className={styles.instrHead}>
          <span>{props.head}</span>
          <Button
            size="sm"
            icon={actionIcons.edit}
            data-action="edit-instructions"
            onClick={() => setDraft(file.text)}
          >
            {t("project-workspace.button.edit-instructions")}
          </Button>
        </div>
        {file.text.trim() === "" ? (
          <p className={styles.instrEmpty} data-instructions-empty="">
            {props.empty}
          </p>
        ) : (
          <pre className={styles.instrBody} data-instructions-preview="">
            {props.lines === undefined
              ? file.text
              : file.text.split("\n").slice(0, props.lines).join("\n")}
          </pre>
        )}
      </div>
    );
  }

  const save = async () => {
    setBusy(true);
    setFailure(null);
    const written = await props.port.write(draft, file.hash);
    setBusy(false);
    if (written.ok) {
      setFile(written.value);
      close();
    } else setFailure(written.message === "conflict" ? "conflict" : "failed");
  };

  // 디스크의 지금 글로 바꾼다. 고친 글은 버린다.
  const reload = async () => {
    setBusy(true);
    const read = await props.port.read();
    setBusy(false);
    if (!read.ok) {
      setFailure("failed");
      return;
    }
    setFile(read.value);
    close();
  };

  return (
    <div className={styles.instrEdit} data-instructions-editor="editing">
      <span className={styles.instrLabel}>{props.head}</span>
      <div
        className={styles.instrBox}
        data-invalid={failure !== null || undefined}
      >
        <MarkdownEditor
          initialText={draft}
          label={props.head}
          onChange={setDraft}
        />
      </div>
      {failure === null ? null : (
        <p className={styles.issue} role="alert" data-instructions-failure="">
          {failure === "conflict"
            ? t("agents.error.instructions-conflict")
            : t("agents.error.instructions-save-failed")}
        </p>
      )}
      <div className={styles.formActions}>
        {failure === "conflict" ? (
          <Button
            icon={actionIcons.refresh}
            data-action="reload-instructions"
            disabled={busy}
            onClick={() => void reload()}
          >
            {t("common.button.reload")}
          </Button>
        ) : null}
        <Button disabled={busy} onClick={close}>
          {t("common.button.cancel")}
        </Button>
        <Button
          variant="primary"
          icon={actionIcons.save}
          data-action="save-instructions"
          disabled={busy || draft === file.text}
          onClick={() => void save()}
        >
          {t("settings.button.save")}
        </Button>
      </div>
    </div>
  );
}
