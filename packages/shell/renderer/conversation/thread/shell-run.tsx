// 사람이 `!`로 돌린 명령 한 줄. 사람 줄 자리(오른쪽, 사람 bubble과 같은 폭 규칙)에 "You ran"과 `! 명령` 머리가 서고
// 긴 명령은 줄바꿈해 3줄까지만 보이고(끝이 흐려진다) 눌러 펼친다. 바로 아래에 출력을 펼쳐 둔다(20줄이 넘으면 접는다).
// 끝나면 exit code(0이 아니면 경고색)를 보인다. harness는 exit code를
// 싣지 않아 실패·취소만 표시한다. agent 덩어리에 넣지 않으므로 이름과 "Worked for"가 붙지 않는다.
import {
  type ReactElement,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { CodeBlock } from "@lophn/ui/reading";
import { Shimmer, StatusMark } from "@lophn/ui/feedback";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import { conversationIcons } from "../../icons/mod.ts";
import { ToolStateMark } from "../activity/tool-state-mark.tsx";
import type { ToolCallState } from "../activity/model.ts";
import type { AgentTabSource } from "../agent-tab-source.ts";
import { useFold } from "./fold-toggle.tsx";
import styles from "./thread.module.css";

const FOLD_LINES = 20;

/** blob read의 값. harness는 글이고 lophn은 `{content: {exit_code, stdout, stderr}}`나 글이다. */
function readOf(value: unknown): { text: string; exit: number | null } {
  if (typeof value === "string") return { text: value, exit: null };
  const content =
    typeof value === "object" && value !== null
      ? (value as { content?: unknown }).content
      : undefined;
  if (typeof content === "object" && content !== null) {
    const { stdout, stderr, exit_code } = content as Record<string, unknown>;
    return {
      text: [stdout, stderr]
        .filter(
          (text): text is string => typeof text === "string" && text !== "",
        )
        .join("\n"),
      exit: typeof exit_code === "number" ? exit_code : null,
    };
  }
  return {
    text: typeof content === "string" ? content : (JSON.stringify(value) ?? ""),
    exit: null,
  };
}

/** 명령이 접힌 높이(3줄)를 넘쳐 잘리는지. 폭이 바뀌면 줄바꿈이 달라지므로 크기를 따라 다시 잰다. */
function useClamped(
  open: boolean,
  command: string,
): { ref: RefObject<HTMLElement | null>; clamped: boolean } {
  const ref = useRef<HTMLElement>(null);
  const [clamped, setClamped] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (node === null || open) return;
    const measure = () => setClamped(node.scrollHeight > node.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, command]);
  return { ref, clamped };
}

export function ShellRun({
  id,
  command,
  state,
  output,
  readBody,
  onStop,
}: {
  /** tool id. 출력이 item에 없으면(lophn) 이 id로 본문을 읽는다. */
  id: string;
  command: string;
  state: ToolCallState;
  output: string | null;
  readBody: AgentTabSource["toolCallBody"];
  /** 도는 동안 이 명령만 멈추는 단추. source가 못 하면 없다. */
  onStop?: ((item: string) => void) | undefined;
}): ReactElement {
  const running = state === "running";
  const [read, setRead] = useState<{ text: string; exit: number | null }>();
  useEffect(() => {
    if (running || output !== null) return;
    let live = true;
    void readBody(id, "output").then((result) => {
      if (live) {
        setRead(
          result.ok ? readOf(result.value.value) : { text: "", exit: null },
        );
      }
    });
    return () => {
      live = false;
    };
  }, [id, running, output, readBody]);
  const text = (output ?? read?.text ?? "").replace(/\n+$/, "");
  const exit = read?.exit ?? null;
  const fold = useFold(text, FOLD_LINES);
  const [open, setOpen] = useState(false);
  const { ref, clamped } = useClamped(open, command);
  const foldable = open || clamped;
  return (
    <div className={styles.shellRun} data-shell-run={id} data-side="end">
      <span className={styles.shellLabel}>
        <Icon icon={conversationIcons.shell} pixels={iconPixels("small")} />
        {t("conversation.label.shell-you-ran")}
      </span>
      <div className={styles.shellBox}>
        <div className={styles.shellHead}>
          <code
            ref={ref}
            className={styles.shellCommand}
            data-clamp={open ? undefined : ""}
            data-fade={!open && clamped ? "" : undefined}
            data-foldable={foldable ? "" : undefined}
            onClick={foldable ? () => setOpen(!open) : undefined}
          >
            <span className={styles.shellPrompt}>! </span>
            {command}
          </code>
          {running ? (
            <>
              <Shimmer>{t("conversation.label.shell-running")}</Shimmer>
              {onStop === undefined ? null : (
                <IconButton
                  icon={conversationIcons.stop}
                  label={t("conversation.button.stop")}
                  size="sm"
                  data-shell-stop=""
                  onClick={() => onStop(id)}
                />
              )}
            </>
          ) : exit !== null && exit !== 0 ? (
            <StatusMark
              tone="warning"
              label={t("conversation.label.shell-exit", { code: exit })}
            />
          ) : exit === 0 ? (
            <span className={styles.shellExit}>
              {t("conversation.label.shell-exit", { code: 0 })}
            </span>
          ) : (
            <ToolStateMark state={state} />
          )}
        </div>
        {foldable ? (
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={open}
            data-fold-toggle=""
            onClick={() => setOpen(!open)}
          >
            {t(
              open
                ? "conversation.button.fold-less"
                : "conversation.button.fold-more",
            )}
          </Button>
        ) : null}
        {text === "" ? null : (
          <div
            className={`${styles.wrapCode} ${styles.shellOutput}`}
            data-shell-output=""
          >
            <CodeBlock code={fold.shown} />
          </div>
        )}
        {fold.toggle}
      </div>
    </div>
  );
}
