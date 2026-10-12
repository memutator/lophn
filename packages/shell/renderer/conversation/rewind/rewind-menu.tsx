// Rewind menu. 메시지의 "Rewind to here"와 header ⋯의 "Rewind…"가 여는 같은
// menu다. 선택지 셋, 막힌 선택지의 이유, 고른 범위의 preview(복원할 것·건너뛰는 것·남는 영향), 늘 보이는 바깥 변경
// 안내, 실행 중 work 안내를 보인다. 적용은 확인 창이 맡으므로 menu는 고른 시점과 범위를 부르는 쪽에 넘기는 데까지만
// 한다. 결정은 그 창에서만 낸다.
import { type ReactElement, useEffect, useRef, useState } from "react";
import { Button, Dialog, Field, Select } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type {
  RewindChoice,
  RewindItemView,
  RewindMenuView,
  RewindPreviewView,
  SourceResult,
} from "../agent-source.ts";
import { blockText, itemLabel, reasonText } from "./text.ts";
import styles from "./rewind-menu.module.css";

export interface RewindMenuProps {
  menu: RewindMenuView;
  /** 처음 고른 시점. null이면(header의 Rewind…) 마지막 메시지다. */
  message: string | null;
  /** 시점을 알아볼 메시지 한 줄. */
  excerpt: (message: string) => string;
  preview: (
    message: string,
    choice: RewindChoice,
  ) => Promise<SourceResult<RewindPreviewView>>;
  onRewind: (
    input: { message: string; choice: RewindChoice },
  ) => Promise<SourceResult<void>>;
  onClose: () => void;
}

type Preview =
  | { readonly state: "idle" }
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly value: RewindPreviewView };

const CHOICES: readonly RewindChoice[] = [
  "restore_all",
  "messages_only",
  "summarize",
];

function choiceLabel(choice: RewindChoice): string {
  switch (choice) {
    case "restore_all":
      return t("conversation.label.rewind-restore-all");
    case "messages_only":
      return t("conversation.label.rewind-messages-only");
    case "summarize":
      return t("conversation.label.rewind-summarize");
  }
}

function choiceHint(choice: RewindChoice): string {
  switch (choice) {
    case "restore_all":
      return t("conversation.rewind.hint-restore-all");
    case "messages_only":
      return t("conversation.rewind.hint-messages-only");
    case "summarize":
      return t("conversation.rewind.hint-summarize");
  }
}

function startError(code: string): string {
  switch (code) {
    // 먼저 멈춰야 하는 경우다.
    case "conflict":
      return t("conversation.rewind.running");
    case "summary_failed":
      return t("conversation.rewind.summary-failed");
    default:
      return t("conversation.rewind.start-failed");
  }
}

export function RewindMenu(props: RewindMenuProps): ReactElement {
  const { menu } = props;
  const [point, setPoint] = useState<string | null>(
    menu.points.find((item) => item.message === props.message)?.message ??
      menu.points.at(-1)?.message ?? null,
  );
  const [choice, setChoice] = useState<RewindChoice | null>(null);
  const [preview, setPreview] = useState<Preview>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 늦게 온 옛 preview가 지금 고른 것의 preview를 덮지 않게 한다.
  const sequence = useRef(0);
  // 부르는 쪽이 매번 새 함수를 줘도 preview를 다시 읽지 않는다.
  const loadPreview = useRef(props.preview);
  loadPreview.current = props.preview;

  const current = menu.points.find((item) => item.message === point);
  const blocked = (option: RewindChoice) => current?.blocked[option];
  const usable = (option: RewindChoice) =>
    !menu.running && current !== undefined && blocked(option) === undefined;

  useEffect(() => {
    const token = sequence.current += 1;
    if (point === null || choice === null) {
      setPreview({ state: "idle" });
      return;
    }
    setPreview({ state: "loading" });
    void loadPreview.current(point, choice).then((result) => {
      if (token !== sequence.current) return;
      setPreview(
        result.ok
          ? { state: "ready", value: result.value }
          : { state: "failed" },
      );
    });
  }, [point, choice]);

  const choose = (option: RewindChoice) => {
    if (busy || !usable(option)) return;
    setError(null);
    setChoice(option);
  };

  const changePoint = (next: string) => {
    if (busy) return;
    setPoint(next);
    setError(null);
    // 새 시점에서 막힌 범위를 고른 채로 두지 않는다.
    const target = menu.points.find((item) => item.message === next);
    if (choice !== null && target?.blocked[choice] !== undefined) {
      setChoice(null);
    }
  };

  const go = async () => {
    if (busy || point === null || choice === null) return;
    setBusy(true);
    setError(null);
    const result = await props.onRewind({ message: point, choice });
    if (result.ok) return props.onClose();
    setBusy(false);
    setError(startError(result.code));
  };

  const summarizing = choice === "summarize";
  const ready = preview.state === "ready" && !menu.running &&
    point !== null && choice !== null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose();
      }}
      title={t("conversation.title.rewind")}
      actions={
        <>
          <Button
            variant="ghost"
            data-rewind-cancel=""
            disabled={busy}
            onClick={props.onClose}
          >
            {t("common.button.cancel")}
          </Button>
          <Button
            variant="primary"
            data-rewind-primary=""
            disabled={!ready || busy}
            onClick={() => void go()}
          >
            {busy && summarizing ? t("conversation.button.summarizing") : t(
              summarizing
                ? "conversation.button.summarize-go"
                : "conversation.button.rewind-go",
            )}
          </Button>
        </>
      }
    >
      <div className={styles.menu}>
        {props.message !== null || menu.points.length === 0
          ? null
          : (
            <Field label={t("conversation.label.rewind-point")}>
              <Select
                value={point ?? undefined}
                onValueChange={changePoint}
                options={menu.points.map((item) => ({
                  value: item.message,
                  label: props.excerpt(item.message),
                }))}
              />
            </Field>
          )}
        {menu.running
          ? (
            <p className={styles.running} role="status" data-rewind-running="">
              {t("conversation.rewind.running")}
            </p>
          )
          : null}
        <div
          className={styles.choices}
          role="radiogroup"
          aria-label={t("conversation.title.rewind")}
        >
          {CHOICES.map((option) => {
            const reason = blocked(option);
            const disabled = !usable(option);
            return (
              <button
                key={option}
                type="button"
                role="radio"
                className={styles.choice}
                aria-checked={choice === option}
                aria-disabled={disabled ? true : undefined}
                data-choice={option}
                onClick={() => choose(option)}
              >
                <span className={styles.choiceLabel} data-rewind-label="">
                  {choiceLabel(option)}
                </span>
                <span className={styles.hint} data-rewind-hint="">
                  {choiceHint(option)}
                </span>
                {reason === undefined
                  ? null
                  : (
                    <span className={styles.blocked} data-rewind-blocked="">
                      {blockText(reason)}
                    </span>
                  )}
              </button>
            );
          })}
        </div>
        <PreviewList preview={preview} />
        {error === null
          ? null
          : <p className={styles.error} role="alert">{error}</p>}
        <p className={styles.note} data-rewind-note="">
          {t("conversation.rewind.note")}
        </p>
      </div>
    </Dialog>
  );
}

function PreviewList({ preview }: { preview: Preview }): ReactElement | null {
  if (preview.state === "idle") return null;
  if (preview.state === "loading") {
    return (
      <p className={styles.hint} data-rewind-loading="">
        {t("conversation.label.rewind-loading")}
      </p>
    );
  }
  if (preview.state === "failed") {
    return (
      <p className={styles.error} role="alert">
        {t("conversation.rewind.preview-failed")}
      </p>
    );
  }
  const { value } = preview;
  return (
    <div className={styles.preview} data-rewind-preview="">
      <Group
        name="restore"
        title={t("conversation.label.rewind-restore")}
        items={value.restore}
      />
      <Group
        name="skip"
        title={t("conversation.label.rewind-skip")}
        items={value.skip}
      />
      <Group
        name="remain"
        title={t("conversation.label.rewind-remain")}
        items={value.remain}
      />
      <p className={styles.hint} data-rewind-redo="">
        {t(
          value.redo
            ? "conversation.rewind.redo-yes"
            : "conversation.rewind.redo-no",
        )}
      </p>
    </div>
  );
}

function Group(
  { name, title, items }: {
    name: string;
    title: string;
    items: readonly RewindItemView[];
  },
): ReactElement | null {
  if (items.length === 0) return null;
  return (
    <section className={styles.group} data-rewind-group={name}>
      <h3 className={styles.groupTitle}>{title}</h3>
      <ul className={styles.items}>
        {items.map((item, index) => {
          const reason = reasonText(item.reason);
          return (
            <li key={index} data-item="">
              <span className={item.kind === "file" ? styles.mono : undefined}>
                {itemLabel(item)}
              </span>
              {reason === null ? null : <>{" "}{reason}</>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
