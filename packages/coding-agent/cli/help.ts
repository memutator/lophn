// CLI 도움말(architecture/coding-agent 5.4, cli#R39). 사람 help와 `help --json`
// 을 같은 command registry에서 만든다. 화면 문구가 아니라 기술 문장이므로
// wording key를 쓰지 않는다(exceptions: shell 화면 전용).
import {
  CLI_CORE_NAMES,
  CLI_DECISION_NAMES,
  CLI_SETUP_NAMES,
  CONFIRMATION_NAMES,
  HUMAN_ONLY_NAMES,
} from "../../contracts/coding-agent/mod.ts";
import type { AgentResult } from "../../contracts/coding-agent/mod.ts";

// command 등록 한 자리. 목적·입력·출력·읽기와 변경·권한·다음 조회를 묶는다.
export type CommandHelp = {
  command: string;
  purpose: string;
  required: string[];
  optional: string[];
  jsonExample: Record<string, unknown>;
  // read면 true, write면 false다. 접수·approval 대기는 write 아니다.
  mutate: boolean;
  humanOnly: boolean;
  confirmation: boolean;
  next: string[];
};

const CORE_HELP: readonly CommandHelp[] = [
  {
    command: "index",
    purpose: "root·place·context·document·section 목차와 반영 지연을 읽는다",
    required: [],
    optional: [
      "--input",
      "--input-file",
      "--connection",
      "--daemon-url",
      "--app",
      "op",
      "place",
      "context",
      "reference",
      "depth",
      "--base-revision",
    ],
    jsonExample: { command: "index", op: "root", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["index place", "index document", "search"],
  },
  {
    command: "search",
    purpose: "허용된 문서 대상 keyword 검색을 한다",
    required: ["<query>"],
    optional: ["--input", "--input-file", "place", "context", "cursor"],
    jsonExample: { command: "search", query: "plan", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["read", "index"],
  },
  {
    command: "read",
    purpose: "고정 판의 정확한 본문을 section·범위로 읽는다",
    required: ["reference"],
    optional: ["--input", "--input-file", "version", "section", "cursor"],
    jsonExample: {
      command: "read",
      reference: { document: "doc-x", version: "ver-1" },
      json: true,
    },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["document history", "document diff"],
  },
  {
    command: "document list",
    purpose: "place·보관 상태 선택으로 문서 목록을 1~500 한도로 읽는다",
    required: [],
    optional: [
      "--input",
      "--input-file",
      "place",
      "unplaced",
      "status",
      "limit",
      "cursor",
    ],
    jsonExample: {
      command: "document list",
      status: "active",
      limit: 20,
      json: true,
    },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["document history", "read"],
  },
  {
    command: "document history",
    purpose: "고정 판 사이의 추가·소실·변경·변경 없음 이력을 읽는다",
    required: ["document"],
    optional: ["--input", "--input-file", "from", "to", "cursor"],
    jsonExample: { command: "document history", document: "doc-x", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["document diff"],
  },
  {
    command: "document diff",
    purpose: "두 고정 판의 줄 단위 차이를 읽는다",
    required: ["document", "before", "after"],
    optional: ["--input", "--input-file", "section", "cursor"],
    jsonExample: {
      command: "document diff",
      document: "doc-x",
      before: "ver-1",
      after: "ver-2",
      json: true,
    },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["document history", "read"],
  },
  {
    command: "save",
    purpose: "파일 묶음을 정본 문서로 저장한다. 첫 파일이 primary다",
    required: ["<files...>"],
    optional: [
      "--input",
      "--input-file",
      "place",
      "slug",
      "title",
      "format",
      "series",
      "key",
      "--base-revision",
      "--idempotency-key",
    ],
    jsonExample: {
      command: "save",
      paths: ["docs/plan.md"],
      title: "plan",
      json: true,
    },
    mutate: true,
    humanOnly: false,
    confirmation: false,
    next: ["read", "document history"],
  },
  {
    command: "format list",
    purpose: "설치된 format 선언 목록을 읽는다",
    required: [],
    optional: ["--input", "--input-file", "media_type"],
    jsonExample: { command: "format list", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["format show"],
  },
  {
    command: "format show",
    purpose: "format 선언 하나를 읽는다",
    required: ["name", "module_hash"],
    optional: ["--input", "--input-file"],
    jsonExample: {
      command: "format show",
      name: "markdown",
      module_hash: "00",
      json: true,
    },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["format validate"],
  },
  {
    command: "format validate",
    purpose: "파일 bytes를 format으로 검사해 diagnostics를 낸다",
    required: ["<files...>"],
    optional: ["--input", "--input-file", "name", "paths"],
    jsonExample: {
      command: "format validate",
      name: "markdown",
      paths: ["docs/plan.md"],
      json: true,
    },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["format list", "save"],
  },
  {
    command: "project list",
    purpose: "등록된 project 목록을 읽는다",
    required: [],
    optional: ["--input", "--input-file", "status", "cursor", "limit"],
    jsonExample: { command: "project list", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["project show", "project current"],
  },
  {
    command: "project show",
    purpose: "project 하나의 폴더·역할·문서 수·context를 읽는다",
    required: ["project"],
    optional: ["--input", "--input-file"],
    jsonExample: { command: "project show", project: "prj-x", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["project list", "document list"],
  },
  {
    command: "project current",
    purpose: "현재 작업 위치가 어느 project인지 읽는다",
    required: [],
    optional: ["--input", "--input-file"],
    jsonExample: { command: "project current", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["project show"],
  },
  {
    command: "series list",
    purpose: "place별 series 목록과 규칙을 읽는다",
    required: [],
    optional: ["--input", "--input-file", "place", "status", "cursor"],
    jsonExample: { command: "series list", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["series show", "series next"],
  },
  {
    command: "series show",
    purpose: "series 하나의 규칙과 정렬된 인스턴스를 읽는다",
    required: ["selector"],
    optional: ["--input", "--input-file", "cursor"],
    jsonExample: {
      command: "series show",
      selector: { series: "ser-x" },
      json: true,
    },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["series next"],
  },
  {
    command: "series next",
    purpose: "다음 key와 title 제안을 읽는다. 저장은 하지 않는다",
    required: ["selector"],
    optional: ["--input", "--input-file"],
    jsonExample: {
      command: "series next",
      selector: { series: "ser-x" },
      json: true,
    },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["save"],
  },
];

const DECISION_HELP: readonly CommandHelp[] = [
  {
    command: "context list",
    purpose: "보관 포함 context 목록을 읽는다",
    required: [],
    optional: ["--input", "--input-file", "status", "cursor", "limit"],
    jsonExample: { command: "context list", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["context show", "context items"],
  },
  {
    command: "context show",
    purpose: "context 하나의 기준과 참고·watch 항목을 읽는다",
    required: ["context"],
    optional: ["--input", "--input-file"],
    jsonExample: { command: "context show", context: "ctx-x", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["context items", "context glossary"],
  },
  {
    command: "context items",
    purpose: "context 관점 항목을 읽는다",
    required: ["context"],
    optional: ["--input", "--input-file", "perspective"],
    jsonExample: { command: "context items", context: "ctx-x", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["context show"],
  },
  {
    command: "context glossary",
    purpose: "context의 용어 목록을 읽는다",
    required: [],
    optional: ["--input", "--input-file"],
    jsonExample: { command: "context glossary", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["context show"],
  },
  {
    command: "context of",
    purpose: "문서를 참조하는 context를 읽는다",
    required: ["target"],
    optional: ["--input", "--input-file", "status"],
    jsonExample: {
      command: "context of",
      target: { kind: "document", document: "doc-x" },
      json: true,
    },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["context show"],
  },
  {
    command: "context propose",
    purpose: "고정 변경안과 이유를 접수한다. 적용은 하지 않는다",
    required: ["change", "reason"],
    optional: ["--input", "--input-file", "--idempotency-key"],
    jsonExample: {
      command: "context propose",
      change: { kind: "set_item" },
      reason: "why",
      json: true,
    },
    mutate: true,
    humanOnly: false,
    confirmation: false,
    next: ["question list"],
  },
  {
    command: "question list",
    purpose: "허용된 질문 목록을 읽는다",
    required: [],
    optional: [
      "--input",
      "--input-file",
      "run",
      "assignment",
      "status",
      "cursor",
    ],
    jsonExample: { command: "question list", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["question show", "question open"],
  },
  {
    command: "question show",
    purpose: "질문 하나의 이유·option·상태를 읽는다",
    required: ["question"],
    optional: ["--input", "--input-file"],
    jsonExample: { command: "question show", question: "qst-x", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["question open"],
  },
  {
    command: "question open",
    purpose: "질문의 결정 화면 링크와 대기 사실을 낸다. 답을 입력받지 않는다",
    required: ["question"],
    optional: ["--input", "--input-file"],
    jsonExample: { command: "question open", question: "qst-x", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["question show"],
  },
  {
    command: "approval list",
    purpose: "허용된 approval request 목록을 읽는다",
    required: [],
    optional: ["--input", "--input-file", "status", "run", "limit"],
    jsonExample: { command: "approval list", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["approval show", "approval open"],
  },
  {
    command: "approval show",
    purpose: "approval의 exact 대상·입력·영향·기한을 읽는다",
    required: ["approval"],
    optional: ["--input", "--input-file"],
    jsonExample: { command: "approval show", approval: "apr-x", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["approval open"],
  },
  {
    command: "approval open",
    purpose:
      "approval의 결정 화면 링크와 대기 사실을 낸다. 허락을 입력받지 않는다",
    required: ["approval"],
    optional: ["--input", "--input-file"],
    jsonExample: { command: "approval open", approval: "apr-x", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["approval show"],
  },
];

const SETUP_HELP: readonly CommandHelp[] = CLI_SETUP_NAMES.map((name) => {
  const humanOnly = (HUMAN_ONLY_NAMES as readonly string[]).includes(name);
  const confirmation = (CONFIRMATION_NAMES as readonly string[]).includes(name);
  const purpose = setupPurpose(name);
  return {
    command: name,
    purpose,
    required: setupRequired(name),
    optional: ["--json", "--help", "--connection", "--daemon-url"],
    jsonExample: { command: name, json: true },
    mutate: setupMutates(name),
    humanOnly,
    confirmation,
    next: setupNext(name),
  };
});

function setupPurpose(name: string): string {
  switch (name) {
    case "doctor":
      return "daemon·인증·설정과 네 loading 단계를 점검한다";
    case "daemon start":
      return "daemon을 시작한다";
    case "daemon stop":
      return "daemon을 중지한다";
    case "daemon status":
      return "daemon 현재 상태를 읽는다";
    case "daemon logs":
      return "daemon log를 1~2,000줄로 읽는다";
    case "mcp config":
      return "선택 제품의 MCP 설정 조각만 낸다. 설정 파일은 고치지 않는다";
    case "connection create":
      return "connection을 만든다. 사람이 고른 label·scope만 받는다";
    case "connection revoke":
      return "connection을 회수한다. confirmation window를 쓴다";
    case "connection install":
      return "기존 connection을 선택 target에 설치한다";
    case "session summary":
      return "현재 session의 요약을 읽는다";
    case "session plan":
      return "ticket의 TUI 시작 plan을 stdin으로 만든다";
    default:
      if (name.startsWith("harness ")) {
        return `harness ${name.slice("harness ".length)}를 다룬다`;
      }
      if (name.startsWith("skills ")) {
        return `skill을 ${name.slice("skills ".length)}한다`;
      }
      return `${name}을 다룬다`;
  }
}

function setupRequired(name: string): string[] {
  if (name === "connection show" || name === "connection revoke") {
    return ["connection"];
  }
  if (name === "connection create") return ["label", "scope"];
  if (name === "mcp config") return ["--target", "--scope", "connection"];
  if (name === "session plan") return ["plan_input"];
  if (
    name === "harness plan" || name === "harness install" ||
    name === "harness update" || name === "harness remove"
  ) {
    return ["--target", "components"];
  }
  if (name === "harness install") {
    return ["--target", "components", "operation_id"];
  }
  if (name === "connection install" || name === "skills install") {
    return ["--target"];
  }
  return [];
}

function setupMutates(name: string): boolean {
  return [
    "daemon start",
    "daemon stop",
    "connection create",
    "connection revoke",
    "connection install",
    "harness plan",
    "harness install",
    "harness update",
    "harness remove",
    "skills install",
    "session plan",
  ].includes(name);
}

function setupNext(name: string): string[] {
  if (name === "doctor") return ["daemon status", "connection list"];
  if (name === "daemon status") return ["daemon logs"];
  if (name === "connection list") return ["connection show"];
  if (name === "harness list") return ["harness detect", "harness inspect"];
  if (name === "harness detect") return ["harness inspect", "harness plan"];
  if (name === "harness plan") return ["harness install"];
  if (name === "skills list") return ["skills install"];
  if (name === "session summary") return ["session plan"];
  return [];
}

const CLI_HELP: readonly CommandHelp[] = [
  ...CORE_HELP,
  ...DECISION_HELP,
  ...SETUP_HELP,
];

export function commandHelp(command: string): CommandHelp | undefined {
  return CLI_HELP.find((entry) => entry.command === command);
}

export const COMMAND_HELP = CLI_HELP;

// help --json의 같은 registry 출력(architecture 5.4, cli#R39).
export function helpJson(command: string | undefined): AgentResult {
  if (command === undefined) {
    return {
      summary: `${CLI_HELP.length}개 command를 지원한다`,
      data: {
        commands: CLI_HELP.map((entry) => ({
          command: entry.command,
          purpose: entry.purpose,
          mutate: entry.mutate,
          human_only: entry.humanOnly,
          confirmation: entry.confirmation,
        })),
      },
      next: ["help <command>"],
    };
  }
  const entry = commandHelp(command);
  if (entry === undefined) {
    return {
      summary: `지원하지 않는 command다: ${command}`,
      data: { commands: CLI_HELP.map((item) => item.command) },
      next: ["help"],
    };
  }
  return {
    summary: entry.purpose,
    data: {
      command: entry.command,
      required: entry.required,
      optional: entry.optional,
      json_example: entry.jsonExample,
      mutate: entry.mutate,
      human_only: entry.humanOnly,
      confirmation: entry.confirmation,
      next: entry.next,
    },
    next: entry.next,
  };
}

// 사람 help text. `lophn help [group [command]]`의 결과다.
export function helpText(
  command: string | undefined,
): AgentResult {
  if (command === undefined) {
    const lines = CLI_HELP.map((entry) =>
      `  ${entry.command}${entry.humanOnly ? " (사람 전용)" : ""}${
        entry.mutate ? " (변경)" : ""
      } — ${entry.purpose}`
    );
    return {
      summary: `lophn <group> <command> — ${CLI_HELP.length}개 command`,
      data: { commands: lines.join("\n") },
      next: ["help <command>"],
    };
  }
  const entry = commandHelp(command);
  if (entry === undefined) {
    return helpJson(command);
  }
  const marks = [
    entry.mutate ? "변경" : "읽기",
    entry.humanOnly ? "사람 전용" : undefined,
    entry.confirmation ? "confirmation window 필요" : undefined,
  ].filter((item) => item !== undefined).join(", ");
  return {
    summary: `${entry.command} — ${entry.purpose}`,
    data: {
      command: entry.command,
      marks,
      required: entry.required.join(", ") || "(없음)",
      optional: entry.optional.join(", "),
      json_example: JSON.stringify(entry.jsonExample),
      next: entry.next.join(", "),
    },
    next: entry.next,
  };
}

export { CLI_CORE_NAMES, CLI_DECISION_NAMES, CLI_SETUP_NAMES };
