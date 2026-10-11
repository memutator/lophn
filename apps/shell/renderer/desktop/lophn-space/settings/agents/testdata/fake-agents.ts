// Settings › Agents test의 가짜 통로. core를 부르지 않고 부른 것을 모두 기록한다. 칸을 바꾸면
// settingsSeq가 하나 올라가고 다음 읽기에 반영된다. model 이름과 option 이름·값은 모두 이 catalog에서
// 온다(화면 코드에 없다).
import type {
  AgentsSettingsSource,
  AgentsSettingsView,
  CatalogModel,
  DefaultSlot,
  ModelChoice,
  ServerRow,
  SkillRow,
  SourceResult,
} from "../settings-source.ts";

export const ANTHROPIC = "pvd_01h455vb4pex5v6nkc6gd5fd11";
export const OPENAI = "pvd_01h455vb4pex5v6nkc6gd5fd12";
export const XAI = "pvd_01h455vb4pex5v6nkc6gd5fd13";

const EFFORT_LOW_TO_MAX = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "maximum", label: "Max" },
] as const;

export function speedAxis(label = "Speed") {
  return {
    id: "speed",
    label,
    values: [
      { value: "standard", label: "Standard" },
      { value: "fast", label: "Fast" },
    ],
    defaultValue: "standard",
  } as const;
}

export const CATALOG: readonly CatalogModel[] = [
  {
    providerDefinition: "anthropic",
    modelName: "claude-sonnet-5-5",
    options: [{
      id: "effort",
      label: "Effort",
      values: EFFORT_LOW_TO_MAX,
      defaultValue: "medium",
    }],
  },
  {
    providerDefinition: "anthropic",
    modelName: "claude-opus-5-5",
    options: [
      {
        id: "effort",
        label: "Effort",
        values: EFFORT_LOW_TO_MAX,
        defaultValue: "high",
      },
      speedAxis(),
    ],
  },
  {
    providerDefinition: "openai",
    modelName: "gpt-6.1",
    options: [{
      id: "effort",
      label: "Effort",
      values: EFFORT_LOW_TO_MAX.slice(0, 3),
      defaultValue: "medium",
    }],
  },
  // option이 없다고 확인된 model.
  { providerDefinition: "openai", modelName: "gpt-6.1-mini", options: [] },
  // option을 아직 모르는 model.
  { providerDefinition: "xai", modelName: "grok-4.7", options: null },
];

export const SKILLS: readonly SkillRow[] = [
  {
    name: "plain-writing",
    detail: "Keeps summaries short and in plain words.",
    enabled: true,
  },
  {
    name: "cite-documents",
    detail: "Links every claim to the document it came from.",
    enabled: true,
  },
  {
    name: "meeting-notes",
    detail: "Turns a transcript into notes.",
    enabled: false,
  },
];

export const SERVERS: readonly ServerRow[] = [
  {
    name: "fetch",
    detail: "Reads a web page as Markdown",
    enabled: true,
    status: "connected",
  },
  {
    name: "mail",
    detail: "Reads your inbox",
    enabled: true,
    status: "needs-sign-in",
  },
  {
    name: "calendar",
    detail: "Reads your calendar",
    enabled: false,
    status: "off",
  },
];

export const INSTRUCTIONS_PREVIEW = `# About me
I run the eval loop on my own. Answer in short plain sentences.
Ask before you change a document I did not mention.`;

export function choice(
  provider: string,
  modelName: string,
  optionValues: Record<string, string> = {},
): ModelChoice {
  return { provider, modelName, optionValues };
}

export function view(
  options: Partial<AgentsSettingsView> = {},
): AgentsSettingsView {
  return {
    defaults: {
      lophn: choice(ANTHROPIC, "claude-sonnet-5-5", { effort: "medium" }),
      context_engineer: choice(ANTHROPIC, "claude-opus-5-5", {
        effort: "high",
        speed: "standard",
      }),
      app_engineer: choice(OPENAI, "gpt-6.1", { effort: "medium" }),
      // 처음 설치한 기본값은 비어 있다.
      operator: null,
      summaries: choice(OPENAI, "gpt-6.1-mini"),
    },
    settingsSeq: "7",
    providers: [
      { id: ANTHROPIC, name: "Anthropic", definition: "anthropic" },
      { id: OPENAI, name: "OpenAI", definition: "openai" },
      { id: XAI, name: "xAI", definition: "xai" },
    ],
    catalog: CATALOG,
    instructionsPreview: INSTRUCTIONS_PREVIEW,
    skills: SKILLS,
    servers: SERVERS,
    ...options,
  };
}

export type AgentsCall =
  | readonly ["change", DefaultSlot, ModelChoice, string]
  | readonly ["instructions"]
  | readonly ["add-skill"]
  | readonly ["skill", string, boolean]
  | readonly ["add-server"]
  | readonly ["server", string, boolean];

export interface FakeAgentsOptions {
  view?: AgentsSettingsView;
  /** 이 이름의 호출은 이 code로 실패한다. 테스트가 지우면 다시 성공한다. */
  failing?: Partial<
    Record<
      | "read"
      | "change"
      | "instructions"
      | "add-skill"
      | "skill"
      | "add-server"
      | "server",
      string
    >
  >;
}

export function fakeAgents(options: FakeAgentsOptions = {}) {
  let current = options.view ?? view();
  const calls: AgentsCall[] = [];
  const failing = options.failing ?? {};
  const counts = { reads: 0 };
  const ok = (): SourceResult<null> => ({ ok: true, value: null });
  const fail = (name: keyof typeof failing): SourceResult<null> | null =>
    failing[name] === undefined ? null : { ok: false, code: failing[name]! };

  const source: AgentsSettingsSource = {
    read() {
      counts.reads += 1;
      return Promise.resolve(
        failing.read === undefined
          ? { ok: true, value: current } as const
          : { ok: false, code: failing.read } as const,
      );
    },
    changeDefault(slot, next, seq) {
      calls.push(["change", slot, next, seq]);
      const failed = fail("change");
      if (failed) return Promise.resolve(failed);
      if (seq !== current.settingsSeq) {
        return Promise.resolve({ ok: false, code: "conflict" } as const);
      }
      current = {
        ...current,
        defaults: { ...current.defaults, [slot]: next },
        settingsSeq: String(Number(current.settingsSeq) + 1),
      };
      return Promise.resolve(ok());
    },
    openInstructions() {
      calls.push(["instructions"]);
      return Promise.resolve(fail("instructions") ?? ok());
    },
    addSkill() {
      calls.push(["add-skill"]);
      return Promise.resolve(fail("add-skill") ?? ok());
    },
    setSkillEnabled(name, enabled) {
      calls.push(["skill", name, enabled]);
      const failed = fail("skill");
      if (failed) return Promise.resolve(failed);
      current = {
        ...current,
        skills: current.skills.map((row) =>
          row.name === name ? { ...row, enabled } : row
        ),
      };
      return Promise.resolve(ok());
    },
    addServer() {
      calls.push(["add-server"]);
      return Promise.resolve(fail("add-server") ?? ok());
    },
    setServerEnabled(name, enabled) {
      calls.push(["server", name, enabled]);
      const failed = fail("server");
      if (failed) return Promise.resolve(failed);
      current = {
        ...current,
        servers: current.servers.map((row) =>
          row.name === name
            ? {
              ...row,
              enabled,
              status: enabled
                ? row.status === "off" ? "connected" : row.status
                : "off",
            }
            : row
        ),
      };
      return Promise.resolve(ok());
    },
  };
  return { source, calls, counts };
}
