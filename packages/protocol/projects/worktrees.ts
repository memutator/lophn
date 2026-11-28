import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineMemory, defineRead } from "../base/route.ts";
import { atSchema } from "../base/values.ts";
import { projectCommandIdSchema, runStatusSchema } from "./project-commands.ts";

// git worktree의 계약이다.
// WorktreeRecord는 core의 ledger(`project_worktrees`)가 소유하며 기계 사이에 동기화하지 않는다.
// desk와는 묶지 않는다(`desk_key`를 두지 않는다).

export const WORKTREE_PROVENANCES = ["managed", "adopted"] as const;
export const worktreeProvenanceSchema = z.enum(WORKTREE_PROVENANCES);
export type WorktreeProvenance = z.infer<typeof worktreeProvenanceSchema>;

export const WORKTREE_STATUSES = [
  "creating",
  "ready",
  "missing",
  "removing",
  "removed",
] as const;
export const worktreeStatusSchema = z.enum(WORKTREE_STATUSES);
export type WorktreeStatus = z.infer<typeof worktreeStatusSchema>;

export const WORKTREE_PRESENCES = ["present", "missing", "unmounted"] as const;
export const worktreePresenceSchema = z.enum(WORKTREE_PRESENCES);
export type WorktreePresence = z.infer<typeof worktreePresenceSchema>;

export const WORKTREE_CREATE_MODES = ["new_branch", "existing_branch"] as const;
export const worktreeCreateModeSchema = z.enum(WORKTREE_CREATE_MODES);
export type WorktreeCreateMode = z.infer<typeof worktreeCreateModeSchema>;

export const WORKTREE_HARD_BLOCKS = [
  "unsafe_path",
  "nested_worktree",
  "worktree_locked",
] as const;
export const worktreeHardBlockSchema = z.enum(WORKTREE_HARD_BLOCKS);
export type WorktreeHardBlock = z.infer<typeof worktreeHardBlockSchema>;

export const worktreeLabelSchema = z.string().trim().min(1).max(80);
export const worktreeCopyPatternSchema = z.string().trim().min(1).max(512);

export const worktreeRecordSchema = z.strictObject({
  id: idSchema("wkt"),
  project_id: idSchema("prj"),
  repo_root: z.string().min(1),
  git_common_dir: z.string().min(1),
  path: z.string().min(1),
  git_admin_name: z.string().min(1).nullable(),
  label: worktreeLabelSchema,
  branch: z.string().min(1).nullable(),
  base_ref: z.string().min(1).nullable(),
  base_commit: z.string().min(1).nullable(),
  provenance: worktreeProvenanceSchema,
  status: worktreeStatusSchema,
  created_at: atSchema,
  updated_at: atSchema,
});
export type WorktreeRecord = z.infer<typeof worktreeRecordSchema>;

export const worktreeGitStatusSchema = z.strictObject({
  worktree_id: idSchema("wkt"),
  presence: worktreePresenceSchema,
  branch: z.string().min(1).nullable(),
  detached: z.boolean(),
  head_sha: z.string().min(1).nullable(),
  dirty: z.boolean(),
  staged_count: z.number().int().nonnegative(),
  unstaged_count: z.number().int().nonnegative(),
  untracked_count: z.number().int().nonnegative(),
  conflicted_count: z.number().int().nonnegative(),
  ahead: z.number().int().nonnegative().nullable(),
  behind: z.number().int().nonnegative().nullable(),
  updated_at: atSchema,
});
export type WorktreeGitStatus = z.infer<typeof worktreeGitStatusSchema>;

export const worktreeSetupRunSchema = z.strictObject({
  command_id: projectCommandIdSchema,
  run_id: idSchema("pcr").nullable(),
  status: runStatusSchema,
  exit_code: z.number().int().nullable(),
  tail: z.string().optional(),
  error: z.string().nullable().optional(),
});
export type WorktreeSetupRun = z.infer<typeof worktreeSetupRunSchema>;

export const worktreeExternalSchema = z.strictObject({
  path: z.string().min(1),
  repo_root: z.string().min(1),
  git_common_dir: z.string().min(1),
  git_admin_name: z.string().min(1).nullable(),
  branch: z.string().min(1).nullable(),
  head_sha: z.string().min(1).nullable(),
  locked: z.boolean(),
});
export type WorktreeExternal = z.infer<typeof worktreeExternalSchema>;

export const worktreeSettingsSchema = z.strictObject({
  copy_patterns: z.array(worktreeCopyPatternSchema).max(200),
  setup_command: projectCommandIdSchema.nullable(),
  teardown_command: projectCommandIdSchema.nullable(),
  run_setup: z.boolean(),
});
export type WorktreeSettings = z.infer<typeof worktreeSettingsSchema>;

export const DEFAULT_WORKTREE_SETTINGS: WorktreeSettings = {
  copy_patterns: [],
  setup_command: null,
  teardown_command: null,
  run_setup: true,
};

export const worktreeRemovePreflightSchema = z.strictObject({
  worktree_id: idSchema("wkt"),
  provenance: worktreeProvenanceSchema,
  path: z.string().min(1),
  branch: z.string().min(1).nullable(),
  can_remove: z.boolean(),
  requires_force: z.boolean(),
  requires_stop_sessions: z.boolean(),
  hard_blocks: z.array(worktreeHardBlockSchema),
  dirty: z.boolean(),
  staged_count: z.number().int().nonnegative(),
  unstaged_count: z.number().int().nonnegative(),
  untracked_count: z.number().int().nonnegative(),
  conflicted_count: z.number().int().nonnegative(),
  has_submodules: z.boolean(),
  locked: z.boolean(),
  nested_worktrees: z.array(idSchema("wkt")),
  active_sessions: z.array(idSchema("ses")),
  active_terminals: z.array(z.string().min(1)),
  ahead: z.number().int().nonnegative().nullable(),
  unpushed_commits: z.number().int().nonnegative().nullable(),
  deletable_branch: z.boolean(),
  teardown_command: projectCommandIdSchema.nullable(),
});
export type WorktreeRemovePreflight = z.infer<
  typeof worktreeRemovePreflightSchema
>;

export const worktreeEntrySchema = z.strictObject({
  record: worktreeRecordSchema,
  status: worktreeGitStatusSchema,
  setup: worktreeSetupRunSchema.nullable().optional(),
});
export type WorktreeEntry = z.infer<typeof worktreeEntrySchema>;

export const worktreeIncludeCandidateSchema = z.strictObject({
  pattern: worktreeCopyPatternSchema,
  source: z.string().min(1).max(120),
  folder: z.string().min(1),
});
export type WorktreeIncludeCandidate = z.infer<
  typeof worktreeIncludeCandidateSchema
>;

const errors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
] as const;

export const worktreesList = defineRead({
  resource: "worktrees",
  method: "list",
  name: "WorktreesList",
  input: z.strictObject({
    project: idSchema("prj"),
    include_external: z.boolean().optional(),
    include_removed: z.boolean().optional(),
  }),
  output: z.strictObject({
    worktrees: z.array(worktreeEntrySchema),
    external: z.array(worktreeExternalSchema).optional(),
    settings: worktreeSettingsSchema,
    can_mutate: z.boolean(),
  }),
  reads: [{ name: "worktrees", id: (input) => input.project }],
  actors: ["user", "agent", "machine"],
  errors,
});

export const worktreesGet = defineRead({
  resource: "worktrees",
  method: "get",
  name: "WorktreesGet",
  input: z.strictObject({
    worktree: idSchema("wkt"),
    include_preflight: z.boolean().optional(),
  }),
  output: z.strictObject({
    record: worktreeRecordSchema,
    status: worktreeGitStatusSchema,
    setup: worktreeSetupRunSchema.nullable().optional(),
    active_sessions_count: z.number().int().nonnegative(),
    active_terminals_count: z.number().int().nonnegative(),
    preflight: worktreeRemovePreflightSchema.optional(),
  }),
  actors: ["user", "agent", "machine"],
  errors,
});

export const worktreesCreate = defineMemory({
  resource: "worktrees",
  method: "create",
  name: "WorktreesCreate",
  changes: [{ name: "worktrees", id: (input) => input.project }],
  input: z.strictObject({
    project: idSchema("prj"),
    mode: worktreeCreateModeSchema.optional(),
    // 등록 폴더가 여럿일 때 어느 폴더(git 저장소)에서 날지 지정한다. 하나뿐이면 생략 가능.
    folder: z.string().min(1).max(4096).optional(),
    branch: z.string().trim().min(1).max(200).optional(),
    base_ref: z.string().trim().min(1).max(200).optional(),
    label: worktreeLabelSchema.optional(),
    fetch_base: z.boolean().optional(),
    idempotency_key: z.string().min(1).max(120).optional(),
    run_setup: z.boolean().optional(),
  }),
  output: z.strictObject({
    record: worktreeRecordSchema,
    status: worktreeGitStatusSchema,
    warnings: z.array(z.string()),
    copied_files: z.number().int().nonnegative(),
    setup: worktreeSetupRunSchema.nullable().optional(),
  }),
  actors: ["user", "agent", "machine"],
  errors,
});

export const worktreesAdopt = defineMemory({
  resource: "worktrees",
  method: "adopt",
  name: "WorktreesAdopt",
  changes: [{ name: "worktrees", id: (input) => input.project }],
  input: z.strictObject({
    project: idSchema("prj"),
    path: z.string().min(1).max(4096),
    label: worktreeLabelSchema.optional(),
  }),
  output: z.strictObject({
    record: worktreeRecordSchema,
    status: worktreeGitStatusSchema,
  }),
  actors: ["user"],
  errors,
});

export const worktreesRename = defineMemory({
  resource: "worktrees",
  method: "rename",
  name: "WorktreesRename",
  changes: ["worktrees"],
  input: z
    .strictObject({
      worktree: idSchema("wkt"),
      label: worktreeLabelSchema.optional(),
      branch: z.string().trim().min(1).max(200).optional(),
      rename_branch: z.boolean().optional(),
    })
    .refine(
      (value) => value.label !== undefined || value.branch !== undefined,
      { message: "specify label or branch" },
    ),
  output: z.strictObject({
    record: worktreeRecordSchema,
    status: worktreeGitStatusSchema,
  }),
  actors: ["user", "agent"],
  errors,
});

export const worktreesRemovePreflight = defineRead({
  resource: "worktrees",
  method: "remove_preflight",
  name: "WorktreesRemovePreflight",
  input: z.strictObject({
    worktree: idSchema("wkt"),
  }),
  output: z.strictObject({
    preflight: worktreeRemovePreflightSchema,
  }),
  actors: ["user", "agent"],
  errors,
});

export const worktreesRemove = defineMemory({
  resource: "worktrees",
  method: "remove",
  name: "WorktreesRemove",
  changes: ["worktrees"],
  input: z.strictObject({
    worktree: idSchema("wkt"),
    force: z.boolean().optional(),
    stop_sessions: z.boolean().optional(),
    delete_branch: z.boolean().optional(),
    force_delete_branch: z.boolean().optional(),
    allow_failed_teardown: z.boolean().optional(),
    tool_call: idSchema("tcl").optional(),
  }),
  output: z.strictObject({
    removed: z.boolean(),
    untrack_only: z.boolean(),
    branch_deleted: z.boolean(),
    preserved_branch: z
      .strictObject({
        name: z.string().min(1),
        head_sha: z.string().min(1).nullable(),
        reason: z.string().min(1),
      })
      .nullable(),
  }),
  actors: ["user", "agent"],
  errors,
});

export const worktreesSettingsGet = defineRead({
  resource: "worktrees",
  method: "settings_get",
  name: "WorktreesSettingsGet",
  input: z.strictObject({
    project: idSchema("prj"),
  }),
  output: z.strictObject({
    settings: worktreeSettingsSchema,
  }),
  reads: [{ name: "worktrees", id: (input) => input.project }],
  actors: ["user", "agent"],
  errors,
});

export const worktreesSettingsSet = defineMemory({
  resource: "worktrees",
  method: "settings_set",
  name: "WorktreesSettingsSet",
  changes: [{ name: "worktrees", id: (input) => input.project }],
  input: z.strictObject({
    project: idSchema("prj"),
    settings: worktreeSettingsSchema,
  }),
  output: z.strictObject({
    settings: worktreeSettingsSchema,
  }),
  actors: ["user"],
  errors,
});

export const worktreesDetectInclude = defineRead({
  resource: "worktrees",
  method: "detect_include",
  name: "WorktreesDetectInclude",
  input: z.strictObject({
    project: idSchema("prj"),
  }),
  output: z.strictObject({
    patterns: z.array(worktreeIncludeCandidateSchema),
  }),
  actors: ["user", "agent"],
  errors,
});

// 모든 active project의 ready worktree 경로. shell main의 파일 adapter가 연결 폴더처럼 읽고 쓰는 범위에 더한다.
// git을 부르지 않는 ledger 읽기다.
export const worktreesRoots = defineRead({
  resource: "worktrees",
  method: "roots",
  name: "WorktreesRoots",
  input: z.strictObject({}),
  output: z.strictObject({
    roots: z.array(
      z.strictObject({
        project: idSchema("prj"),
        worktree: idSchema("wkt"),
        path: z.string().min(1),
      }),
    ),
  }),
  reads: ["worktrees"],
  actors: ["user", "machine"],
  errors,
});

// core 내부 machine 전용 ledger 쓰기 command. main thread가 검증·git 실행 뒤에 원자적으로 기록한다.
export const worktreesStore = defineCommand({
  resource: "worktrees",
  method: "store",
  name: "WorktreesStore",
  changes: [{ name: "worktrees", id: (input) => input.project }],
  input: z.strictObject({
    project: idSchema("prj"),
    upsert: worktreeRecordSchema
      .extend({
        idempotency_key: z.string().min(1).max(120).nullable().optional(),
        created_branch: z.boolean().optional(),
        managed_root: z.string().min(1).nullable().optional(),
      })
      .optional(),
    patch: z
      .strictObject({
        id: idSchema("wkt"),
        path: z.string().min(1).optional(),
        git_admin_name: z.string().min(1).nullable().optional(),
        label: worktreeLabelSchema.optional(),
        branch: z.string().min(1).nullable().optional(),
        status: worktreeStatusSchema.optional(),
        updated_at: atSchema,
      })
      .optional(),
    delete_id: idSchema("wkt").optional(),
    settings: worktreeSettingsSchema.optional(),
  }),
  compare: z.strictObject({}),
  output: z.strictObject({ saved: z.literal(true) }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});

export const WORKTREE_READ_ROUTES = [
  worktreesList,
  worktreesGet,
  worktreesRemovePreflight,
  worktreesSettingsGet,
  worktreesDetectInclude,
  worktreesRoots,
] as const;

export const WORKTREE_MEMORY_ROUTES = [
  worktreesCreate,
  worktreesAdopt,
  worktreesRename,
  worktreesRemove,
  worktreesSettingsSet,
] as const;

export const WORKTREE_ROUTES = [
  ...WORKTREE_READ_ROUTES,
  ...WORKTREE_MEMORY_ROUTES,
  worktreesStore,
] as const;
