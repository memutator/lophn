# multi-machine program: plans, boundaries, decided policies

Written by the planner on 2026-11-16 for the workers who open the plans. The roadmap is `project-docs/products/roadmap/multi-machine.md`; code facts are in `reports/multi-machine/code-survey.md`; the cross-harness survey is `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md`. Where this note and the roadmap differ, this note is newer.

## Plans

| plan | scope | stands on |
|---|---|---|
| `machine-identity` | machine id file, clone detection, computer and phone names, hello with version range and machine id, device kind (phone, desktop). Already opened: `project-docs/plan/machine-identity/` (README "다른 계획이 기대는 계약" is the contract) | nothing |
| `desktop-remote` | the desktop app pairs with another machine's core as a device of kind desktop and shows that machine's lophn; machine switcher; per-viewer default machine | machine-identity |
| `app-folder-sync` | a sync app's changes written to and read from a folder; per-app policy in the declaration; releases, app source (git bundles) and machine records through the folder; engine rules still missing; agent-readable environment and guidance for a folder-moving tool | machine-identity |
| `project-identity` | a file inside the repository carrying a cross-machine project id; two-layer ids; per-machine "not on this machine" state; clone help | machine-identity |
| `always-on` | OS service registration so lophn starts at login and keeps running without a window; optional keep-awake; schedules carry an owning machine | machine-identity |
| `machine-update` | version skew between machines of lophn itself; an app's new release arriving on another machine; data of a newer schema arriving at a machine on an older release | machine-identity, app-folder-sync |

Landing order: `machine-identity` first. Then `desktop-remote`, `app-folder-sync`, `project-identity`, `always-on` in parallel. `machine-update` after `app-folder-sync`.

## Boundaries between plans (who owns what)

- **Device kind, hello, machine record, names**: `machine-identity` only. Other plans read them through its contract and add no field to `machine.json` or the hello frame. If a plan needs a new field there, it says so under "계약 바꾸기 요청" in its README and the planner decides.
- **A desktop as a device**: registering a device of kind `desktop`, the desktop-side device key store, pairing by pasted text on the desktop, the connection in shell main, the renderer working against a remote core: `desktop-remote`. It decides which desktop features are off while viewing another machine (terminals, editor, secret window, host link, anything that needs the local shell host) and shows that plainly.
- **Shared connection code**: today the reusable client pieces (computer store, reconnection, adapters) live in `packages/mobile/src`, outside the root workspace. `desktop-remote` moves what both the phone app and the desktop need into a workspace package and makes the phone app import it from there (the phone already imports workspace code by relative path). No other plan moves that code.
- **The folder**: layout, file format, the per-machine subfolder rule, verify-then-apply, export and import: `app-folder-sync`. Other plans that put things in the folder (`project-identity` does not; `machine-update` reads release markers) use its contract.
- **Machine records through the folder** (id, name, always-on, addresses): `app-folder-sync` writes and reads them. `always-on` sets the always-on value in the local machine state through the place `app-folder-sync` names; if `always-on` lands first the value simply is not published yet.
- **Releases across machines**: `app-folder-sync` carries a release and the app's source to the folder and lets a second machine take the app in (app record, bundle, SDK copies; grants and consents are asked again on that machine, never copied). It applies changes only between machines on the SAME release of an app and leaves changes from another release unapplied without losing them, marked so that `machine-update` can pick them up. `machine-update` owns: following a new release automatically, applying held changes after a release change, the "this app needs an update here" state, lophn version ranges.
- **Agent-readable environment**: the read tool/CLI for "my machines, their state, the folders and last exchange times" and the guidance (a bundled file next to the design-app skill, not in SKILL.md, which is at its 24576-byte limit) are `app-folder-sync`'s. `desktop-remote`, `always-on` and `project-identity` add their facts to that tool only by naming the fields in their README for the planner to hand over; they do not edit the tool themselves unless they land after it.
- **Projects seen across machines**: `project-identity` owns the identity file, the second id, the per-machine state and the clone help. Grouping "the same project on the machine I am viewing" in the desktop's remote view is a last task in `project-identity` that waits for `desktop-remote` to land.
- **Jobs**: `always-on` owns the owning-machine column and the rule that a schedule which arrives on another machine (a cloned data root today; a synced schedule later) is paused. No plan syncs schedules.
- **Settings › Remote in the desktop renderer** is touched by `machine-identity` (This computer), `desktop-remote` (machines I view, pairing by paste), `always-on` (the switch). Each plan keeps its edit to its own section component and says so; the planner orders the lands.
- **Ledger schema steps**: every plan appends its steps at the end of the last wiring's list and of `schema-steps.lock.json` when it lands (AGENTS.md "호환성"); never edits an existing entry. Briefs name their step ids; the planner fixes the order at landing.
- **Docs**: each plan lists the architecture documents its lead writes at the end; nobody edits architecture documents in a task brief except where the brief template allows.

## Policies decided (person delegated on 2026-11-16: "계획 간의 충돌하는 정책 따위는 너가 조율하고 정하고")

Person:
- Viewer aliases stay: the name a machine announces is shown by default, and where the viewer has set an alias the alias is shown instead. Applies to both directions (the phone's name for a computer, the computer's name for a phone) and to a desktop viewing another machine.
- Every machine has its own full lophn; sessions are not moved, they are viewed remotely; where an app's data goes is per app, chosen by the agent; storage connections are not a product feature, an outside tool moves a folder; a project means the same thing on every machine; lophn decides the handling of user data itself even without precedent; calling the Google Drive API from lophn is deferred.

Planner (recommendations taken as decisions; record them in each README's 정한 것 with `(planner)`):
1. The project identity file is created inside the person's repository (git remote is only a hint for matching).
2. lophn writes the file and never commits to the person's repository on its own; the person or an agent commits.
3. A project that is not a git repository does not cross machines.
4. When an agent clones a project that is missing on a machine, the person is asked once for the folder to keep projects in, and it is remembered.
5. With always-on set, lophn keeps running on that machine after its window is closed (the idle exit does not apply there).
6. First version starts at login, not before login.
7. Keep-awake is a separate switch, off by default.
8. A scheduled job runs only on the machine that created it; moving one is an explicit action by the person.
9. An app's new release arriving on another machine is followed automatically where the person already allowed that app on that machine; a release that asks for new permissions is asked again.
10. Data of a newer schema arriving at a machine whose app is on an older release is held, not applied, until that machine's app is on the new release; meanwhile the app shows that it needs an update here.
11. lophn versions that differ between machines keep exchanging while inside the compatible range; outside it the exchange stops and the machine shows that it must be updated.
12. No button updates all machines from one; each machine updates itself.
13. Agent definitions, skills and settings are not synced between machines in these plans.
14. Remote viewing from a desktop has the same rights as the phone (see, talk, answer approvals, use apps); no management of the other machine. First setup of each machine is on its own screen.
15. The phone does not use the folder; it goes through a computer it is paired with.
16. Credentials (provider keys, secrets, git tokens) are never copied or synced between machines. lophn builds no git login; it uses what the machine has (`gh`, credential helper, SSH keys) and fails fast with the command to run.

## Rules every plan carries (from the survey; the roadmap lists them)

The machine id never leaves the machine in a backup, export or the folder; state tied to one machine records that machine's id and is renewed when the id differs; the data root is never placed on shared storage; what is read from the folder is fully verified before it is applied and a half-written bundle is a failure; future timestamps are clamped to the receiver's clock, versions keep increasing when the clock goes back, tombstone cleanup keeps a horizon; a single-copy object written to shared storage is written back with own changes only and not at all when the stored version cannot be read; a list received from another machine replaces the old one in one step and a failed read deletes nothing; when two devices write to one session the later sender is refused if it has not seen the other's message.

## Sizing

Plans are short READMEs and few tasks (aim for 5–9 per plan). Workers default to `sonnet-high`; mark hard tasks `**opus high.**` at the head of the brief. Phone-side work says that `packages/mobile` is outside the root workspace and that the person's real phone never receives a command.
