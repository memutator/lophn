// lophn의 운영 보고(roles/lophn#R18). 순수 함수다: IO·model 호출이 없다. 보고는
// 앱 상태(app.runtime), 열린 문제(ListProblems), 진행 ticket(ListTickets·ShowTicket)의
// 확인된 사실을 먼저 싣는다. 소유 contract 읽기로 확인한 것만 사실이고, 읽지 못한
// 수치는 만들지 않고 "확인하지 못함"으로 적는다. 해석은 근거 주소가 있는 것만
// 붙이고 run당 최대 5줄이다.

// 해석의 상한이다(R18).
export const OPS_INTERPRETATION_LIMIT = 5;

// 읽은 사실이다(R18). 소유 contract의 읽기 결과 그대로고, 읽지 못한 항목은 사실이 아니다.
export type AppFact = {
  app: string;
  // app.runtime의 state다. 읽지 못했으면 null이다.
  state: "preparing" | "stopped" | "running" | "unavailable" | null;
  // run_enabled다. 읽지 못했으면 null이다.
  running: boolean | null;
};

export type ProblemFact = {
  problem: string;
  app: string;
  status: "open" | "fixing" | "closed";
  symptom: string;
};

export type TicketFact = {
  ticket: string;
  app: string;
  state: string;
  // 진행 중인지다(open·claimed).
  in_progress: boolean;
};

// 근거 주소가 있는 해석이다(R18). 주소는 읽은 사실의 정본 주소다.
export type Interpretation = {
  // 읽은 사실의 근거 주소다(app.runtime·ListProblems 등의 계약과 판).
  basis: string;
  // 한 줄 해석이다.
  line: string;
};

// 근거가 없는 해석이다. 받아들이지 않는다.
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// 사실이 확인됐는지 본다(R18). state가 읽히지 않았으면 확인된 사실이 아니다.
export function confirmed(fact: AppFact): boolean {
  return fact.state !== null && fact.running !== null;
}

// 미확인 수치다(R18: 미확인 수치는 확인하지 못함으로 적는다).
export const UNKNOWN_WORD = "확인하지 못함";

// 미확인을 적는 문장이다. 값을 만들지 않는다(가짜 health 없음).
export function unknownLine(subject: string): string {
  return `${subject}: ${UNKNOWN_WORD}`;
}

export type OpsReport = {
  // 확인된 사실이 먼저다(R18).
  facts: {
    apps: AppFact[];
    problems: ProblemFact[];
    tickets: TicketFact[];
  };
  // 근거 주소가 있는 해석이다. 최대 5줄이다(R18).
  interpretations: Interpretation[];
  // 확인하지 못한 수치다(R18).
  unknown: string[];
};

// 해석이 상한 안이고 각 줄에 근거 주소가 있는지 본다(R18). 근거가 없는 해석은
// 버리고(사실과 해석의 책임을 나눈다), 상한을 넘으면 남은 줄을 버린다.
export function buildOpsReport(input: {
  apps: AppFact[];
  problems: ProblemFact[];
  tickets: TicketFact[];
  interpretations: Interpretation[];
  unknown: string[];
}): OpsReport {
  const interpretations = input.interpretations
    .map((entry) => ({
      basis: entry.basis,
      line: oneLine(entry.line),
    }))
    .filter((entry) => entry.basis.trim() !== "" && entry.line !== "")
    .slice(0, OPS_INTERPRETATION_LIMIT);
  return {
    facts: {
      apps: input.apps.map((fact) => ({
        app: fact.app,
        state: fact.state,
        running: fact.running,
      })),
      problems: input.problems.map((fact) => ({
        problem: fact.problem,
        app: fact.app,
        status: fact.status,
        symptom: oneLine(fact.symptom),
      })),
      tickets: input.tickets.map((fact) => ({
        ticket: fact.ticket,
        app: fact.app,
        state: fact.state,
        in_progress: fact.in_progress,
      })),
    },
    interpretations,
    unknown: input.unknown.map((line) => oneLine(line)),
  };
}

// 보고 본문이다(R18). 확인된 사실이 먼저고 해석은 근거 주소와 함께 뒤에 온다.
export function opsReportBody(report: OpsReport): string {
  const facts: string[] = [];
  for (const app of report.facts.apps) {
    facts.push(
      confirmed(app)
        ? `- app ${app.app}: ${app.state}${
          app.running ? ", running" : ", not running"
        }`
        : `- ${unknownLine(`app ${app.app}`)}`,
    );
  }
  for (const problem of report.facts.problems) {
    facts.push(
      `- problem ${problem.problem} of ${problem.app}: ${problem.status} (${problem.symptom})`,
    );
  }
  for (const ticket of report.facts.tickets) {
    facts.push(
      `- ticket ${ticket.ticket} of ${ticket.app}: ${ticket.state}`,
    );
  }
  for (const line of report.unknown) {
    facts.push(`- ${line}: ${UNKNOWN_WORD}`);
  }
  const interpretations = report.interpretations.map((entry) =>
    `- ${entry.line} (${entry.basis})`
  );
  return [
    `# Ops report`,
    ``,
    `## Facts`,
    ``,
    ...(facts.length === 0 ? ["- (no records)"] : facts),
    ``,
    `## Interpretations`,
    ``,
    ...(interpretations.length === 0 ? ["- (none)"] : interpretations),
    ``,
  ].join("\n");
}
