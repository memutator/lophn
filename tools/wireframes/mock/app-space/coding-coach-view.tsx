// 코딩 코치 앱이 그린 화면의 고정 그림. 앱 view는 앱이 그리므로 lophn 화면이 아니다. 사람이 쓴 코드(textarea)를 agent session에
// 보내고, 받은 줄 주석을 textarea의 줄 옆에 그린다. 상태는 ACP 모양의 가짜 값이고 `@lophn/agent` hook은 쓰지 않는다.
import { Button } from "@lophn/ui/primitives";

type Severity = "info" | "bug";

interface LineNote {
  readonly line: number;
  readonly severity: Severity;
  readonly note: string;
}

/** agent의 마지막 메시지에서 꼴 검사를 통과해 나온 값. */
export interface CoachReply {
  readonly annotations: readonly LineNote[];
}

/** ACP 상태에서 화면이 쓰는 것: turn의 단계. */
export type CoachPhase = "idle" | "working" | "waiting" | "failed";

export const CODE = [
  "function sum(items) {",
  "  let total = 0;",
  "  for (let i = 0; i <= items.length; i++) {",
  "    total += items[i].price;",
  "  }",
  "  return total;",
  "}",
].join("\n");

export const REPLY: CoachReply = {
  annotations: [
    {
      line: 3,
      severity: "bug",
      note: "`<=` reads one past the end. Use `<`.",
    },
    {
      line: 4,
      severity: "info",
      note: "`reduce` would say the same in one line.",
    },
  ],
};

const LINE_HEIGHT = "var(--type-small-line)";

const css = {
  view: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    gap: "var(--space-6)",
    minWidth: 0,
    padding: "var(--space-8)",
    overflow: "hidden",
    background: "var(--color-surface-floor)",
  },
  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--space-4)",
  },
  title: {
    margin: 0,
    fontSize: "var(--type-title-size)",
    lineHeight: "var(--type-title-line)",
  },
  muted: {
    margin: 0,
    color: "var(--color-text-muted)",
    fontSize: "var(--type-small-size)",
    lineHeight: "var(--type-small-line)",
  },
  editor: {
    display: "grid",
    gridTemplateColumns: "40px minmax(0, 1fr)",
    border: "var(--border-width) solid var(--color-border-base)",
    borderRadius: "var(--radius-md)",
    background: "var(--color-surface-base)",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--type-small-size)",
    lineHeight: LINE_HEIGHT,
  },
  gutter: {
    padding: "var(--space-4) var(--space-2)",
    textAlign: "right",
    color: "var(--color-text-muted)",
    borderRight: "var(--border-width) solid var(--color-border-subtle)",
  },
  textarea: {
    padding: "var(--space-4)",
    border: 0,
    outline: 0,
    resize: "none",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    lineHeight: LINE_HEIGHT,
  },
  notes: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-2)",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  note: {
    display: "flex",
    gap: "var(--space-3)",
    fontSize: "var(--type-small-size)",
    lineHeight: "var(--type-small-line)",
  },
} as const;

function Marker({ severity }: { severity: Severity }) {
  return (
    <span
      aria-label={severity}
      style={{
        color:
          severity === "bug"
            ? "var(--color-danger-text)"
            : "var(--color-text-muted)",
      }}
    >
      {severity === "bug" ? "●" : "○"}
    </span>
  );
}

export function CodingCoachView({
  code = CODE,
  reply,
  phase = "idle",
}: {
  code?: string;
  /** 받은 주석. 없으면 아직 검토 전이다. */
  reply?: CoachReply;
  phase?: CoachPhase;
}) {
  const lines = code.split("\n");
  const noted = new Map(
    (reply?.annotations ?? []).map((one) => [one.line, one]),
  );
  return (
    <div style={css.view} data-app-view="coding-coach">
      <div style={css.head}>
        <h1 style={css.title}>Coding coach</h1>
        <Button variant="primary" size="sm" disabled={phase === "working"}>
          {phase === "working" ? "Reviewing…" : "Send for review"}
        </Button>
      </div>
      <div style={css.editor}>
        <div style={css.gutter} aria-hidden="true">
          {lines.map((_, index) => {
            const one = noted.get(index + 1);
            return (
              <div key={index}>
                {one === undefined ? null : <Marker severity={one.severity} />}{" "}
                {index + 1}
              </div>
            );
          })}
        </div>
        <textarea
          readOnly
          rows={lines.length}
          defaultValue={code}
          aria-label="Your code"
          wrap="off"
          style={css.textarea}
        />
      </div>
      {phase === "failed" ? (
        <p style={css.muted}>
          The review didn't come back as notes. Send it again.
        </p>
      ) : reply === undefined ? (
        <p style={css.muted}>
          {phase === "working"
            ? "The coach is reading your code."
            : "Write some code, then send it for review. Notes appear beside the lines."}
        </p>
      ) : (
        <ul style={css.notes}>
          {reply.annotations.map((one) => (
            <li key={`${one.line}-${one.note}`} style={css.note}>
              <Marker severity={one.severity} />
              <span style={{ color: "var(--color-text-muted)" }}>
                Line {one.line}
              </span>
              <span>{one.note}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
