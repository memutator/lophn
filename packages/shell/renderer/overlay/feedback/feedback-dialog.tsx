// report-problem 화면. main이 연 overlay dialog 안에서 사람이 글만 쓴다. 보내는 것은 그 글뿐이고 screenshot도 화면 상태도
// 없다. 새 문제가 되거나 사람이 고른 기존 문제의 또 하나의 보고가 된다. 초안은 이 화면의 메모리에만 있다. 취소는 아무것도
// 저장하지 않고, 이미 접수한 것은 닫아도 지우지 않는다. 접수 뒤 묶인 Issue로 갈 수 있다. 안내에는
// code·ID·stack·원문 오류를 넣지 않고 문제 문구는 problems가 정한 값 그대로 쓴다.
import { useState } from "react";
import {
  Button,
  type Clipboard,
  CopyButton,
  Dialog,
  Field,
  List,
  ListItem,
  Select,
  systemClipboard,
  Textarea,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import {
  FEEDBACK_LIMITS,
  FEEDBACK_PROBLEM_NAME,
  type FeedbackAccepted,
  type LophnOverlayFeedback,
} from "../../../ipc/feedback.ts";
import type { LophnShellFeedbackSend } from "../../../../protocol/shell/feedback.ts";
import styles from "./feedback-dialog.module.css";

/** 기존 문제에 덧붙일 때 고르는 줄. 열림·해결됨 문제만 온다. */
interface FeedbackProblem {
  readonly id: string;
  readonly title: string;
  readonly count: number;
}

/** dialog가 쓰는 통로. 보내기는 글만 보낸다. */
export type FeedbackDialogApi =
  & Pick<LophnOverlayFeedback, "cancelFeedback" | "openFeedbackIssue">
  & LophnShellFeedbackSend;

interface FeedbackDialogProps {
  draftRef: string;
  api: FeedbackDialogApi;
  host: HTMLElement;
  clipboard?: Clipboard;
  /** 덧붙일 수 있는 기존 문제. 없으면 "Send it as" 고르기를 두지 않는다. */
  problems?: readonly FeedbackProblem[];
}

type Phase =
  | { state: "draft" }
  | { state: "sending" }
  | { state: "failed"; reason: "unreachable" | "rejected" }
  | { state: "received"; accepted: FeedbackAccepted };

function failureText(reason: "unreachable" | "rejected"): string {
  return reason === "unreachable"
    ? t("report-problem.error.unreachable")
    : t("report-problem.error.rejected");
}

export function FeedbackDialog(
  { draftRef, api, host, clipboard = systemClipboard, problems }:
    FeedbackDialogProps,
) {
  const [text, setText] = useState("");
  const [target, setTarget] = useState<"new" | "existing">("new");
  const [chosen, setChosen] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ state: "draft" });

  const length = [...text].length;
  const blank = text.trim().length === 0;
  const tooLong = length > FEEDBACK_LIMITS.text_scalars;
  const missingProblem = target === "existing" && chosen === null;
  const received = phase.state === "received";
  const sending = phase.state === "sending";

  async function send(): Promise<void> {
    if (blank || tooLong || missingProblem || sending || received) return;
    setPhase({ state: "sending" });
    try {
      const accepted = await api.sendFeedback(
        draftRef,
        text,
        target === "existing" ? chosen : null,
      );
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
        disabled={blank || tooLong || missingProblem || sending}
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
                ? <p className={styles.issue}>{FEEDBACK_PROBLEM_NAME}</p>
                : null}
            </section>
          )
          : (
            <>
              <Field
                label={t("report-problem.label.what-happened")}
                help={tooLong ? undefined : t("report-problem.hint.text-only")}
                error={tooLong ? t("report-problem.error.too-long") : undefined}
              >
                <Textarea
                  rows={4}
                  value={text}
                  readOnly={sending}
                  placeholder={t("report-problem.placeholder.describe")}
                  data-feedback="text"
                  onChange={(event) => setText(event.currentTarget.value)}
                />
              </Field>
              {problems === undefined
                ? null
                : (
                  <Field label={t("report-problem.label.send-as")}>
                    <Select
                      value={target}
                      disabled={sending}
                      onValueChange={(value) =>
                        setTarget(value === "existing" ? "existing" : "new")}
                      options={[
                        {
                          value: "new",
                          label: t("report-problem.label.option-new"),
                        },
                        {
                          value: "existing",
                          label: t("report-problem.label.option-existing"),
                        },
                      ]}
                    />
                  </Field>
                )}
              {problems !== undefined && target === "existing"
                ? (
                  <Field label={t("report-problem.label.which-problem")}>
                    <div className={styles.pickList} data-feedback="problems">
                      {problems.length === 0
                        ? (
                          <p className={styles.note}>
                            {t("report-problem.empty.no-problems")}
                          </p>
                        )
                        : (
                          <List>
                            {problems.map((problem) => (
                              <ListItem
                                key={problem.id}
                                title={problem.title}
                                meta={t("report-problem.label.report-count", {
                                  count: problem.count,
                                })}
                                selected={chosen === problem.id}
                                onSelect={() => setChosen(problem.id)}
                              />
                            ))}
                          </List>
                        )}
                    </div>
                  </Field>
                )
                : null}
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
