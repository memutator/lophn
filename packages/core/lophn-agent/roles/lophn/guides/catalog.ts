// 동봉 안내의 설치 상대 경로와 화면 제목. bytes와 판은 설치가 넘긴다.

export type GuideSection = Readonly<{
  heading: string;
  features: readonly string[];
}>;

export type GuideSource = Readonly<{
  path: string;
  title: string;
  sections: readonly GuideSection[];
}>;

export const GUIDE_MEDIA_TYPE = "text/markdown";

const feature = (heading: string, ...features: string[]): GuideSection =>
  Object.freeze({
    heading,
    features: Object.freeze([...features]),
  });

function source(
  path: string,
  title: string,
  sections: readonly GuideSection[],
): GuideSource {
  return Object.freeze({ path, title, sections: Object.freeze(sections) });
}

export const GUIDE_SOURCES: readonly GuideSource[] = Object.freeze([
  source("roles/lophn/guides/features-and-screens.md", "Features and screens", [
    feature("Find an existing answer first", "Help"),
    feature(
      "Where things live",
      "Launcher",
      "Project workspace",
      "Conversation",
    ),
    feature(
      "Features",
      "Projects",
      "Documents",
      "Contexts",
      "Apps",
      "Roles",
      "Settings",
      "Things to confirm",
    ),
    feature("What a conversation shows", "Conversation", "In progress"),
  ]),
  source("roles/lophn/guides/settings.md", "Settings", [
    feature("What an explanation uses", "Settings"),
    feature("How a change is applied", "Settings", "Question"),
    feature("What Settings cannot do", "Settings", "Protected entry"),
  ]),
  source("roles/lophn/guides/connections.md", "Connections", [
    feature("What you can connect", "Connection", "API key"),
    feature("Protected entry", "Protected entry", "API key"),
    feature(
      "Accounts and models",
      "Connection",
      "Preset",
      "For decisions",
      "For summaries",
    ),
  ]),
  source("roles/lophn/guides/roles-and-presets.md", "Roles and Presets", [
    feature(
      "The four roles",
      "lophn",
      "App Engineer",
      "Context Engineer",
      "Operator",
      "Preset",
    ),
    feature("What is fixed, and when it changes", "Preset", "Repeating check"),
  ]),
  source(
    "roles/lophn/guides/questions-and-decisions.md",
    "Questions and decisions",
    [
      feature("How you answer", "Question", "Things to confirm"),
      feature(
        "Decisions that leave this question",
        "Confirmation window",
        "Access",
      ),
    ],
  ),
  source("roles/lophn/guides/revert.md", "Revert", [
    feature("Before anything changes", "Revert"),
    feature("What restore means", "Revert", "Version"),
  ]),
  source("roles/lophn/guides/skills-and-mcp.md", "Skills and MCP", [
    feature("Skills", "Skill"),
    feature("MCP", "MCP", "Preset"),
  ]),
  source("roles/lophn/guides/instructions.md", "Instructions", [
    feature("Where you edit", "Instructions"),
    feature("What the next call reads", "Instructions", "Preset"),
  ]),
]);

export function guideSource(path: string): GuideSource | undefined {
  return GUIDE_SOURCES.find((item) => item.path === path);
}
