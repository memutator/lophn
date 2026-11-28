import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory, defineRead } from "../base/route.ts";

// 소스 컨트롤(오른쪽 사이드바 화면용 바탕)의 core route 계약이다.
// 대상은 project의 git 등록 폴더 또는 worktree다. 쓰기 route는 사람 자격만 받는다(agent는 터미널 git을 쓴다).
// 불변식(spec 3.4.2): 충돌 상태 커밋 거부, 도는 turn이나 쓰기가 있으면 switch 거부, pull은 --ff-only, force push 없음.

export const sourceControlTargetSchema = z.strictObject({
  project: idSchema("prj"),
  worktree: idSchema("wkt").optional(),
  folder: z.string().min(1).max(4096).optional(),
});
export type SourceControlTarget = z.infer<typeof sourceControlTargetSchema>;

export const lineStatSchema = z.strictObject({
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

export const SOURCE_CONTROL_OPERATIONS = [
  "merge",
  "rebase",
  "cherry_pick",
  "revert",
] as const;
export const sourceControlOperationSchema = z.enum(SOURCE_CONTROL_OPERATIONS);
export type SourceControlOperation = z.infer<
  typeof sourceControlOperationSchema
>;

// 실패의 `details.reason`(spec 5.5). 화면이 reason마다 복구 안내를 보인다. `details.stderr`는 자격증명을 가린 git 출력(16 KiB 상한)이다.
export const SOURCE_CONTROL_FAILURES = [
  "auth_failed",
  "host_key_unverified",
  "non_fast_forward",
  "push_rejected",
  "remote_unreachable",
  "no_remote",
  "no_upstream",
  "diverged",
  "merge_conflict",
  "dirty_worktree",
  "active_agent",
  "hook_failed",
  "gpg_failed",
  "timeout",
  "git_error",
  "unresolved_conflicts",
  "conflict_markers",
  "nothing_staged",
  "nested_repository",
  "operation_in_progress",
  "no_operation",
  "unmerged",
  "branch_checked_out",
  "branch_exists",
  "not_git_repository",
  "no_model",
  "cancelled",
  "write_in_progress",
] as const;
export type SourceControlFailure = (typeof SOURCE_CONTROL_FAILURES)[number];

export const sourceControlFileSchema = z.strictObject({
  path: z.string().min(1),
  orig_path: z.string().min(1).optional(),
  index_status: z.string().length(1),
  worktree_status: z.string().length(1),
  staged: z.boolean(),
  unstaged: z.boolean(),
  untracked: z.boolean(),
  conflicted: z.boolean(),
  // 줄 증감. 바이너리·untracked는 null이다. Staged 묶음은 staged_stat, Changes 묶음은 unstaged_stat을 보인다.
  staged_stat: lineStatSchema.nullable().optional(),
  unstaged_stat: lineStatSchema.nullable().optional(),
});
export type SourceControlFile = z.infer<typeof sourceControlFileSchema>;

export const sourceControlCommitSchema = z.strictObject({
  sha: z.string().min(1),
  short_sha: z.string().min(1),
  parents: z.array(z.string().min(1)),
  author_name: z.string(),
  author_email: z.string(),
  authored_at: z.string(),
  subject: z.string(),
  refs: z.array(z.string()),
});
export type SourceControlCommit = z.infer<typeof sourceControlCommitSchema>;

export const sourceControlBranchSchema = z.strictObject({
  name: z.string().min(1),
  current: z.boolean(),
  remote: z.boolean(),
  upstream: z.string().nullable(),
  head_sha: z.string().nullable(),
  ahead: z.number().int().nonnegative().nullable(),
  behind: z.number().int().nonnegative().nullable(),
  worktree_path: z.string().nullable(),
});
export type SourceControlBranch = z.infer<typeof sourceControlBranchSchema>;

const errors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
] as const;

export const sourceControlStatus = defineRead({
  resource: "source_control",
  method: "status",
  name: "SourceControlStatus",
  input: sourceControlTargetSchema,
  output: z.strictObject({
    cwd: z.string().min(1),
    branch: z.string().nullable(),
    detached: z.boolean(),
    head_sha: z.string().nullable(),
    upstream: z.string().nullable(),
    ahead: z.number().int().nonnegative().nullable(),
    behind: z.number().int().nonnegative().nullable(),
    in_merge: z.boolean(),
    in_rebase: z.boolean(),
    in_cherry_pick: z.boolean(),
    in_revert: z.boolean(),
    // 진행 중 연산(배너 문구). 없으면 null.
    operation: sourceControlOperationSchema.nullable(),
    // 첫 커밋이 없는 저장소.
    unborn: z.boolean(),
    // remote가 하나라도 있는가. 없으면 Push·Pull·Fetch를 끈다.
    has_remote: z.boolean(),
    // 커밋 때 돌 hook 이름(pre-commit, commit-msg 등). 커밋 중 "Running pre-commit…"을 보인다.
    hooks: z.array(z.string().min(1)),
    // 바뀐 파일이 상한(10,000)을 넘어 앞부분만 실었다.
    truncated: z.boolean(),
    files: z.array(sourceControlFileSchema),
    can_write: z.boolean(),
    // AI 커밋 메시지를 쓸 수 있는가. 못 쓰면 이유(툴팁).
    suggest: z.strictObject({
      available: z.boolean(),
      reason: z.string().nullable(),
    }),
  }),
  actors: ["user", "agent"],
  errors,
});

export const sourceControlDiff = defineRead({
  resource: "source_control",
  method: "diff",
  name: "SourceControlDiff",
  input: sourceControlTargetSchema.extend({
    path: z.string().min(1).max(4096).optional(),
    staged: z.boolean().optional(),
    // 이 커밋이 parent에서 바꾼 것(`parent..commit`). 주면 staged는 보지 않는다.
    commit: z.string().trim().min(4).max(128).optional(),
    ignore_whitespace: z.boolean().optional(),
    context_lines: z.number().int().min(0).max(100).optional(),
  }),
  output: z.strictObject({
    diff: z.string(),
    truncated: z.boolean(),
    binary: z.boolean(),
    // untracked 파일이라 빈 tree 대비 추가 diff로 만들었다.
    untracked: z.boolean(),
  }),
  actors: ["user", "agent"],
  errors,
});

export const sourceControlStage = defineMemory({
  resource: "source_control",
  method: "stage",
  name: "SourceControlStage",
  changes: [],
  input: sourceControlTargetSchema
    .extend({
      paths: z.array(z.string().min(1).max(4096)).max(1000).optional(),
      all: z.boolean().optional(),
    })
    .refine(
      (value) =>
        value.all === true ||
        (value.paths !== undefined && value.paths.length > 0),
      { message: "specify paths or all: true" },
    ),
  output: z.strictObject({
    staged: z.number().int().nonnegative(),
  }),
  actors: ["user"],
  errors,
});

export const sourceControlUnstage = defineMemory({
  resource: "source_control",
  method: "unstage",
  name: "SourceControlUnstage",
  changes: [],
  input: sourceControlTargetSchema
    .extend({
      paths: z.array(z.string().min(1).max(4096)).max(1000).optional(),
      all: z.boolean().optional(),
    })
    .refine(
      (value) =>
        value.all === true ||
        (value.paths !== undefined && value.paths.length > 0),
      { message: "specify paths or all: true" },
    ),
  output: z.strictObject({
    unstaged: z.number().int().nonnegative(),
  }),
  actors: ["user"],
  errors,
});

export const sourceControlDiscard = defineMemory({
  resource: "source_control",
  method: "discard",
  name: "SourceControlDiscard",
  changes: [],
  input: sourceControlTargetSchema
    .extend({
      paths: z.array(z.string().min(1).max(4096)).max(1000).optional(),
      all: z.boolean().optional(),
      include_untracked: z.boolean().optional(),
    })
    .refine(
      (value) =>
        value.all === true ||
        (value.paths !== undefined && value.paths.length > 0),
      { message: "specify paths or all: true" },
    ),
  output: z.strictObject({
    discarded: z.number().int().nonnegative(),
  }),
  actors: ["user"],
  errors,
});

export const sourceControlCommit = defineMemory({
  resource: "source_control",
  method: "commit",
  name: "SourceControlCommit",
  changes: [],
  input: sourceControlTargetSchema.extend({
    message: z.string().trim().min(1).max(65_536),
  }),
  output: z.strictObject({
    sha: z.string().min(1),
    branch: z.string().nullable(),
    summary: z.string(),
  }),
  actors: ["user"],
  errors,
});

export const sourceControlLog = defineRead({
  resource: "source_control",
  method: "log",
  name: "SourceControlLog",
  input: sourceControlTargetSchema.extend({
    limit: z.number().int().min(1).max(200).optional(),
    skip: z.number().int().min(0).max(10_000).optional(),
    ref: z.string().trim().min(1).max(200).optional(),
    path: z.string().min(1).max(4096).optional(),
  }),
  output: z.strictObject({
    commits: z.array(sourceControlCommitSchema),
  }),
  actors: ["user", "agent"],
  errors,
});

export const sourceControlShow = defineRead({
  resource: "source_control",
  method: "show",
  name: "SourceControlShow",
  input: sourceControlTargetSchema.extend({
    sha: z.string().trim().min(4).max(128),
  }),
  output: z.strictObject({
    commit: sourceControlCommitSchema.extend({ body: z.string() }),
    files: z.array(
      z.strictObject({
        path: z.string().min(1),
        status: z.string().min(1),
        additions: z.number().int().nonnegative().nullable(),
        deletions: z.number().int().nonnegative().nullable(),
      }),
    ),
    diff: z.string(),
    truncated: z.boolean(),
  }),
  actors: ["user", "agent"],
  errors,
});

export const sourceControlBranches = defineRead({
  resource: "source_control",
  method: "branches",
  name: "SourceControlBranches",
  input: sourceControlTargetSchema.extend({
    include_remote: z.boolean().optional(),
  }),
  output: z.strictObject({
    current: z.string().nullable(),
    detached: z.boolean(),
    branches: z.array(sourceControlBranchSchema),
  }),
  actors: ["user", "agent"],
  errors,
});

export const sourceControlBranchCreate = defineMemory({
  resource: "source_control",
  method: "branch_create",
  name: "SourceControlBranchCreate",
  changes: [],
  input: sourceControlTargetSchema.extend({
    name: z.string().trim().min(1).max(200),
    start_point: z.string().trim().min(1).max(200).optional(),
    checkout: z.boolean().optional(),
  }),
  output: z.strictObject({
    name: z.string().min(1),
    checked_out: z.boolean(),
    head_sha: z.string().min(1),
  }),
  actors: ["user"],
  errors,
});

export const sourceControlSwitch = defineMemory({
  resource: "source_control",
  method: "switch",
  name: "SourceControlSwitch",
  changes: [],
  input: sourceControlTargetSchema.extend({
    branch: z.string().trim().min(1).max(200),
  }),
  output: z.strictObject({
    branch: z.string().min(1),
    head_sha: z.string().min(1),
  }),
  actors: ["user"],
  errors,
});

export const sourceControlPush = defineMemory({
  resource: "source_control",
  method: "push",
  name: "SourceControlPush",
  changes: [],
  input: sourceControlTargetSchema.extend({
    remote: z.string().trim().min(1).max(200).optional(),
    branch: z.string().trim().min(1).max(200).optional(),
    set_upstream: z.boolean().optional(),
  }),
  output: z.strictObject({
    remote: z.string().min(1),
    branch: z.string().min(1),
    summary: z.string(),
  }),
  actors: ["user"],
  errors,
});

export const sourceControlPull = defineMemory({
  resource: "source_control",
  method: "pull",
  name: "SourceControlPull",
  changes: [],
  input: sourceControlTargetSchema.extend({
    remote: z.string().trim().min(1).max(200).optional(),
    branch: z.string().trim().min(1).max(200).optional(),
  }),
  output: z.strictObject({
    remote: z.string().nullable(),
    branch: z.string().nullable(),
    head_sha: z.string().min(1),
    updated: z.boolean(),
    summary: z.string(),
  }),
  actors: ["user"],
  errors,
});

export const sourceControlFetch = defineMemory({
  resource: "source_control",
  method: "fetch",
  name: "SourceControlFetch",
  changes: [],
  input: sourceControlTargetSchema.extend({
    remote: z.string().trim().min(1).max(200).optional(),
  }),
  output: z.strictObject({
    remote: z.string().nullable(),
    summary: z.string(),
  }),
  actors: ["user"],
  errors,
});

// 진행 중 merge·rebase·cherry-pick·revert를 그만둔다(`--abort`).
export const sourceControlAbort = defineMemory({
  resource: "source_control",
  method: "abort",
  name: "SourceControlAbort",
  changes: [],
  input: sourceControlTargetSchema,
  output: z.strictObject({
    operation: sourceControlOperationSchema,
  }),
  actors: ["user"],
  errors,
});

// 충돌 파일을 해결한 것으로 표시한다(`git add -- <path>`). 충돌 마커가 남은 파일은 거절한다.
// `keep: "deletion"`은 삭제 충돌에서 지운 쪽을 고른다(`git rm`).
export const sourceControlMarkResolved = defineMemory({
  resource: "source_control",
  method: "mark_resolved",
  name: "SourceControlMarkResolved",
  changes: [],
  input: sourceControlTargetSchema.extend({
    paths: z.array(z.string().min(1).max(4096)).min(1).max(1000),
    keep: z.enum(["file", "deletion"]).optional(),
  }),
  output: z.strictObject({
    resolved: z.number().int().nonnegative(),
  }),
  actors: ["user"],
  errors,
});

export const sourceControlBranchRename = defineMemory({
  resource: "source_control",
  method: "branch_rename",
  name: "SourceControlBranchRename",
  changes: [],
  input: sourceControlTargetSchema.extend({
    from: z.string().trim().min(1).max(200),
    to: z.string().trim().min(1).max(200),
  }),
  output: z.strictObject({
    name: z.string().min(1),
  }),
  actors: ["user"],
  errors,
});

// 로컬 브랜치를 지운다. `git branch -d`만 쓴다: 병합되지 않았으면 지우지 않고 conflict(`unmerged`)다.
export const sourceControlBranchDelete = defineMemory({
  resource: "source_control",
  method: "branch_delete",
  name: "SourceControlBranchDelete",
  changes: [],
  input: sourceControlTargetSchema.extend({
    name: z.string().trim().min(1).max(200),
  }),
  output: z.strictObject({
    deleted: z.literal(true),
  }),
  actors: ["user"],
  errors,
});

// Explorer의 `.gitignore` 흐림. 경로는 체크아웃 기준 상대 경로다.
export const sourceControlIgnored = defineRead({
  resource: "source_control",
  method: "ignored",
  name: "SourceControlIgnored",
  input: sourceControlTargetSchema.extend({
    paths: z.array(z.string().min(1).max(4096)).max(2000),
  }),
  output: z.strictObject({
    ignored: z.array(z.string().min(1)),
  }),
  actors: ["user", "agent"],
  errors,
});

// 이미지 diff의 앞뒤 그림. `rev`는 `HEAD`, `index`(stage된 것), `worktree`(디스크), 또는 커밋 sha다.
export const sourceControlFileAt = defineRead({
  resource: "source_control",
  method: "file_at",
  name: "SourceControlFileAt",
  input: sourceControlTargetSchema.extend({
    path: z.string().min(1).max(4096),
    rev: z.string().trim().min(1).max(128),
  }),
  output: z.strictObject({
    // 없으면(그 판에 파일이 없다) null.
    base64: z.string().nullable(),
    size: z.number().int().nonnegative(),
    too_large: z.boolean(),
  }),
  actors: ["user", "agent"],
  errors,
});

// AI 커밋 메시지(정한 것 14). staged diff를 lophn agent의 기본 model 한 번 호출로 요약해 글만 돌려준다. 커밋하지 않는다.
// `request`는 화면이 지은 id이고 같은 id로 `suggest_cancel`을 부르면 그만둔다(conflict `cancelled`).
export const sourceControlSuggestMessage = defineMemory({
  resource: "source_control",
  method: "suggest_message",
  name: "SourceControlSuggestMessage",
  changes: [],
  input: sourceControlTargetSchema.extend({
    request: z.string().min(1).max(120),
  }),
  output: z.strictObject({
    message: z.string().min(1),
  }),
  actors: ["user"],
  errors,
});

export const sourceControlSuggestCancel = defineMemory({
  resource: "source_control",
  method: "suggest_cancel",
  name: "SourceControlSuggestCancel",
  changes: [],
  input: z.strictObject({
    request: z.string().min(1).max(120),
  }),
  output: z.strictObject({
    cancelled: z.boolean(),
  }),
  actors: ["user"],
  errors,
});

export const commitMessageRequestSchema = z.strictObject({
  request: z.string().min(1).max(120),
  // model에 보낼 재료: staged diff(파일별로 나눠 자른 것)와 최근 커밋 제목.
  diff: z.string(),
  files: z.array(z.string()),
  recent_subjects: z.array(z.string()),
});
export type CommitMessageRequest = z.infer<typeof commitMessageRequestSchema>;

// core에는 외부 fetch가 없다. agent-runtime이 요청을 하나씩 가져가 model을 부르고 `message_request_done`으로 돌려준다.
export const sourceControlMessageRequestTake = defineMemory({
  resource: "source_control",
  method: "message_request_take",
  name: "TakeCommitMessageRequest",
  input: z.strictObject({}),
  output: z.object({
    request: commitMessageRequestSchema.nullable(),
  }),
  actors: ["machine"],
  errors: ["unauthorized", "forbidden", "unavailable"],
});

export const sourceControlMessageRequestDone = defineMemory({
  resource: "source_control",
  method: "message_request_done",
  name: "FinishCommitMessageRequest",
  input: z.strictObject({
    request: z.string().min(1).max(120),
    message: z.string().min(1).max(65_536).nullable(),
    error: z.string().max(2000).nullable(),
  }),
  output: z.object({ accepted: z.boolean() }),
  actors: ["machine"],
  errors: ["unauthorized", "forbidden", "invalid_input"],
});

export const SOURCE_CONTROL_READ_ROUTES = [
  sourceControlStatus,
  sourceControlDiff,
  sourceControlLog,
  sourceControlShow,
  sourceControlBranches,
  sourceControlIgnored,
  sourceControlFileAt,
] as const;

export const SOURCE_CONTROL_MEMORY_ROUTES = [
  sourceControlStage,
  sourceControlUnstage,
  sourceControlDiscard,
  sourceControlCommit,
  sourceControlBranchCreate,
  sourceControlSwitch,
  sourceControlPush,
  sourceControlPull,
  sourceControlFetch,
  sourceControlAbort,
  sourceControlMarkResolved,
  sourceControlBranchRename,
  sourceControlBranchDelete,
  sourceControlSuggestMessage,
  sourceControlSuggestCancel,
] as const;

// agent-runtime(machine) 전용. 기기 route 목록에 넣지 않는다.
export const SOURCE_CONTROL_RUNTIME_ROUTES = [
  sourceControlMessageRequestTake,
  sourceControlMessageRequestDone,
] as const;

export const SOURCE_CONTROL_ROUTES = [
  ...SOURCE_CONTROL_READ_ROUTES,
  ...SOURCE_CONTROL_MEMORY_ROUTES,
  ...SOURCE_CONTROL_RUNTIME_ROUTES,
] as const;
