"""사용: python3 -I prompt.py <계획> <id> <branch> [note]
worker 지시문을 영어로 찍는다(AGENTS.md: worker와는 영어로만 말한다). 그대로 Agent prompt로 쓴다. main checkout의 것을 돌린다.
note는 이 task에만 해당하는 "알아 둘 것"이다."""
import os, subprocess, sys
if len(sys.argv) < 4:
    print(__doc__); sys.exit(0)
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), *[os.pardir] * 4))
# task worktree는 main checkout의 .claude/worktrees/ 아래에 있다(lead worktree 안이 아니다).
MAIN = os.path.dirname(subprocess.run(["git", "-C", ROOT, "rev-parse", "--path-format=absolute", "--git-common-dir"], capture_output=True, text=True).stdout.strip())
plan, tid, branch = sys.argv[1], sys.argv[2], sys.argv[3]
note = sys.argv[4] if len(sys.argv) > 4 else "none"
if not os.path.exists(os.path.join(ROOT, "project-docs/plan", plan, "tasks", f"{tid}.md")):
    sys.exit(f"brief 없음: project-docs/plan/{plan}/tasks/{tid}.md")
print(f"""Do the lophn task `{tid}`.

- Work location: {MAIN}/.claude/worktrees/{tid} (branch {branch}). Do not edit any file outside this worktree.
- Read first:
  1. AGENTS.md in the work location (especially "속도": this is a prototype; simplest implementation, no speculative generalization or defensive code).
  2. {ROOT}/project-docs/plan/{plan}/tasks/{tid}.md — the brief for this task (Korean). Items marked "(lead가 더함)" at the end are also part of the work.
  3. The files listed under the brief's "읽을 것".
- You may edit only the paths under the brief's "소유". "추가 소유" lines were approved by the lead; edit only the range they name. If changing your module's internal shape breaks compilation of someone else's file, adjust only that line minimally and list it under "넘길 줄" in your report. If you need any other path, do not edit it; report it.
- Do not change fixed contracts named in the brief's "계약" (protocol, ports, shell IPC, preload). If one must change, write a change request in your report. If a contract name in the brief differs from main, main is right.
- Never read another module's tables with direct SQL to cut an import. If an import cannot be cut, leave it as a named exception in `tools/check-deps.ts` and report it.
- For every name or number you delete, move or change, `grep -rn` and fix comments and error messages that still mention it. When you delete or rename a core route, also grep its method as a string (`grep -rn '"<method>"' packages/shell tools tests`): screens call routes by resource/method strings that type check cannot see. When you rename a field of a protocol input or output, also grep `<field>:` and `.<field>` as strings: command envelope `input` and `link.read`/`call` replies carry no type. When moving or merging a rule, reuse an existing table or rule instead of creating a copy.
- Tests only for what would really hurt if broken (`.claude/skills/write-test`). Do not create new E2E, browser, screenshot, subprocess or server tests (only the `tests/e2e` rows the brief defines are allowed).
- Each Bash call starts fresh (cwd and variables reset). Start every command with `cd {MAIN}/.claude/worktrees/{tid}; ...` or use absolute paths. Never run in the main checkout.
- Verify with `deno task check:full` (it can take several minutes; run it in the background and wait for the notification) and two core boots: `cd {MAIN}/.claude/worktrees/{tid}; project-docs/plan/tools/lead/boot.sh` (it boots core twice on a fresh data root, each ending on its own; expect `boot 1 exit 0` and `boot 2 exit 0`). Do not start core any other way. Never find processes with ps/fuser/ss; never use pkill/killall. Never touch the real `~/.lophn`.
- Put temporary files (mappings, probe output) under `.dev-data/{tid}/` in the worktree. The session scratchpad is shared with other workers running at the same time, so the same file name overwrites theirs.
- If the auto-mode classifier blocks a command, do not work around it with another command. Report what was blocked and do what you can.
- When checks pass, commit on this branch: an English imperative subject line and a body, ending with a `Co-Authored-By:` line with your model name. No requirement ids or task numbers.
- Do not push, merge, rebase, or touch other branches. Do not use `git stash`: the stash stack is shared by every worktree of this repository.
- Start a gallery server only as `timeout 900 python3 -m http.server 0 -d tools/wireframes` (port 0 picks a free port and prints it; it ends by itself). Run any other long-lived process you start (monitors, `tail -f`) under `timeout` too. Stop every process you started before you report.
- Do not commit changes to `packages/shell/main/node_modules` (symlink) or `packages/shell/main/desktop/core/deno.lock` made by the check. Add files by path and look at `git diff --cached --stat` before committing.
- Do not start sub-agents. Do not edit project-docs.
- Never call a real model provider.
- If blocked, do not guess past it; do what you can and report. Do not leave assigned work undone for "lack of time".
- Report in English, short, in the brief's "보고" shape. Never drop the "무겁게 짠 것" (where you built heavier than the simplest implementation) and "알려진 미완 동작" sections.

Notes from the lead: {note}""")
