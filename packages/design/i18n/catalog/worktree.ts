// worktree 화면(만들기·지우기·이름 바꾸기 창, Explorer 가지, + 메뉴 고르기, 탭 꼬리표, Project settings › Worktrees).
export const worktree = {
  "worktree.label.branch-tag-dirty": "Uncommitted changes",
  "worktree.title.create": "New worktree",
  "worktree.title.remove": "Remove worktree {name}?",
  "worktree.title.untrack": "Untrack worktree {name}?",
  "worktree.title.rename": "Rename worktree {name}",
  "worktree.button.create": "Create worktree",
  "worktree.button.creating": "Creating…",
  "worktree.button.remove": "Remove",
  "worktree.button.removing": "Removing…",
  "worktree.button.untrack": "Untrack",
  "worktree.button.rename": "Rename",
  "worktree.label.source-folder": "From folder",
  "worktree.label.base-ref": "Base",
  "worktree.note.base-ref":
    "Leave empty to start from the remote default branch (origin/HEAD), or the current branch when there is no remote.",
  "worktree.label.branch": "Branch",
  "worktree.note.branch-auto":
    "Leave empty and lophn picks a new branch name like wt/quiet-river-1a2b.",
  "worktree.note.rename-branch":
    "Changing this renames the branch with git branch -m. The folder stays where it is.",
  "worktree.label.label": "Label",
  "worktree.note.copy-none": "No ignored files are copied into new worktrees.",
  "worktree.note.copy-patterns": "Copies ignored files matching: {patterns}",
  "worktree.note.setup-none": "No setup command runs after creating.",
  "worktree.note.setup": "Runs {command} in the new worktree after creating.",
  "worktree.notice.creating": "Creating the worktree and preparing files…",
  "worktree.notice.created-with-warnings":
    "The worktree was created with these warnings:",
  "worktree.error.failed-reason": "{message} ({reason})",
  "worktree.label.path": "Folder",
  "worktree.label.changes": "Changes",
  "worktree.label.changes-count":
    "{changed, plural, one {# changed file} other {# changed files}}, {untracked} untracked",
  "worktree.label.unpushed": "Unpushed commits",
  "worktree.label.unpushed-unknown": "Unknown (no upstream)",
  "worktree.notice.checking": "Checking the worktree…",
  "worktree.error.locked":
    "This worktree is locked in git. Run git worktree unlock first.",
  "worktree.error.nested":
    "Another worktree is inside this one. Remove that one first.",
  "worktree.error.unsafe-path":
    "lophn can't prove it owns this folder, so it won't delete it.",
  "worktree.notice.submodules":
    "This worktree has submodules. Commits in them that were never pushed are lost.",
  "worktree.notice.unpushed":
    "The branch has commits that aren't on its upstream. The branch is kept unless you delete it.",
  "worktree.label.stop-sessions":
    "Stop the {count, plural, one {session} other {# sessions}} running here",
  "worktree.label.force": "Remove even with uncommitted changes",
  "worktree.label.delete-branch": "Also delete the branch (only if merged)",
  "worktree.notice.branch-preserved":
    "The worktree was removed. Branch {branch} was kept ({reason}).",
  "worktree.notice.untrack":
    "lophn stops tracking this worktree. The folder {path} and its branch stay on disk.",
  "worktree.label.state-missing": "Missing",
  "worktree.label.state-unmounted": "Unmounted",
  "worktree.label.state-creating": "Creating…",
  "worktree.label.state-removing": "Removing…",
  "worktree.button.new-worktree": "New worktree…",
  "worktree.button.new-worktree-from": "New worktree from {name}…",
  "worktree.button.open-agent-here": "Open agent here",
  "worktree.button.open-terminal-here": "Open terminal here",
  "worktree.button.view-in-source-control": "View in Source Control",
  "worktree.button.copy-branch": "Copy branch name",
  "worktree.button.rename-menu": "Rename…",
  "worktree.button.remove-menu": "Remove…",
  "worktree.button.untrack-menu": "Untrack…",
  "worktree.button.open-diff": "Open Diff",
  "worktree.button.discard-changes": "Discard Changes…",
  "worktree.button.discard": "Discard changes",
  "worktree.button.delete-file": "Delete file",
  "worktree.title.discard": "Discard changes in {name}?",
  "worktree.notice.discard-tracked":
    "{name} goes back to its last committed state. Your changes to it are lost.",
  "worktree.notice.discard-untracked":
    "{name} is not tracked by git, so discarding deletes it permanently.",
  "worktree.label.submodules": "Submodules",
  "worktree.label.options": "Options",
  "worktree.label.option-stop-sessions": "Stop sessions running there",
  "worktree.title.approval-remove": "{agent} wants to remove worktree {name}",
  "worktree.title.approval-untrack": "{agent} wants to untrack worktree {name}",
  "worktree.title.waiting-remove": "Remove worktree {name}",
  "worktree.title.waiting-untrack": "Untrack worktree {name}",
  "worktree.notice.waiting-untrack":
    "lophn stops tracking this worktree. Its files and branch stay on disk.",
  "worktree.notice.waiting-remove": "Removes this worktree from disk.",
  "worktree.notice.waiting-remove-dirty":
    "Removes this worktree from disk. It has uncommitted changes.",
} as const;
