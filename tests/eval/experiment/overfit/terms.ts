import type { Participant, Scenario } from "../../types.ts";
import { isAscii, normalize } from "./text.ts";

function phrasesOf(text: string): string[] {
  const tokens = normalize(text).split(" ");
  const out: string[] = [];
  for (let i = 0; i + 3 <= tokens.length; i++) {
    const phrase = tokens.slice(i, i + 3).join(" ");
    const size = phrase.replaceAll(" ", "").length;
    if (size < 6 || (isAscii(phrase) && size < 12)) continue;
    out.push(phrase);
  }
  return out;
}

// 시나리오 고유의 이름과 사람 말 구절. 재료 안의 이름은 호출하는 쪽이 extraNames로 넘긴다.
export function scenarioTerms(
  scenario: Scenario,
  extraNames: string[] = [],
): { names: string[]; phrases: string[] } {
  const raw: (string | undefined)[] = [...extraNames];
  const texts: string[] = [];
  const addParticipant = (p: Participant) => {
    const place = p.place as { app?: string; project?: string } | undefined;
    raw.push(place?.app, place?.project, p.name);
  };
  for (const step of scenario.steps) {
    if (step.kind === "say") {
      addParticipant(step.to);
      texts.push(step.text);
    } else if (step.kind === "callApi") raw.push(step.app);
  }
  scenario.real.forEach(addParticipant);
  if (scenario.human) texts.push(scenario.human.card);
  const names = raw.map((n) => n?.normalize("NFC").trim() ?? "")
    .filter((n) => n.length >= 2);
  return {
    names: [...new Set(names)],
    phrases: [...new Set(texts.flatMap(phrasesOf))],
  };
}
