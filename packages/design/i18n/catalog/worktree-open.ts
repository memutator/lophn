// 세션·터미널을 열 때 worktree 고르기(+ 메뉴, 왼쪽 sidebar +, Ctrl+K), 탭 menu, Project settings › Worktrees, 단축키 이름.
export const worktreeOpen = {
  "worktree-open.button.add-pattern": "Add",
  "worktree-open.button.detect-include": "Detect from repository",
  "worktree-open.button.import-pattern": "Add",
  "worktree-open.button.new-worktree": "New worktree…",
  "worktree-open.button.pattern-added": "Added",
  "worktree-open.button.remove-pattern": "Remove {pattern}",
  "worktree-open.button.save": "Save",
  "worktree-open.button.saving": "Saving…",
  "worktree-open.button.show-in-source-control": "Show in Source Control",
  "worktree-open.heading.key-section-source-control": "Source Control",
  "worktree-open.empty.copy-patterns":
    "No files are copied into new worktrees.",
  "worktree-open.empty.detect-include":
    "No .worktreeinclude file found in this project's folders.",
  "worktree-open.error.settings-load":
    "Couldn't read worktree settings: {message}",
  "worktree-open.heading.open-in": "Open in",
  "worktree-open.heading.worktrees": "Worktrees",
  "worktree-open.label.choice-changed":
    "{branch} · {count, plural, one {# change} other {# changes}}",
  "worktree-open.label.copy-patterns": "Copy into new worktrees",
  "worktree-open.label.key-diff-next-change": "Next change in diff",
  "worktree-open.label.key-diff-prev-change": "Previous change in diff",
  "worktree-open.label.key-source-control-commit": "Commit",
  "worktree-open.label.key-source-control-focus": "Show Source Control",
  "worktree-open.label.key-worktree-new": "New worktree…",
  "worktree-open.label.main": "Main ({branch})",
  "worktree-open.label.main-plain": "Main",
  "worktree-open.label.new-pattern": "New copy pattern",
  "worktree-open.label.no-command": "None",
  "worktree-open.label.run-setup": "Run setup when a worktree is created",
  "worktree-open.label.setup-command": "Setup command",
  "worktree-open.label.teardown-command": "Teardown command",
  "worktree-open.note.copy-patterns":
    "Files git ignores (like .env) that match these patterns are copied from the original folder. Existing files are never overwritten.",
  "worktree-open.note.key-diff-next-change":
    "In a diff tab, jumps to the next changed block.",
  "worktree-open.note.key-diff-prev-change":
    "In a diff tab, jumps to the previous changed block.",
  "worktree-open.note.key-source-control-commit":
    "In the commit message box, commits the staged changes.",
  "worktree-open.note.key-source-control-focus":
    "Opens the Source Control panel in the right sidebar.",
  "worktree-open.note.setup-teardown":
    "Setup runs in the new worktree after it's ready; if it fails, the worktree stays. Teardown runs before removal; if it fails, removal stops.",
  "worktree-open.note.key-worktree-new":
    "Creates a git worktree in this project so a session can work on its own branch.",
  "worktree-open.notice.saved": "Saved",
  "worktree-open.notice.worktrees-lead":
    "How lophn prepares each new git worktree of this project. These settings stay in lophn, not in your repository.",
  "settings.projects-worktrees_folder.name": "Worktrees folder",
  "settings.projects-worktrees_folder.help":
    "Where lophn creates git worktrees on this computer. Leave empty to use the worktrees folder in lophn's data folder. Your home folder, a drive root and folders inside a repository aren't allowed. Existing worktrees stay where they are.",
} as const;
