// 대기 목록의 job hold card 한 장. 놓친 차례를 사람이 정한다: [Start now]나 [Skip].
// 실제 `Head`와 waiting.module.css를 쓴다. 앱·project는 id만 알아 짧은 id로 그린다(activation 카드와 같다).
// 결정한 뒤에는 `JobChanged`로 목록을 다시 읽어 card가 빠진다. 남는 줄과 toast는 없다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { formatRelativeTime } from "@lophn/wording";

import { Head } from "../../../../packages/shell/renderer/desktop/connection/waiting/cards/head.tsx";
import type { CardView } from "../../../../packages/shell/renderer/desktop/connection/waiting/model.ts";
import type { CallAgent } from "../../../../packages/protocol/lophn-agent/calls.ts";
import styles from "../../../../packages/shell/renderer/desktop/connection/waiting/waiting.module.css";
import type {
  AgentRefView,
  JobActionView,
  JobHoldView,
} from "../../mock/jobs-hold-data.ts";

/** null이면 접수됐다. conflict는 앞 차례가 아직 돌아 [Start now]가 막힌 것이다. */
export type HoldFailure = "conflict" | "failed" | null;
export type HoldChoice = "run_now" | "skip";

const shortId = (id: string) => id.slice(-6);

const AGENT = {
  lophn: "lophn",
  project_manager: "Project Manager",
  app_engineer: "App Engineer",
  operator: "Operator",
} as const;

function creatorText(creator: AgentRefView): string {
  switch (creator.role) {
    case "lophn":
      return AGENT.lophn;
    case "project_manager":
      return `${AGENT.project_manager} · Project ${shortId(creator.project)}`;
    case "app_engineer":
      return `${AGENT.app_engineer} · App ${shortId(creator.app)}`;
    case "operator":
      return AGENT.operator;
  }
}

function actionText(action: JobActionView): string {
  switch (action.kind) {
    case "agent_run":
      return `Asks ${AGENT[action.agent.role]}`;
    case "tool_run":
      return `Uses ${action.tool} in App ${shortId(action.app)}`;
    case "workflow_start":
      return `Starts workflow ${action.workflow}`;
  }
}

const missedText = (count: number) =>
  count === 1 ? "Missed once" : `Missed ${count} times`;

export function HoldCard(
  { hold, onDecide }: {
    hold: JobHoldView;
    onDecide: (choice: HoldChoice) => Promise<HoldFailure>;
  },
) {
  const { job, job_run: row } = hold;
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<HoldFailure>(null);
  const now = new Date();
  // Head는 요청한 agent의 얼굴을 그린다. job을 만든 agent의 얼굴이다.
  const view: CardView = {
    kind: "permission",
    title: job.title,
    description: actionText(job.action),
    meta: `Created by ${creatorText(job.creator)}`,
    age: formatRelativeTime(new Date(row.created_at), now),
    requester: null,
    facts: [],
    factsPinned: false,
    added: [],
    loss: [],
    first: false,
    choices: [],
  };

  async function decide(choice: HoldChoice) {
    setBusy(true);
    setFailure(await onDecide(choice));
    setBusy(false);
  }

  return (
    <article className={styles.request} data-job-hold={job.id}>
      <Head view={view} agent={job.creator as CallAgent} />
      <div className={styles.reason}>
        <p className={styles.desc}>
          {missedText(row.missed_count)}. The last turn was due{" "}
          {formatRelativeTime(new Date(row.due_at), now)}.
        </p>
      </div>
      {failure === null
        ? null
        : (
          <p className={styles.error} data-hold-failure={failure}>
            {failure === "conflict"
              ? "The previous turn is still going. Try again when it finishes."
              : "Could not send your answer. Try again."}
          </p>
        )}
      <div className={styles.actions}>
        <Button
          size="sm"
          disabled={busy}
          data-skip=""
          onClick={() => decide("skip")}
        >
          Skip
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          data-start-now=""
          onClick={() => decide("run_now")}
        >
          Start now
        </Button>
      </div>
    </article>
  );
}
