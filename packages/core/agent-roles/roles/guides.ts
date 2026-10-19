import artifact from "./lophn/guides/artifact.md" with { type: "text" };
import connections from "./lophn/guides/connections.md" with { type: "text" };
import domains from "./lophn/guides/domains.md" with { type: "text" };
import featuresAndScreens from "./lophn/guides/features-and-screens.md" with {
  type: "text",
};
import instructions from "./lophn/guides/instructions.md" with {
  type: "text",
};
import questionsAndDecisions from "./lophn/guides/questions-and-decisions.md" with {
  type: "text",
};
import rewind from "./lophn/guides/rewind.md" with { type: "text" };
import rolesAndGrants from "./lophn/guides/roles-and-grants.md" with {
  type: "text",
};
import settings from "./lophn/guides/settings.md" with { type: "text" };
import skillsAndMcp from "./lophn/guides/skills-and-mcp.md" with {
  type: "text",
};

// 사용 안내는 모듈에 묶어 가져온다(prompts.ts와 같은 이유). `guide.read`가 topic 이름 목록과 본문을
// 여기서 읽는다.
const GUIDES: ReadonlyMap<string, string> = new Map([
  ["features-and-screens", featuresAndScreens],
  ["roles-and-grants", rolesAndGrants],
  ["questions-and-decisions", questionsAndDecisions],
  ["settings", settings],
  ["connections", connections],
  ["skills-and-mcp", skillsAndMcp],
  ["instructions", instructions],
  ["rewind", rewind],
  ["artifact", artifact],
  ["domains", domains],
]);

export function guideTopics(): readonly string[] {
  return [...GUIDES.keys()];
}

export function guideText(topic: string): string | undefined {
  return GUIDES.get(topic);
}
