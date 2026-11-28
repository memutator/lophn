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

export const sourceControlFileSchema = z.strictObject({
  path: z.string().min(1),
  orig_path: z.string().min(1).optional(),
  index_status: z.string().length(1),
  worktree_status: z.string().length(1),
  staged: z.boolean(),
  unstaged: z.boolean(),
  untracked: z.boolean(),
  conflicted: z.boolean(),
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
    files: z.array(sourceControlFileSchema),
    can_write: z.boolean(),
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
    context_lines: z.number().int().min(0).max(100).optional(),
  }),
  output: z.strictObject({
    diff: z.string(),
    truncated: z.boolean(),
    binary: z.boolean(),
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
    amend: z.boolean().optional(),
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

export const SOURCE_CONTROL_READ_ROUTES = [
  sourceControlStatus,
  sourceControlDiff,
  sourceControlLog,
  sourceControlShow,
  sourceControlBranches,
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
] as const;

export const SOURCE_CONTROL_ROUTES = [
  ...SOURCE_CONTROL_READ_ROUTES,
  ...SOURCE_CONTROL_MEMORY_ROUTES,
] as const;
