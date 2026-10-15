// 계약 위반을 받은 Project Manager의 Agent 탭. 위반 toast와 위반 목록의 [Send to …]가 연다.
// 둘 다 파일과 어긴 규칙이 근거로 붙는다. 사람이 글을 쓰지 않는다.
import { useState } from "react";

import { AgentTurn, ChatShell, Quiet, Said, ToolRow } from "../agent-chat.tsx";
import { Link } from "../link.tsx";
import { documentTab } from "../phroner-data.ts";
import type { TabSpec } from "../project-window.tsx";
import {
  violationEvidence,
  type ViolationRow,
  VIOLATIONS,
} from "./contexts-data.ts";
import { useOpenTab } from "./open-tab.ts";
import styles from "./contexts.module.css";

const PROJECT_MANAGER = "Project Manager";

/** 새 session. 위반 근거가 composer chip으로 붙어 있고 입력칸은 비어 있다. */
function NewSession({ rows }: { rows: readonly ViolationRow[] }) {
  const [chip, setChip] = useState<string | undefined>(violationEvidence(rows));
  return (
    <ChatShell
      agent={PROJECT_MANAGER}
      session={{ id: "", title: "New session" }}
      chip={chip}
      onChip={() => setChip(undefined)}
      placeholder={chip === undefined
        ? `Ask ${PROJECT_MANAGER}… @ for documents and contexts, / for skills`
        : `What should ${PROJECT_MANAGER} do about this?`}
    >
      {() => (
        <p className={styles.muted}>
          {chip === undefined
            ? `New session with ${PROJECT_MANAGER}.`
            : `${PROJECT_MANAGER} will see the attached documents and rules with your first message.`}
        </p>
      )}
    </ChatShell>
  );
}

/** reaction이 이미 연 session. Project Manager가 위반을 받아 일하는 중이다. */
function WorkingSession() {
  const open = useOpenTab();
  const [opened, setOpened] = useState<Record<string, boolean>>({ read: true });
  const toggle = (key: string) => setOpened({ ...opened, [key]: !opened[key] });
  return (
    <ChatShell
      agent={PROJECT_MANAGER}
      session={{ id: "violations", title: "eval violations" }}
      running
      placeholder={`Ask ${PROJECT_MANAGER}… @ for documents and contexts, / for skills`}
    >
      {(detail) => {
        const show = detail !== "messages";
        const isOpen = (key: string) => detail === "everything" || opened[key];
        return (
          <>
            <Quiet>
              Opened by lophn · 2 documents in eval don't match
            </Quiet>
            <AgentTurn agent={PROJECT_MANAGER} time="10:21">
              {show
                ? (
                  <>
                    <ToolRow
                      label="Read 2 documents"
                      open={isOpen("read")}
                      onToggle={() => toggle("read")}
                    >
                      {VIOLATIONS.map((row) => (
                        <li key={row.path}>{row.path}</li>
                      ))}
                    </ToolRow>
                    <ToolRow
                      label="Read eval contract r3"
                      open={isOpen("contract")}
                      onToggle={() => toggle("contract")}
                    >
                      <li>Finding.effects is required</li>
                      <li>Experiment.status is draft | running | reported</li>
                    </ToolRow>
                  </>
                )
                : null}
              <Said>
                Two documents in eval break its contract.{" "}
                <Link onClick={() => open(documentTab(VIOLATIONS[0].path))}>
                  F-012
                </Link>{" "}
                has no effects, and{" "}
                <Link onClick={() => open(documentTab(VIOLATIONS[1].path))}>
                  exp-012
                </Link>{" "}
                uses the status “paused”. I'm checking whether the documents or
                the rule should change before I touch anything.
              </Said>
            </AgentTurn>
          </>
        );
      }}
    </ChatShell>
  );
}

/** 새 session을 여는 탭. rows가 근거로 붙는다. */
export const pmNewTab = (
  rows: readonly ViolationRow[] = VIOLATIONS,
): TabSpec => ({
  key: "agent:project-manager:new",
  kind: "agent",
  title: `New session · ${PROJECT_MANAGER}`,
  sub: "new",
  body: <NewSession rows={rows} />,
});

/** reaction이 이미 연 session의 탭. */
export const pmWorkingTab = (): TabSpec => ({
  key: "agent:project-manager:violations",
  kind: "agent",
  title: `eval violations · ${PROJECT_MANAGER}`,
  sub: "violations",
  body: <WorkingSession />,
});
