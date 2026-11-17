import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import { commonIcons } from "../../icons/mod.ts";
import type { SourceResult, ToolCallBodyView } from "../agent-tab-source.ts";
import { elapsedText, useSecondTick } from "./elapsed.ts";
import { inputText, outputText } from "./tool-body-text.ts";
import type { ToolCallState, ToolCallView, ToolLineDetail } from "./model.ts";
import styles from "./activity.module.css";

interface ToolLineProps {
  calls: readonly ToolCallView[];
  detail: ToolLineDetail;
  now: () => number;
  readBody: (
    toolCall: string,
    part: "input" | "output",
  ) => Promise<SourceResult<ToolCallBodyView>>;
}

/**
 * 전체 펼치기(`agent.toggle-details`)의 값. 바뀔 때만 tool 줄이 다시 그린다. 펼침 상태는 줄마다 두고, 이 값이 바뀌면
 * 그 값으로 맞춘다.
 */
export const ToolDetailsContext = createContext(false);

/** 펼침 상태. 전체 펼치기 값이 바뀌면 그 값으로 맞추고, 그 뒤의 누르기는 줄마다 그대로 된다. */
function useOpen(all: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(all);
  const [seen, setSeen] = useState(all);
  if (seen !== all) {
    setSeen(all);
    setOpen(all);
  }
  return [open, setOpen];
}

/** 접히는 줄 하나. 펼치고 접는 상태는 부르는 쪽이 쥔다. 펼치면 children(하위 줄)이 보인다. */
function ToolRow({
  id,
  label,
  open,
  onToggle,
  children,
}: {
  id?: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <div className={styles.tool} data-tool-line={id}>
      <button
        type="button"
        className={styles.toolHead}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>{label}</span>
        <Icon
          icon={open ? commonIcons.collapse : commonIcons.expand}
          pixels={iconPixels("small")}
        />
      </button>
      {open ? <ul className={styles.toolSub}>{children}</ul> : null}
    </div>
  );
}

/** 이어진 call 묶음 하나. hidden은 아무것도 그리지 않고, call이 하나면 그 call 줄이다. */
export function ToolLine({
  calls,
  detail,
  now,
  readBody,
}: ToolLineProps): ReactElement | null {
  // 눌러 둔 값은 hidden이나 expanded를 지나 collapsed로 돌아와도 남는다.
  const [pressed, setPressed] = useOpen(useContext(ToolDetailsContext));
  if (detail === "hidden") return null;
  const first = calls[0]!;
  if (calls.length === 1) {
    return <ToolCallLine call={first} now={now} readBody={readBody} />;
  }
  const open = detail === "expanded" || pressed;
  return (
    <ToolRow
      id={first.id}
      label={groupLabel(calls)}
      open={open}
      onToggle={() => setPressed(!open)}
    >
      {calls.map((call) => (
        <li key={call.id} data-tool-call-item="">
          <ToolCallLine call={call} now={now} readBody={readBody} />
        </li>
      ))}
    </ToolRow>
  );
}

/** 탐색 묶음의 접힌 줄. 0인 종류는 빼고 " · "로 잇는다. */
function exploreLabel(calls: readonly ToolCallView[]): string {
  const count = (category: ToolCallView["category"]) =>
    calls.filter((call) => call.category === category).length;
  const parts: string[] = [];
  const read = count("read");
  const searched = count("search");
  const listed = count("list");
  if (read > 0) {
    parts.push(t("conversation.label.tool-read", { count: read }));
  }
  if (searched > 0) {
    parts.push(t("conversation.label.tool-searched", { count: searched }));
  }
  if (listed > 0) {
    parts.push(t("conversation.label.tool-listed", { count: listed }));
  }
  return parts.join(" · ");
}

function groupLabel(calls: readonly ToolCallView[]): string {
  const first = calls[0]!;
  switch (first.category) {
    case "read":
    case "search":
    case "list":
      return exploreLabel(calls);
    case "command":
      return t("conversation.label.tool-ran", { count: calls.length });
    case "web":
      return t("conversation.label.tool-web", { count: calls.length });
    case "other":
      return t("conversation.label.tool-used", {
        count: calls.length,
        tool: first.tool,
      });
  }
}

/** call 줄 하나: 제목·걸린 시간·상태 낱말이 한 줄이고 누르면 입력과 출력이 열린다. */
function ToolCallLine({
  call,
  now,
  readBody,
}: {
  call: ToolCallView;
  now: () => number;
  readBody: ToolLineProps["readBody"];
}): ReactElement {
  const [open, setOpen] = useOpen(useContext(ToolDetailsContext));
  useSecondTick(call.state === "running" && call.startedAt !== null);
  const time = elapsedText(
    call.state === "running",
    call.startedAt,
    call.durationMs,
    now,
  );
  const state = stateWord(call.state);
  return (
    <div className={styles.toolCall} data-tool-call={call.id}>
      <button
        type="button"
        className={styles.toolHead}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className={styles.toolTitle}>{call.title}</span>
        {time === "" ? null : <span className={styles.toolMeta}>{time}</span>}
        {state === null ? null : (
          <span className={styles.toolMeta}>{state}</span>
        )}
        <Icon
          icon={open ? commonIcons.collapse : commonIcons.expand}
          pixels={iconPixels("small")}
        />
      </button>
      {open ? <ToolCallBody call={call} readBody={readBody} /> : null}
    </div>
  );
}

function stateWord(state: ToolCallState): string | null {
  switch (state) {
    case "error":
      return t("conversation.label.tool-call-failed");
    case "denied":
      return t("conversation.label.tool-call-denied");
    case "cancelled":
      return t("conversation.label.tool-call-cancelled");
    default:
      return null;
  }
}

type BodyRead = {
  readonly input: SourceResult<ToolCallBodyView>;
  readonly output: SourceResult<ToolCallBodyView>;
};

/** 처음 열릴 때 입력과 출력을 한 번 읽는다. 없는 출력(도는 중, 실행하지 않음)은 그리지 않는다. */
function ToolCallBody({
  call,
  readBody,
}: {
  call: ToolCallView;
  readBody: ToolLineProps["readBody"];
}): ReactElement | null {
  const [body, setBody] = useState<BodyRead | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([
      readBody(call.id, "input"),
      readBody(call.id, "output"),
    ]).then(([input, output]) => {
      if (live) setBody({ input, output });
    });
    return () => {
      live = false;
    };
  }, [call.id, readBody]);
  if (body === null) return null;
  const failed = [body.input, body.output].some(
    (read) => !read.ok && read.code !== "not_found",
  );
  return (
    <div className={styles.toolBody}>
      {body.input.ok ? (
        <BodyCell
          head={t("conversation.label.tool-input")}
          text={inputText(call, body.input.value)}
          truncated={body.input.value.truncated}
        />
      ) : null}
      {body.output.ok ? (
        <BodyCell
          head={t("conversation.label.tool-output")}
          text={outputText(call, body.output.value)}
          truncated={body.output.value.truncated}
        />
      ) : null}
      {failed ? (
        <p className={styles.toolNote}>
          {t("conversation.error.tool-body-failed")}
        </p>
      ) : null}
    </div>
  );
}

function BodyCell({
  head,
  text,
  truncated,
}: {
  head: string;
  text: string;
  truncated: boolean;
}): ReactElement {
  return (
    <div data-tool-body-cell="">
      <div className={styles.toolBodyHead}>{head}</div>
      <pre className={styles.toolBodyPre}>{text}</pre>
      {truncated ? (
        <p className={styles.toolNote}>
          {t("conversation.note.tool-body-truncated")}
        </p>
      ) : null}
    </div>
  );
}
