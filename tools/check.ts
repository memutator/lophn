// docs/dev/stack.md의 check 단계. 의존 규칙 검사는 contracts#T2가 이 배열에 더한다.
// 실행: deno task check

export type Runner = (command: string[]) => Promise<number>;

export type StepResult = {
  name: string;
  status: "통과" | "실패" | "건너뜀";
  note?: string;
};

export type Step = {
  name: string;
  command: string[];
  // 조건이 없으면 항상 돈다. 있으면 그 결과가 단계를 정한다.
  when?: () => Promise<Decision>;
};

export type Decision = {
  run: boolean;
  note?: string;
  // 단계 명령 전에 먼저 돌릴 명령. 실패하면 단계 명령은 돌지 않는다.
  before?: string[];
};

const SHELL_MAIN = "apps/shell/main";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

export const steps: Step[] = [
  { name: "fmt", command: ["deno", "fmt", "--check"] },
  { name: "lint", command: ["deno", "lint"] },
  // workspace 전체와 tools를 본다. check-docs.ts는 Node로만 돌아 deno.json에서 빼고 docs 단계가 실행으로 확인한다.
  { name: "check", command: ["deno", "check"] },
  {
    name: "test",
    command: ["deno", "test", "--allow-all", "--permit-no-files"],
  },
  {
    name: "shell",
    command: ["npm", "--prefix", SHELL_MAIN, "run", "check"],
    when: async () => {
      if (!(await exists(`${SHELL_MAIN}/package.json`))) {
        return { run: false, note: "건너뜀: apps/shell/main 없음" };
      }
      if (await exists(`${SHELL_MAIN}/node_modules`)) return { run: true };
      return {
        run: true,
        note: "npm ci를 먼저 돌림",
        before: ["npm", "--prefix", SHELL_MAIN, "ci"],
      };
    },
  },
  { name: "docs", command: ["node", "tools/check-docs.ts"] },
];

export async function runSteps(
  list: Step[],
  runner: Runner,
): Promise<{ results: StepResult[]; ok: boolean }> {
  const results: StepResult[] = [];
  for (const step of list) {
    const decision: Decision = step.when ? await step.when() : { run: true };
    if (!decision.run) {
      results.push({
        name: step.name,
        status: "건너뜀",
        note: decision.note,
      });
      continue;
    }
    if (decision.before) {
      const code = await runner(decision.before);
      if (code !== 0) {
        results.push({ name: step.name, status: "실패", note: decision.note });
        continue;
      }
    }
    const code = await runner(step.command);
    results.push({
      name: step.name,
      status: code === 0 ? "통과" : "실패",
      note: decision.note,
    });
  }
  return { results, ok: results.every((r) => r.status !== "실패") };
}

function table(results: StepResult[]): string {
  const nameWidth = Math.max(
    "단계".length,
    ...results.map((r) => r.name.length),
  );
  const statusWidth = Math.max(
    "결과".length,
    ...results.map((r) => r.status.length),
  );
  const line = (name: string, status: string, note: string) =>
    `${name.padEnd(nameWidth)}  ${status.padEnd(statusWidth)}  ${note}`;
  const rows = [
    line("단계", "결과", "비고"),
    "-".repeat(nameWidth + statusWidth + 6),
    ...results.map((r) => line(r.name, r.status, r.note ?? "")),
  ];
  return rows.join("\n");
}

if (import.meta.main) {
  const runner: Runner = async (command) => {
    const child = new Deno.Command(command[0], {
      args: command.slice(1),
      stdin: "null",
      stdout: "inherit",
      stderr: "inherit",
    });
    return (await child.output()).code;
  };
  const { results, ok } = await runSteps(steps, runner);
  console.log("");
  console.log(table(results));
  Deno.exit(ok ? 0 : 1);
}
