// app-design judge 입력. 켜진 release의 DESIGN.md에서 Journeys와 Screens 절을 읽는다.
import { joinInput } from "../../judge/mod.ts";
import type { CheckInput } from "../../types.ts";
import { clip, designOf, designSection } from "./design-doc.ts";

export function appDesignInput(
  card: string,
  app: string,
): (input: CheckInput) => Promise<string> {
  return async (input) => {
    const text = await designOf(input, app);
    const section = (name: string) => {
      if (text === null) return "(DESIGN.md not found)";
      const body = designSection(text, name);
      return body === null ? `(no ${name} section)` : clip(body);
    };
    return joinInput([
      { label: "CARD", text: card },
      { label: "JOURNEYS", text: section("Journeys") },
      { label: "SCREENS", text: section("Screens") },
    ]);
  };
}
