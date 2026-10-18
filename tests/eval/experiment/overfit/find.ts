import type { Scenario } from "../../types.ts";
import type { OverfitWarning } from "../spec/mod.ts";
import type { ChangedText } from "./load.ts";
import { scenarioTerms } from "./terms.ts";
import { addedLines, isAscii, normalize } from "./text.ts";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// text 안에서 term이 몇 번 나오나. 이름은 ASCII면 단어 경계로, 아니면 includes로 센다.
function count(text: string, term: string, kind: "name" | "phrase"): number {
  if (kind === "phrase") return normalize(text).split(term).length - 1;
  if (isAscii(term)) {
    const re = new RegExp(
      `(?<![a-z0-9])${escape(term.toLowerCase())}(?![a-z0-9])`,
      "g",
    );
    return text.toLowerCase().match(re)?.length ?? 0;
  }
  return text.normalize("NFC").split(term).length - 1;
}

export function findOverfit(
  changed: ChangedText,
  scenarios: Scenario[],
  extraNames: Record<string, string[]> = {},
): OverfitWarning[] {
  const { change, before, after } = changed;
  const component =
    `${change.from.kind}:${change.from.name}@${change.from.n}→@${change.to.n}`;
  const out: OverfitWarning[] = [];
  for (const s of scenarios) {
    const { names, phrases } = scenarioTerms(s, extraNames[s.id] ?? []);
    const terms = [
      ...names.map((term) => ({ term, kind: "name" as const })),
      ...phrases.map((term) => ({ term, kind: "phrase" as const })),
    ];
    for (
      const file of new Set([...Object.keys(before), ...Object.keys(after)])
    ) {
      const was = before[file] ?? "";
      const now = after[file] ?? "";
      const added = addedLines(was, now);
      for (const { term, kind } of terms) {
        const line = added.find((l) => count(l, term, kind) > 0);
        if (line === undefined) continue;
        if (count(now, term, kind) <= count(was, term, kind)) continue;
        out.push({
          scenario: `${s.id}@${s.n}`,
          component,
          file,
          kind,
          term,
          line: line.slice(0, 160),
        });
      }
    }
  }
  return out;
}
