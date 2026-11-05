// session rewind panel. 확인 창이 아니라 대화 화면 안에 열린다. 고른 내 메시지 시점으로 대화를 되돌리고,
// file tool로 바꾼 파일은 기본으로 함께 되돌린다(shell로 바꾼 파일은 되돌리지 않는다). 그 시점 뒤 이 session이
// write한 앱은 앱마다 고른다: write 목록과, 켜면 함께 되돌아갈 다른 변경, 되돌아가지 않는 external 효과,
// 되돌릴 수 없는 write를 고르기 전에 보인다. 고르지 않은 앱의 data는 그대로다.
import { type ReactElement, useEffect, useState } from "react";
import { Button, IconButton } from "@lophn/ui/primitives";
import { Checkbox } from "@lophn/ui/input";
import { t } from "@lophn/i18n";

import { actionIcons, workspaceIcons } from "../../icons/mod.ts";
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
    <div
      className={styles.app}
      data-rewind-app={app.app}
      data-on={checked ? "" : undefined}
    >
      <Checkbox
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
        <>
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
        </>
      ) : null}
    </div>
  );
}

function summaryOf(files: boolean, apps: readonly string[]): string {
  if (apps.length === 0) {
    return t(
      files
        ? "conversation.label.rewind-summary-files"
        : "conversation.label.rewind-summary-messages",
    );
  }
  const joined = apps.join(" and ");
  return t(
    files
      ? "conversation.label.rewind-summary-apps"
      : "conversation.label.rewind-summary-messages-apps",
    { apps: joined },
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
  const chosen =
    ready === null
      ? []
      : ready.apps
          .filter((app) => apps.includes(app.app))
          .map((app) => app.name);

  // 바꾼 파일이 없으면 파일은 되돌릴 것이 없다.
  const filesOn = files && (ready?.files.length ?? 0) > 0;

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
    <section
      className={styles.panel}
      aria-label={t("conversation.title.rewind")}
      data-rewind-panel
    >
      <header className={styles.head}>
        <span className={styles.title}>{t("conversation.title.rewind")}</span>
        <IconButton
          icon={workspaceIcons.close}
          label={t("common.button.close")}
          size="sm"
          disabled={busy}
          onClick={props.onClose}
        />
      </header>
      <div className={styles.cols}>
        <div className={styles.col}>
          <blockquote
            className={styles.quote}
            aria-label={t("conversation.label.rewind-quote")}
          >
            {props.excerpt}
          </blockquote>
          <div className={styles.group}>
            <p className={styles.groupHead}>
              {t("conversation.label.rewind-conversation")}
            </p>
            <p className={styles.text}>
              {t("conversation.notice.rewind-conversation")}
            </p>
            {!withFiles || ready === null ? null : ready.files.length === 0 ? (
              <p className={styles.muted}>
                {t("conversation.notice.rewind-no-files")}
              </p>
            ) : (
              <>
                <Checkbox
                  label={t("conversation.label.rewind-files")}
                  checked={files}
                  onCheckedChange={setFiles}
                />
                <ul className={styles.list} data-rewind-files>
                  {ready.files.map((file) => {
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
              </>
            )}
            {withFiles ? (
              <p className={styles.muted}>
                {t("conversation.notice.rewind-shell-files")}
              </p>
            ) : null}
          </div>
          <p className={styles.muted}>
            {t("conversation.notice.rewind-steer")}
          </p>
        </div>
        {withFiles ? (
          <div className={styles.col}>
            <div className={styles.group}>
              <p className={styles.groupHead}>
                {t("conversation.label.rewind-apps-head")}
              </p>
              {preview.state === "loading" ? (
                <p className={styles.muted} data-rewind-loading>
                  {t("conversation.label.rewind-loading")}
                </p>
              ) : preview.state === "failed" ? (
                <p className={styles.error} role="alert">
                  {t("conversation.rewind.preview-failed")}
                </p>
              ) : ready!.apps.length === 0 ? (
                <p className={styles.muted}>
                  {t("conversation.notice.rewind-no-apps")}
                </p>
              ) : (
                <>
                  <p className={styles.text}>
                    {t("conversation.notice.rewind-apps")}
                  </p>
                  {ready!.apps.map((app) => (
                    <AppChoice
                      key={app.app}
                      app={app}
                      checked={apps.includes(app.app)}
                      onChange={(on) => setApp(app.app, on)}
                    />
                  ))}
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
      <footer className={styles.foot}>
        {error === null ? (
          <span className={styles.summary} data-rewind-summary>
            {ready === null ? "" : summaryOf(filesOn, chosen)}
          </span>
        ) : (
          <span className={`${styles.summary} ${styles.error}`} role="alert">
            {error}
          </span>
        )}
        <Button size="sm" disabled={busy} onClick={props.onClose}>
          {t("common.button.cancel")}
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon={actionIcons.rewind}
          disabled={ready === null || busy}
          onClick={() => void go()}
        >
          {t("conversation.button.rewind-go")}
        </Button>
      </footer>
    </section>
  );
}
