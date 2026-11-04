# coding-agent

외부 coding agent 연결 장치(CLI, 제품 감지, hook 설치)다. `project-docs/architecture/coding-agent.md`.

## binary help에 사람 token으로는 거절되는 명령이 보인다

```yaml
kind: bug
modules: [packages/cli, packages/core]
```

- 지금: binary `lophn`(`packages/cli/main.ts`)은 명령 표 `COMMANDS` 전부를 help에 보이고 user token으로 부른다. 그런데 route가 actor `agent`만 받는 명령은 core가 `forbidden`으로 거절한다: `job.create`(`jobCreate`), `call.send`·`call.reply`·`session.list`(`calls.*`), `package.publish`. 읽기 route(`app.tool_index`, `declaration.check`, `packages.builtin`)는 actor에 `user`를 더해 binary에서도 된다.
- 영향: 사람 터미널의 coding agent가 help를 보고 이 명령을 부르면 이유 없이 `forbidden`을 받는다. 이 계획의 목적(coding agent가 같은 명령을 쓴다)이 이 명령들에서는 아직 안 된다.
- 고치려면: 쓰기(`job.create`, `package.publish`)와 session 사이 메시지(`call.*`)는 coding agent의 신원이 정해질 때 연다(`project-docs/products/roadmap/command-surface.md` 15, `project-docs/products/roadmap/workflow.md`). 그때까지 binary help에서 binary가 부를 수 없는 명령을 빼거나 표시한다. 추천: coding agent 신원과 같이 연다.

## coding agent에게 준 공유 skill을 끄는 화면이 없다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/core/approvals]
```

지금: `lophn app share --coding-agents`를 승인하면 앱 slug가 설정 `coding-agent.shared_apps`에 들어가고, `lophn harness sync-skills`가 그 앱의 public skill을 harness skill 폴더에 깐다. 그 목록에서 앱을 빼는 화면은 없다. 사람은 `~/.lophn/settings.json`을 직접 고쳐야 하고, 고치면 다음 sync가 사본을 지운다.

영향: coding agent가 더 이상 그 앱의 skill을 보지 않게 하려는 사람이 설정 파일 key 이름을 알아야 한다.

고치려면: Settings의 coding agent 쪽에 공유 앱 목록과 빼기를 둔다(작음). 추천.

## harness session에서 대기 메시지 steer와 fork가 harness에 닿지 않는다

```yaml
kind: bug
modules: [packages/core/main, packages/core/lophn-agent]
```

- 지금: harness session의 입력은 `packages/core/main/daemon/wiring/harness.ts`의 따로 둔 입력함에 쌓인다. 대기 메시지를 "지금 steer"로 올리는 `steerNow`(`packages/core/main/daemon/wiring/lophn-agent-runtime.ts`)는 run-loop 입력함만 보므로 harness session에서는 늘 `conflict`("the turn already took this message")다. 도는 turn 중에 보낸 메시지는 다음 turn의 입력이 된다. fork한 harness session(`packages/core/lophn-agent/places/lifecycle.ts` `startSession`)은 외부 session id(`sessions.harness_session`)를 물려받지 않아 harness 쪽 대화가 새로 시작한다.
- 영향: 사람이 harness session에서 steer를 누르면 틀린 이유로 거절되고, fork하면 harness가 앞 대화를 모른다.
- 고치려면: steer는 harness session이면 버튼을 숨기거나 `unavailable`("harness는 turn 중에 받지 못한다")로 거절한다(작음, 추천). fork는 headless resume이 fork를 지원하는 harness(`claude --resume --fork-session` 등)만 id를 물려주고 나머지는 지금처럼 새로 시작한다(중간).

## harness agent를 켜는 화면에 harness가 아직 없다

```yaml
kind: bug
modules: [packages/shell/main, packages/core/config]
```

- 지금: harness agent의 켜기는 extension `harness`의 설정 `extensions.harness.enabled`(`packages/core/config/shell-settings.ts` `harnessExtensionSetting`, 기본 꺼짐)다. Settings › System › Extensions는 roots(개발은 shell main 안 `extensions/bundled/`)에서 manifest를 찾은 extension만 보이는데, harness의 manifest가 아직 없어 그 줄이 없다.
- 영향: harness agent를 쓰려는 사람이 data root의 `settings.json`을 직접 고쳐야 한다.
- 고치려면: harness host를 extension `harness`(manifest와 entry)로 둔다(계획 harness-agent의 headless host, 작음).

## harness agent는 home에서 돌지 않고, opencode는 git root에 쓴다

```yaml
kind: bug
modules: [packages/shell/main]
```

- 지금: harness host(`packages/shell/main/extensions/bundled/harness/host.ts`)는 session place의 폴더를 cwd로 띄운다. place가 home이거나 폴더 없는 project·app이면 띄우지 않고 그 turn을 `configuration_unavailable`로 끝낸다(대화에 이유 한 줄). opencode(`opencode run --standalone`, v2.1.4)는 spawn cwd가 아니라 그 위 git root를 작업 폴더로 써서, git 저장소 안 하위 폴더를 project 폴더로 둔 곳에서는 저장소 맨 위에 쓴다(lead가 실제 실행으로 봤다).
- 영향: home의 전역 agent(Image Generator 같은 것)를 harness로 두면 부를 때마다 실패한다. 하위 폴더 project의 opencode agent는 폴더 밖 파일을 고친다. 앱 source 폴더는 늘 git root라 앱에서는 생기지 않는다.
- 고치려면: home은 data root 안 session마다 빈 작업 폴더를 cwd로 준다(작음). opencode는 project 폴더가 git root가 아니면 띄우지 않거나, opencode의 directory 지정 수단을 찾아 넘긴다(작음). 추천: 둘 다.

## opencode harness agent는 사람의 opencode 권한 설정대로 돈다

```yaml
kind: bug
modules: [packages/protocol/coding-agent]
```

- 지금: Claude Code는 `--permission-mode acceptEdits`(Bash 거절), Codex는 `-s workspace-write`로 띄운다(`packages/protocol/coding-agent/headless/`). opencode `run`에는 권한 flag가 없어 아무것도 넘기지 않고, 정의의 `permissions.deny`가 있으면 Codex·opencode는 띄우지 않는다.
- 영향: opencode agent는 사람의 opencode 설정(기본은 대부분 허락)으로 shell과 폴더 밖 쓰기를 한다. 사람이 자기 터미널에서 opencode를 쓸 때와 같다(사람, 2026-11-04: 이대로 둔다).
- 고치려면: opencode의 config env(inline config의 `permission`)로 bash deny, 바깥 폴더 deny를 넘기고 실제 실행으로 확인한다(작음).
