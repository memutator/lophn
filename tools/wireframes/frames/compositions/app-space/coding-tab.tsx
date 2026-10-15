// 앱 공간의 옆 pane이 coding agent의 TUI를 보이는 모양. TUI 글은 gallery의 가짜 출력이다.
// 끝나면 session이 끝난 상태로 보이고 다시 시작 단추는 없다. harness의 권한 물음은 TUI 안에 있고 답도 거기서 한다.
import { StatusMark } from "@lophn/design/components";

import { TICKET, TICKET_TITLE } from "./data.ts";
import styles from "./app-space.module.css";

export type CodingScene = "running" | "permission" | "ended";

const HEAD = "✻ Claude Code\n  /home/mina/.lophn/apps/orders/source";

const WORK = [
  `> Work on ticket ${TICKET}: ${TICKET_TITLE}.`,
  "  Read it with `lophn ticket show`, claim it, and report when you are done.",
  "",
  "● I'll read the ticket first.",
  `● Bash(lophn ticket show ${TICKET})`,
  "  ⎿  Discounted totals are one cent off. Expected 42.00, got 41.99.",
  "● Bash(lophn ticket claim)",
  "  ⎿  Claimed.",
  "● Read(src/orders/totals.ts)",
  "  ⎿  Read 64 lines",
  "● Update(src/orders/totals.ts)",
  "  ⎿  Updated src/orders/totals.ts with 3 additions and 1 removal",
].join("\n");

export function CodingTerminal({ scene }: { scene: CodingScene }) {
  return (
    <div className={styles.tui} data-coding-scene={scene}>
      <pre
        className={`${styles.tuiScreen} ${
          scene === "ended" ? styles.tuiDim : ""
        }`}
      >
        <span className={styles.tuiBox}>{HEAD}</span>
        {"\n\n"}
        {WORK}
        {scene === "running"
          ? "\n\n✻ Running the tests… (42s · esc to interrupt)\n\n> "
          : null}
        {scene === "permission" ? "\n" : null}
        {scene === "ended"
          ? `\n● Bash(lophn ticket report-done)\n  ⎿  Reported.\n\n● Done. ${TICKET} is fixed and reported as complete.\n`
          : null}
      </pre>
      {scene === "permission"
        ? (
          <pre
            className={styles.tuiScreen}
            style={{ flex: "none", paddingTop: 0 }}
          >
            <span className={styles.tuiAsk}>
              {"Bash command\n  git diff --stat origin/main\n\n Do you want to proceed?\n"}
              <span className={styles.tuiChoiceOn}>
                {" ❯ 1. Yes\n"}
              </span>
              {"   2. Yes, and don't ask again for git diff commands\n   3. No, and tell Claude what to do differently (esc)"}
            </span>
          </pre>
        )
        : null}
      {scene === "ended"
        ? (
          <div className={styles.endedBar} role="status">
            <StatusMark tone="neutral" label="Session ended" />
            <span className={styles.muted}>
              Claude Code reported {TICKET}{" "}
              as complete. The next hand-off from App Engineer starts a new
              session.
            </span>
          </div>
        )
        : null}
    </div>
  );
}
