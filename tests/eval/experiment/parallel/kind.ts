export type TrialKind = "judgment" | "coding";

// coding agent trial은 진짜 Claude Code를 PTY로 띄워 무거워서 판단 case보다 적게 동시에 돈다.
export const DEFAULT_LIMITS: Readonly<Record<TrialKind, number>> = {
  judgment: 4,
  coding: 2,
};

export function trialKindOf(
  scenario: { real: readonly { role: string }[] },
): TrialKind {
  return scenario.real.some((p) => p.role === "coding_agent")
    ? "coding"
    : "judgment";
}
