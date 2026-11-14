// session rewind dialog. 대화 위 작은 modal이라 뒤의 대화가 보인다. 고른 내 메시지 시점으로 대화를 되돌리고,
// file tool로 바꾼 파일은 기본으로 함께 되돌린다(shell로 바꾼 파일은 되돌리지 않는다). 그 시점 뒤 이 session이
// write한 앱은 앱마다 고른다: write 목록과, 켜면 함께 되돌아갈 다른 변경, 되돌아가지 않는 external 효과,
// 되돌릴 수 없는 write를 고르기 전에 보인다. 고르지 않은 앱의 data는 그대로다.
// 파일 목록은 접어 두고 요약 한 줄만 보인다: 고르는 데 필요한 것은 몇 개가 함께 가는지이고, 경로는 확인할 때만 본다.
import { type ReactElement, useEffect, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Checkbox } from "@lophn/ui/input";
import { Dialog } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import { actionIcons } from "../../icons/mod.ts";
import type {
  AgentTabSource,
  RewindApp,
  RewindChoice,
  RewindPreviewView,
  SourceResult,
} from "../agent-tab-source.ts";
import { reasonText } from "./text.ts";
import styles from "./rewind-panel.module.css";

interface RewindPanelProps {
  source: Pick<AgentTabSource, "rewindPreview">;
  /** 되돌린다. `act`로 보낸 결과다. */
  rewind: (choice: RewindChoice) => Promise<SourceResult<unknown>>;
  /** 파일·앱 복원을 받는 source(`capabilities.rewind_files`)다. 아니면 대화만 되돌려 목록을 읽지 않는다. */
  withFiles: boolean;
  session: string;
  /** 시점으로 고른 내 메시지. */
  message: string;
  /** 그 메시지를 알아볼 글(인용). */
  excerpt: string;
  onClose: () => void;
  /** rewind가 끝났다. 부르는 쪽이 대화를 다시 읽고 입력칸에 원문을 채운다. */
  onRewound?: () => void;
}

type Preview =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly value: RewindPreviewView };

const clock = new Intl.DateTimeFormat("en", {
  hour: "numeric",
  minute: "2-digit",
});

function timeOf(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : clock.format(date);
}

function AppChoice({
  app,
  checked,
  onChange,
}: {
  app: RewindApp;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): ReactElement {
  const unknown = app.writes.filter((write) => write.unknown).length;
  return (
    <div className={styles.choice} data-rewind-app={app.app}>
      <Checkbox
        size="sm"
        label={t("conversation.label.rewind-app-also", { app: app.name })}
        checked={checked}
        onCheckedChange={onChange}
      />
      <p className={styles.sub}>
        {t("conversation.label.rewind-app-writes", {
          count: app.writes.length,
        })}
        {unknown === 0 ? null : (
          <span className={styles.warn}>
            {t("conversation.label.rewind-app-unknown", { count: unknown })}
          </span>
        )}
      </p>
      {checked ? (
        <div className={styles.detail}>
          <ul className={styles.list}>
            {app.writes.map((write, index) => (
              <li key={index}>
                <span className={styles.when}>{timeOf(write.at)}</span>
                {write.text}
                {write.unknown ? (
                  <span className={styles.warn}>
                    {t("conversation.label.rewind-write-unknown")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {app.others.length === 0 ? null : (
            <>
              <p className={styles.sub}>
                {t("conversation.label.rewind-others")}
              </p>
              <ul className={styles.list}>
                {app.others.map((other, index) => (
                  <li key={index}>
                    <span className={styles.who}>{other.by}</span>
                    {other.text}
                  </li>
                ))}
              </ul>
            </>
          )}
          {app.outside.length === 0 ? null : (
            <>
              <p className={styles.sub}>
                {t("conversation.label.rewind-outside")}
              </p>
              <ul className={styles.list}>
                {app.outside.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function FilesChoice({
  files,
  checked,
  onChange,
}: {
  files: RewindPreviewView["files"];
  checked: boolean;
  onChange: (checked: boolean) => void;
}): ReactElement {
  const [shown, setShown] = useState(false);
  return (
    <div className={styles.choice}>
      <div className={styles.row}>
        <Checkbox
          size="sm"
          label={t("conversation.label.rewind-files", { count: files.length })}
          checked={checked}
          onCheckedChange={onChange}
        />
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={shown}
          onClick={() => setShown(!shown)}
        >
          {t(
            shown
              ? "conversation.button.rewind-hide-files"
              : "conversation.button.rewind-show-files",
          )}
        </button>
      </div>
      {shown ? (
        <ul className={`${styles.list} ${styles.detail}`} data-rewind-files>
          {files.map((file) => {
            const why = reasonText(file.skipped);
            return (
              <li key={file.path}>
                <span className={styles.mono}>{file.path}</span>
                {why === null ? null : (
                  <span className={styles.warn}>{why}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function RewindPanel(props: RewindPanelProps): ReactElement {
  const { source, session, message, withFiles } = props;
  const [preview, setPreview] = useState<Preview>(
    withFiles
      ? { state: "loading" }
      : { state: "ready", value: { files: [], apps: [] } },
  );
  // file tool로 바꾼 파일은 기본으로 함께 되돌린다. 앱은 고르기 전까지 그대로다.
  const [files, setFiles] = useState(true);
  const [apps, setApps] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!withFiles) return;
    let current = true;
    setPreview({ state: "loading" });
    void source.rewindPreview(session, message).then((result) => {
      if (!current) return;
      setPreview(
        result.ok
          ? { state: "ready", value: result.value }
          : { state: "failed" },
      );
    });
    return () => {
      current = false;
    };
  }, [source, session, message, withFiles]);

  const ready = preview.state === "ready" ? preview.value : null;

  const setApp = (app: string, on: boolean) =>
    setApps((now) => (on ? [...now, app] : now.filter((item) => item !== app)));

  const go = async () => {
    if (busy || ready === null) return;
    setBusy(true);
    setError(null);
    const result = await props.rewind({ files: withFiles && files, apps });
    if (result.ok) {
      props.onRewound?.();
      props.onClose();
      return;
    }
    setBusy(false);
    setError(
      t(
        result.code === "conflict"
          ? "conversation.rewind.running"
          : "conversation.rewind.start-failed",
      ),
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose();
      }}
      title={t("conversation.title.rewind")}
      actions={
        <>
          <Button disabled={busy} onClick={props.onClose}>
            {t("common.button.cancel")}
          </Button>
          <Button
            variant="danger"
            icon={actionIcons.rewind}
            disabled={ready === null || busy}
            onClick={() => void go()}
          >
            {t("conversation.button.rewind-go")}
          </Button>
        </>
      }
    >
      <div className={styles.body} data-rewind-panel data-key-context="modal">
        <blockquote
          className={styles.quote}
          aria-label={t("conversation.label.rewind-quote")}
        >
          {props.excerpt}
        </blockquote>
        <p className={styles.text}>
          {t("conversation.notice.rewind-conversation")}
        </p>
        {preview.state === "loading" ? (
          <p className={styles.muted} data-rewind-loading>
            {t("conversation.label.rewind-loading")}
          </p>
        ) : preview.state === "failed" ? (
          <p className={styles.error} role="alert">
            {t("conversation.rewind.preview-failed")}
          </p>
        ) : ready!.files.length === 0 && ready!.apps.length === 0 ? null : (
          <div className={styles.choices}>
            {ready!.files.length === 0 ? null : (
              <FilesChoice
                files={ready!.files}
                checked={files}
                onChange={setFiles}
              />
            )}
            {ready!.apps.map((app) => (
              <AppChoice
                key={app.app}
                app={app}
                checked={apps.includes(app.app)}
                onChange={(on) => setApp(app.app, on)}
              />
            ))}
            {ready!.apps.length === 0 ? null : (
              <p className={styles.muted}>
                {t("conversation.notice.rewind-apps")}
              </p>
            )}
          </div>
        )}
        <p className={styles.muted}>
          {withFiles
            ? `${t("conversation.notice.rewind-shell-files")} ${t("conversation.notice.rewind-steer")}`
            : t("conversation.notice.rewind-steer")}
        </p>
        {error === null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
