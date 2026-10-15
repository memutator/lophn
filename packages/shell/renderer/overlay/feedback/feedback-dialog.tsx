// report-problem 화면. main이 연 overlay dialog 안에서 사람이
// 글을 쓰고, 보낼 화면 상태와 screenshot을 미리 보고 각각 뺀다. screenshot은 main이 캡처한 같은
// PNG를 가리지 않고 보이며 기본은 꺼짐이다. 이미지가 없으면 이유를 보이고
// 글만 보낼 수 있다. 초안은 이 화면의 메모리에만 있다. 취소는 아무것도 저장하지 않고,
// 이미 접수한 것은 닫아도 지우지 않는다. 접수 뒤 묶인 Issue로 갈 수 있다. 안내에는
// code·ID·stack·원문 오류를 넣지 않고 문제 문구는 problems가 정한 값 그대로 쓴다.
import { useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  type Clipboard,
  CopyButton,
  Dialog,
  Field,
  systemClipboard,
  Textarea,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import {
  FEEDBACK_LIMITS,
  FEEDBACK_PROBLEM_MESSAGE,
  type FeedbackAccepted,
  type FeedbackPreview,
  type FeedbackScreenshotState,
  type LophnOverlayFeedback,
} from "../../../ipc/feedback.ts";
import styles from "./feedback-dialog.module.css";

export interface FeedbackDialogProps {
  draftRef: string;
  api: LophnOverlayFeedback;
  host: HTMLElement;
  clipboard?: Clipboard;
}

type Phase =
  | { state: "draft" }
  | { state: "sending" }
  | { state: "failed"; reason: "unreachable" | "rejected" }
  | { state: "received"; accepted: FeedbackAccepted };

function screenshotNotice(state: FeedbackScreenshotState): string {
  switch (state) {
    case "pending":
      return t("report-problem.notice.capturing");
    case "hidden":
      return t("report-problem.notice.screenshot-hidden");
    case "protected_window":
      return t("report-problem.notice.screenshot-protected");
    case "capture_failed":
      return t("report-problem.notice.screenshot-failed");
  }
}

function failureText(reason: "unreachable" | "rejected"): string {
  return reason === "unreachable"
    ? t("report-problem.error.unreachable")
    : t("report-problem.error.rejected");
}

export function FeedbackDialog(
  { draftRef, api, host, clipboard = systemClipboard }: FeedbackDialogProps,
) {
  const [preview, setPreview] = useState<FeedbackPreview | null>(null);
  const [text, setText] = useState("");
  const [screen, setScreen] = useState(true);
  const [screenshot, setScreenshot] = useState(false);
  const [phase, setPhase] = useState<Phase>({ state: "draft" });

  useEffect(
    () =>
      api.subscribePreview((next) => {
        if (next.draftRef === draftRef) setPreview(next);
      }),
    [api, draftRef],
  );

  const image = preview?.screenshot_png ?? null;
  const shotState = image === null
    ? preview?.screenshot_block ?? "pending"
    : null;
  const length = [...text].length;
  const blank = text.trim().length === 0;
  const tooLong = length > FEEDBACK_LIMITS.text_scalars;
  const received = phase.state === "received";
  const sending = phase.state === "sending";

  async function send(): Promise<void> {
    if (blank || tooLong || sending || received) return;
    setPhase({ state: "sending" });
    try {
      const accepted = await api.submitFeedback(draftRef, text, {
        screen,
        screenshot: screenshot && image !== null,
      });
      setPhase({ state: "received", accepted });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setPhase({
        state: "failed",
        reason: code === "invalid_input" || code === "forbidden"
          ? "rejected"
          : "unreachable",
      });
    }
  }

  // 접수 전 닫기는 취소다. 접수한 것은 닫아도 남는다.
  function close(): void {
    if (sending) return;
    void api.cancelFeedback(draftRef).catch(() => {});
  }

  const actions = received
    ? [
      <Button
        key="close"
        variant="secondary"
        data-feedback="close"
        onClick={close}
      >
        {t("common.button.close")}
      </Button>,
      phase.accepted.problem !== null
        ? (
          <Button
            key="issue"
            variant="primary"
            data-feedback="view-issue"
            onClick={() => void api.openFeedbackIssue(draftRef).catch(() => {})}
          >
            {t("report-problem.button.view-issue")}
          </Button>
        )
        : null,
    ]
    : [
      <Button
        key="cancel"
        variant="secondary"
        data-feedback="cancel"
        disabled={sending}
        onClick={close}
      >
        {t("common.button.cancel")}
      </Button>,
      <Button
        key="send"
        variant="primary"
        data-feedback="send"
        disabled={blank || tooLong || sending}
        onClick={() => void send()}
      >
        {t("report-problem.button.send")}
      </Button>,
    ];

  return (
    <Dialog
      container={host}
      returnFocus={false}
      open
      width="wide"
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={t("report-problem.title.report")}
      actions={actions}
    >
      <div className={styles.body} data-feedback-phase={phase.state}>
        {received
          ? (
            <section className={styles.result} data-feedback="received">
              <p className={styles.status} role="status">
                {t("report-problem.status.received")}
              </p>
              {phase.accepted.problem !== null
                ? <p className={styles.issue}>{FEEDBACK_PROBLEM_MESSAGE}</p>
                : null}
            </section>
          )
          : (
            <>
              <Field
                label={t("report-problem.label.what-happened")}
                help={tooLong
                  ? undefined
                  : t("report-problem.hint.draft-memory")}
                error={tooLong ? t("report-problem.error.too-long") : undefined}
              >
                <Textarea
                  rows={4}
                  value={text}
                  readOnly={sending}
                  data-feedback="text"
                  onChange={(event) => setText(event.currentTarget.value)}
                />
              </Field>
              <p className={styles.note} data-feedback="existing-issue">
                {preview?.existing_issue === true
                  ? t("report-problem.notice.existing-issue")
                  : t("report-problem.notice.new-issue")}
              </p>
              <section className={styles.attachments}>
                <h3 className={styles.heading}>
                  {t("report-problem.heading.sent-with")}
                </h3>
                <div className={styles.item} data-feedback="screen">
                  <Checkbox
                    size="sm"
                    label={t("report-problem.label.screen-details")}
                    checked={screen}
                    disabled={sending}
                    onCheckedChange={setScreen}
                  />
                  {preview?.screen_summary
                    ? (
                      <p className={styles.summary}>
                        <span>{preview.screen_summary.name}</span>
                        {preview.screen_summary.path !== null
                          ? (
                            <code className={styles.path}>
                              {preview.screen_summary.path}
                            </code>
                          )
                          : null}
                      </p>
                    )
                    : null}
                  {screen ? null : (
                    <p className={styles.note}>
                      {t("report-problem.notice.screen-not-sent")}
                    </p>
                  )}
                </div>
                <div className={styles.item} data-feedback="screenshot">
                  <Checkbox
                    size="sm"
                    label={t("report-problem.label.screenshot")}
                    checked={screenshot && image !== null}
                    disabled={image === null || sending}
                    onCheckedChange={setScreenshot}
                  />
                  {image !== null
                    ? (
                      <img
                        className={styles.shot}
                        src={image}
                        alt={t("report-problem.label.screenshot")}
                        data-feedback="screenshot-preview"
                      />
                    )
                    : null}
                  {shotState !== null
                    ? (
                      <p
                        className={styles.note}
                        data-feedback="screenshot-reason"
                        data-reason={shotState}
                      >
                        {screenshotNotice(shotState)}
                      </p>
                    )
                    : screenshot
                    ? null
                    : (
                      <p className={styles.note}>
                        {t("report-problem.notice.screenshot-not-selected")}
                      </p>
                    )}
                </div>
              </section>
              {sending
                ? (
                  <p className={styles.status} role="status">
                    {t("report-problem.status.sending")}
                  </p>
                )
                : null}
              {phase.state === "failed"
                ? (
                  <div
                    className={styles.failure}
                    role="alert"
                    data-feedback="failed"
                  >
                    <p>{failureText(phase.reason)}</p>
                    <p className={styles.copy}>
                      <span>{t("report-problem.notice.copy-text")}</span>
                      <CopyButton
                        text={text}
                        label={t("report-problem.button.copy-text")}
                        clipboard={clipboard}
                      />
                    </p>
                  </div>
                )
                : null}
            </>
          )}
      </div>
    </Dialog>
  );
}
