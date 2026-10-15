// CLI 도움말. 사람 help와 `help --json`
// 을 같은 command registry에서 만든다. 화면 문구가 아니라 기술 문장이므로
// wording key를 쓰지 않는다(exceptions: shell 화면 전용).
import {
  CLI_CORE_NAMES,
  CLI_DECISION_NAMES,
  CLI_SETUP_NAMES,
  CONFIRMATION_NAMES,
  HUMAN_ONLY_NAMES,
} from "../../protocol/coding-agent/mod.ts";
import type { AgentResult } from "../../protocol/coding-agent/mod.ts";

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
    purpose: "root·place·document·section 목차와 반영 지연을 읽는다",
    required: [],
    optional: [
      "--input",
      "--input-file",
      "--connection",
      "--daemon-url",
      "--app",
      "op",
      "place",
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
    optional: ["--input", "--input-file", "place", "cursor"],
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
    required: ["name", "module_hash", "paths 또는 files 중 하나"],
    optional: ["--input", "--input-file"],
    jsonExample: {
      command: "format validate",
      name: "document",
      module_hash: "<format show의 module_hash>",
      paths: ["/work/docs/plan.md"],
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

// 앱 개발 command다. 접수와 읽기는 변경이 아니다: test·release 준비·
// preview는 요청을 접수할 뿐이고 결과는 다음 조회로 읽는다. 사람 전용은 결정 화면 링크만 낸다.
function appHelp(
  command: string,
  purpose: string,
  required: string[],
  options: {
    optional?: string[];
    mutate?: boolean;
    humanOnly?: boolean;
    next?: string[];
    example?: Record<string, unknown>;
  } = {},
): CommandHelp {
  return {
    command,
    purpose,
    required,
    optional: ["--input", "--input-file", "--app", ...(options.optional ?? [])],
    jsonExample: { command, ...(options.example ?? {}), json: true },
    mutate: options.mutate ?? false,
    humanOnly: options.humanOnly ?? false,
    confirmation: false,
    next: options.next ?? [],
  };
}

const APP_HELP: readonly CommandHelp[] = [
  appHelp("app list", "접수한 앱 목록을 읽는다", [], {
    optional: ["status", "cursor", "limit"],
    next: ["app show"],
  }),
  appHelp(
    "app show",
    "앱 하나의 source·active release 상태를 읽는다",
    ["app"],
    {
      next: ["app status", "app source"],
    },
  ),
  appHelp("app path", "앱의 연결 source 위치만 읽는다", ["app"], {
    next: ["app source"],
  }),
  appHelp(
    "app register",
    "이름·한 줄 목적으로 앱을 가볍게 등록한다. 전체 범위 연결만 된다",
    ["slug", "name", "description"],
    { mutate: true, optional: ["planning_version"], next: ["app source"] },
  ),
  appHelp(
    "app source",
    "구현 시작 source 위치를 앱에 연결한다",
    ["app", "source_path"],
    { mutate: true, next: ["app validate", "app preview start"] },
  ),
  appHelp(
    "app validate",
    "commit의 blueprint 구조를 검사한다. 실제 test result가 아니다",
    ["app", "commit", "request_key"],
    { next: ["app test"] },
  ),
  appHelp(
    "app test",
    "같은 묶음 hash의 실제 app test를 runner에 요청한다. 기본 timeout은 300초다",
    ["kind", "app", "target", "request_key"],
    { optional: ["ticket", "problem"], next: ["app release prepare"] },
  ),
  appHelp(
    "app preview start",
    "fixture 격리 preview를 시작한다. 운영 앱은 그대로다",
    ["input"],
    { next: ["app command", "app preview stop"] },
  ),
  appHelp(
    "app preview stop",
    "preview 하나를 중지한다. 운영 앱은 멈추지 않는다",
    ["app", "process_nonce"],
    { next: ["app status"] },
  ),
  appHelp(
    "app release prepare",
    "ticket·claim_seq와 같은 묶음 hash의 app test 통과로 release를 준비한다. activation은 사람이 고른다",
    ["app", "commit", "request_key", "ticket_source"],
    { next: ["app status"] },
  ),
  appHelp(
    "app status",
    "운영 active release와 preview 상태를 따로 읽는다",
    ["app"],
    { next: ["app invocations", "app logs"] },
  ),
  appHelp("app blueprint", "command 중심 blueprint를 읽는다", ["app"], {
    next: ["app show"],
  }),
  appHelp(
    "app invocations",
    "최대 20개 invocation 이력과 cursor를 읽는다",
    [],
    {
      optional: ["app", "status", "limit", "cursor"],
      next: ["app invocation"],
    },
  ),
  appHelp(
    "app invocation",
    "같은 환경(기본 preview)의 invocation 하나의 실제 상태를 읽는다",
    ["invocation"],
    { optional: ["environment"], next: ["app logs"] },
  ),
  appHelp(
    "app logs",
    "redaction된 앱 log를 한 번에 1~200줄 읽는다",
    ["app"],
    {
      optional: ["invocation", "limit", "max_bytes"],
      next: ["app invocations"],
    },
  ),
  appHelp("app sync-tools", "앱의 개발 도구 안내를 재배포한다", ["app"], {
    next: ["app status"],
  }),
  appHelp(
    "app command",
    "앱 command를 부른다. read 효과·confirm 없는 command만이고 기본 환경은 preview다",
    ["app", "command"],
    {
      optional: ["input", "environment", "timeout_ms"],
      next: ["app invocation"],
    },
  ),
  appHelp(
    "app start",
    "운영 앱 시작은 사람만 한다. 결정 화면 링크만 낸다",
    [],
    { humanOnly: true, next: ["app status"] },
  ),
  appHelp(
    "app stop",
    "운영 앱 중지는 사람만 한다. 결정 화면 링크만 낸다",
    [],
    { humanOnly: true, next: ["app status"] },
  ),
  appHelp(
    "app release activate",
    "release activation은 사람만 고른다. 결정 화면 링크만 낸다",
    [],
    { humanOnly: true, next: ["app status"] },
  ),
  appHelp(
    "app automation run",
    "automation 수동 수행은 사람만 한다. 결정 화면 링크만 낸다",
    [],
    { humanOnly: true, next: ["app status"] },
  ),
];

// SDK command다. add는 `apply`일 때만 앱 source의 deno.json을 바꾼다.
const SDK_HELP: readonly CommandHelp[] = [
  {
    command: "sdk catalog",
    purpose:
      "설치 SDK를 설명·API 이름으로 찾아 이름·최신 version·종류·한 줄 설명을 읽는다. 개인 SDK(@me)는 지원 범위 밖으로 표시한다",
    required: [],
    optional: ["--input", "--input-file", "query", "name", "limit", "cursor"],
    jsonExample: { command: "sdk catalog", query: "table", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["sdk show", "sdk add"],
  },
  {
    command: "sdk show",
    purpose:
      "SDK 하나의 설치 version과 고른 version(기본 최신)의 사용 안내를 읽는다",
    required: ["name"],
    optional: ["--input", "--input-file", "version"],
    jsonExample: { command: "sdk show", name: "@lophn/ui-table", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["sdk add"],
  },
  {
    command: "sdk add",
    purpose:
      "exact version의 고정 import 안내를 낸다. apply면 --app의 source deno.json에 반영하고 changed·unchanged·conflict를 낸다. 범위 version·다른 version으로 바꾸기는 거절한다",
    required: ["name", "version"],
    optional: ["--input", "--input-file", "apply", "app"],
    jsonExample: {
      command: "sdk add",
      name: "@lophn/ui-table",
      version: "1.2.0",
      json: true,
    },
    mutate: true,
    humanOnly: false,
    confirmation: false,
    next: ["app validate"],
  },
];

const TICKET_HELP: readonly CommandHelp[] = [
  {
    command: "ticket list",
    purpose: "앱·상태 filter한 최대 20개 ticket 요약과 cursor를 읽는다",
    required: [],
    optional: ["--input", "--input-file", "app", "state", "limit", "cursor"],
    jsonExample: { command: "ticket list", state: "claimed", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["ticket show", "ticket checks"],
  },
  {
    command: "ticket show",
    purpose:
      "ticket 하나의 조건·근거·볼 곳·지킬 것·현재 claim 전체 본문을 읽는다",
    required: ["ticket"],
    optional: ["--input", "--input-file"],
    jsonExample: { command: "ticket show", ticket: "tkt-x", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["ticket checks", "ticket list"],
  },
  {
    command: "ticket checks",
    purpose: "ticket의 조건별 machine 검사 결과를 읽는다",
    required: ["ticket"],
    optional: ["--input", "--input-file"],
    jsonExample: { command: "ticket checks", ticket: "tkt-x", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["ticket show"],
  },
  {
    // claim은 실행하지 않는다. MCP 연결·지정 ticket 안내로 끝난다.
    command: "ticket claim",
    purpose:
      "ticket claim은 MCP로 수행한다. MCP 연결과 지정 ticket 안내만 낸다",
    required: ["ticket"],
    optional: ["--input", "--input-file"],
    jsonExample: { command: "ticket claim", ticket: "tkt-x", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["ticket show"],
  },
  {
    command: "ticket renew",
    purpose:
      "현재 claim을 명시 갱신한다. 기한은 갱신 시각부터 정확히 1시간이다",
    required: ["ticket", "claim_seq", "base_revision", "connection"],
    optional: ["--input", "--input-file"],
    jsonExample: {
      command: "ticket renew",
      ticket: "tkt-x",
      claim_seq: "8",
      base_revision: "13",
      connection: "cac-x",
      json: true,
    },
    mutate: true,
    humanOnly: false,
    confirmation: false,
    next: ["ticket show"],
  },
  {
    command: "ticket release",
    purpose: "현재 claim을 반납하고 ticket을 open으로 둔다",
    required: ["ticket", "claim_seq", "base_revision"],
    optional: ["--input", "--input-file"],
    jsonExample: {
      command: "ticket release",
      ticket: "tkt-x",
      claim_seq: "8",
      base_revision: "14",
      json: true,
    },
    mutate: true,
    humanOnly: false,
    confirmation: false,
    next: ["ticket show"],
  },
  {
    command: "ticket report",
    purpose:
      "summary를 올려 완료 주장을 접수하고 ticket을 reported로 둔다. 확인됨·문제 닫힘은 아니다",
    required: ["ticket", "claim_seq", "base_revision", "release", "summary"],
    optional: [
      "--input",
      "--input-file",
      "outputs",
      "fix_records",
      "verifications",
    ],
    jsonExample: {
      command: "ticket report",
      ticket: "tkt-x",
      claim_seq: "8",
      base_revision: "15",
      release: "rel-x",
      summary: "변경: ... 수행한 확인: ... 미실행 확인: ... 한계: ...",
      outputs: [],
      fix_records: [],
      verifications: [],
      json: true,
    },
    mutate: true,
    humanOnly: false,
    confirmation: false,
    next: ["ticket checks", "ticket show"],
  },
  {
    command: "ticket create",
    purpose:
      "ticket을 만든다. 사람 전용이고 결정 화면 링크로 넘긴다. 확인 창은 없다",
    required: ["app", "kind", "title", "what", "why", "readiness"],
    optional: [
      "--input",
      "--input-file",
      "references",
      "adoption_questions",
      "conditions",
      "inspect",
      "preserve",
      "problems",
      "needs",
    ],
    jsonExample: {
      command: "ticket create",
      app: "app-x",
      kind: "implementation",
      title: "...",
      what: "...",
      why: "...",
      readiness: "needs_confirmation",
      needs: ["..."],
      json: true,
    },
    mutate: false,
    humanOnly: true,
    confirmation: false,
    next: ["ticket show"],
  },
  {
    command: "ticket cancel",
    purpose:
      "ticket을 취소한다. 사람 전용이고 한 줄 사유와 함께 결정 화면 링크로 넘긴다. 확인 창은 없다",
    required: ["ticket", "base_revision", "reason"],
    optional: ["--input", "--input-file"],
    jsonExample: {
      command: "ticket cancel",
      ticket: "tkt-x",
      base_revision: "15",
      reason: "더 이상 필요 없다",
      json: true,
    },
    mutate: false,
    humanOnly: true,
    confirmation: false,
    next: ["ticket show"],
  },
];

// 문제 command다. 읽기와 접수는 변경이 아니다: record-fix만 고친 기록을 남기고
// test는 실제 runner 요청을 접수할 뿐이다. 사람 전용 네 command는 feedback·수리 요청·확인·무시를
// 접수하지 않고 결정 화면 링크와 대기 사실만 낸다.
function problemHelp(
  command: string,
  purpose: string,
  required: string[],
  options: {
    optional?: string[];
    mutate?: boolean;
    humanOnly?: boolean;
    next?: string[];
    example?: Record<string, unknown>;
  } = {},
): CommandHelp {
  return {
    command,
    purpose,
    required,
    optional: ["--input", "--input-file", ...(options.optional ?? [])],
    jsonExample: { command, ...(options.example ?? {}), json: true },
    mutate: options.mutate ?? false,
    humanOnly: options.humanOnly ?? false,
    confirmation: false,
    next: options.next ?? [],
  };
}

const PROBLEM_HELP: readonly CommandHelp[] = [
  problemHelp(
    "problem list",
    "앱·진행 상태·처리 대상(사람 또는 coding agent)을 고른 문제 요약 목록을 읽는다. claim을 만들지 않는다",
    [],
    {
      optional: ["--app", "status", "handler", "limit", "cursor"],
      next: ["problem show", "problem summary"],
    },
  ),
  problemHelp("problem show", "문제 하나의 상세를 읽는다", ["problem"], {
    next: ["problem summary", "problem fix-records"],
  }),
  problemHelp(
    "problem snapshot",
    "snapshot의 invocation·error·logs·screen 증거를 읽는다",
    ["snapshot"],
    { optional: ["item"], next: ["problem more"] },
  ),
  problemHelp(
    "problem fix-records",
    "문제의 지난 고친 기록을 읽는다. ticket 없는 과거 기록은 조회만 한다",
    ["problem"],
    { optional: ["cursor"], next: ["problem show"] },
  ),
  problemHelp(
    "problem summary",
    "문제 하나 또는 repair ticket의 적은 양 요약(문제당 2줄·전체 10줄·1,200자)을 읽는다",
    ["selector"],
    { optional: ["summary_version"], next: ["problem bundle"] },
  ),
  problemHelp(
    "problem bundle",
    "전체 수리 자료(24,576 bytes·300줄)를 읽는다",
    ["selector"],
    { optional: ["summary_version"], next: ["problem more"] },
  ),
  problemHelp(
    "problem more",
    "log·발생·source diff·화면·이미지 같은 종류별 추가 근거를 cursor로 읽는다",
    ["problem", "kind", "source"],
    { optional: ["cursor"], next: ["problem bundle"] },
  ),
  problemHelp(
    "problem record-fix",
    "지정 ticket의 현재 claim 아래 고친 release와 summary를 기록한다. summary는 먼저 blob으로 저장하고 문제를 닫지 않는다",
    ["problem", "problem_seq", "fix", "summary"],
    {
      optional: ["--idempotency-key"],
      mutate: true,
      next: ["ticket report", "problem fix-records"],
    },
  ),
  problemHelp(
    "problem test",
    "지정 ticket의 현재 claim 아래 reproduction test를 runner에 요청한다. 요청과 실제 결과를 따로 읽는다",
    [
      "ticket_source",
      "request_key",
      "kind",
      "app",
      "target",
      "problem",
      "basis_seq",
      "reports",
      "before",
      "after",
      "test",
    ],
    { optional: ["timeout_ms"], next: ["problem record-fix"] },
  ),
  problemHelp(
    "problem attachment open",
    "허용된 첨부의 안전한 참조·종류·크기를 낸다. 운영 경로는 내지 않는다",
    ["problem", "snapshot"],
    { optional: ["item"], next: ["problem more"] },
  ),
  problemHelp(
    "problem report",
    "문제 알리기는 shell 화면 안내만 낸다. CLI는 feedback을 접수하지 않는다",
    ["symptom"],
    { optional: ["--app"], humanOnly: true, next: ["problem list"] },
  ),
  problemHelp(
    "problem request-repair",
    "수리 요청은 담당 agent의 ticket 준비 화면 링크만 낸다. agent를 띄우지 않는다",
    ["problem"],
    { humanOnly: true, next: ["problem show"] },
  ),
  problemHelp(
    "problem confirm",
    "사람 확인은 결정 화면 링크와 대기 사실만 낸다. 테스트 통과가 아니다",
    ["problem", "evidence"],
    { humanOnly: true, next: ["problem show"] },
  ),
  problemHelp(
    "problem dismiss",
    "무시·false alarm은 결정 화면 링크와 대기 사실만 낸다. 문제를 닫지 않는다",
    ["problem", "reason"],
    { optional: ["false_alarm"], humanOnly: true, next: ["problem show"] },
  ),
];

const DECISION_HELP: readonly CommandHelp[] = [
  {
    command: "question list",
    purpose: "허용된 질문 묶음 목록을 읽는다",
    required: [],
    optional: [
      "--input",
      "--input-file",
      "run",
      "session",
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
    purpose: "질문 묶음 하나의 이유·option·상태를 읽는다",
    required: ["group"],
    optional: ["--input", "--input-file"],
    jsonExample: { command: "question show", group: "qgr-x", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["question open"],
  },
  {
    command: "question open",
    purpose:
      "질문 묶음의 결정 화면 링크와 대기 사실을 낸다. 답을 입력받지 않는다",
    required: ["group"],
    optional: ["--input", "--input-file"],
    jsonExample: { command: "question open", group: "qgr-x", json: true },
    mutate: false,
    humanOnly: false,
    confirmation: false,
    next: ["question show"],
  },
  {
    command: "approval list",
    purpose: "허용된 approval request 목록을 읽는다",
    required: [],
    optional: [
      "--input",
      "--input-file",
      "status",
      "run",
      "grant_session",
      "limit",
    ],
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
  ...APP_HELP,
  ...SDK_HELP,
  ...TICKET_HELP,
  ...PROBLEM_HELP,
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
      return "연결 범위의 열린 문제·ticket·내 claim 요약을 읽는다. --hook --app <앱>은 Claude Code 시작 hook 출력이다";
    case "session plan":
      return "ticket의 TUI 시작 plan을 stdin으로 만든다";
    case "session observe":
      return "제품 hook·plugin·extension payload를 정규화해 관측 socket에만 쓴다";
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
  if (name === "session observe") return ["--hook"];
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

// help --json의 같은 registry 출력(architecture 5.4).
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
