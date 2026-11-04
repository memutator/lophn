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

## `harness.enabled`를 켜는 화면이 없다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/shell/renderer]
```

- 지금: 설정 `harness.enabled`(`packages/core/lophn-agent/session/harness.ts` `harnessEnabledSetting`, 기본 꺼짐)를 켜는 Settings 화면이 없다. 사람은 data root의 `settings.json`을 직접 고쳐야 harness agent를 쓸 수 있다.
- 영향: harness agent를 쓰려는 사람이 설정 key 이름을 알아야 한다.
- 고치려면: 계획 extension의 켜기 화면이 land하면 설정을 `extensions.harness.enabled`로 옮기고 그 화면을 쓴다(계획 harness-agent README 정한 것 1). 그 전에 land하면 Settings에 칸 하나를 둔다(작음). 추천: extension을 기다린다.
