import { err, ok, type Result } from "../../../../packages/base/mod.ts";
import { z } from "zod";
import { parseRef, type VersionRef } from "../../types.ts";
import { EXPERIMENT_KINDS, type ExperimentSpec } from "./types.ts";

const text = z.string().refine((s) => s.trim() !== "", "must not be empty");
const goal = z
  .object({
    scenario: text,
    checks: z.array(text).min(1).optional(),
  })
  .strict();

const schema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    hypothesis: text,
    start_run: text,
    model: text,
    change: z.object({ from: z.string(), to: z.string() }).strict(),
    target: z.array(goal),
    cases: z.array(goal),
    judgment: z.object({ rule: z.string() }).strict(),
    trials: z
      .object({ base: z.number().int(), max: z.number().int() })
      .strict(),
    budget_usd: z.number(),
  })
  .strict();

function ref(label: string, value: string, problems: string[]) {
  try {
    return parseRef(value);
  } catch (e) {
    problems.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// 파일의 ref는 글(`instruction:home@3`)이고 읽으면 VersionRef다.
export function parseSpec(
  value: unknown,
  folderId?: string,
): Result<ExperimentSpec> {
  const fail = (problems: string[]) =>
    err({
      code: "invalid_input" as const,
      message: `invalid experiment spec: ${problems[0]}`,
      details: { problems },
    });
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return fail(
      parsed.error.issues.map(
        (i) => `${i.path.join(".") || "(spec)"}: ${i.message}`,
      ),
    );
  }
  const s = parsed.data;
  const problems: string[] = [];

  if (folderId !== undefined && s.id !== folderId) {
    problems.push(`id: ${s.id} differs from folder ${folderId}`);
  }
  const from = ref("change.from", s.change.from, problems);
  const to = ref("change.to", s.change.to, problems);
  if (from && to) {
    if (from.kind !== to.kind || from.name !== to.name) {
      problems.push("change: from and to must be the same kind and name");
    } else if (from.n === to.n) {
      problems.push("change: from and to must differ in n");
    }
    if (!EXPERIMENT_KINDS.includes(from.kind)) {
      problems.push(`change: kind ${from.kind} cannot be an experiment`);
    }
  }
  if (s.target.length === 0) problems.push("target: needs at least one");
  if (s.cases.length === 0) problems.push("cases: needs at least one");
  const targets = new Set<string>();
  for (const g of s.target) {
    if (targets.has(g.scenario)) {
      problems.push(`target: scenario ${g.scenario} appears twice`);
    }
    targets.add(g.scenario);
  }
  for (const g of s.cases) {
    if (targets.has(g.scenario)) {
      problems.push(`cases: scenario ${g.scenario} is also a target`);
    }
  }
  if (s.judgment.rule !== "default@1") {
    problems.push(`judgment.rule: unknown rule ${s.judgment.rule}`);
  }
  const { base, max } = s.trials;
  if (!(1 <= base && base <= max && max <= 5)) {
    problems.push("trials: needs 1 <= base <= max <= 5");
  }
  if (!(s.budget_usd > 0)) problems.push("budget_usd: must be above 0");

  if (problems.length > 0 || !from || !to) return fail(problems);
  return ok({
    ...s,
    change: { from: from as VersionRef, to: to as VersionRef },
    judgment: { rule: "default@1" },
  });
}
