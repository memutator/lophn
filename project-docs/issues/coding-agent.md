# coding-agent

App Engineer가 ticket을 외부 coding agent에게 맡기는 길(session, 터미널, CLI, ticket)이다. `project-docs/architecture/coding-agent.md`.

## codex는 새로 놓은 hook을 사람이 `/hooks`에서 trust해야 쓴다

```yaml
kind: bug
modules: [packages/coding-agent]
```

지금: codex는 새로 놓이거나 바뀐 hook을 사람이 codex 안의 `/hooks`에서 trust하기 전까지 건너뛴다(learn.chatgpt.com/docs/hooks). trust 기록은 `~/.codex/config.toml`의 `[hooks.state."...hooks.json:stop:0:0"] trusted_hash`다. `harness install`은 toml을 쓰지 않는다. 설치된 codex 0.161.0 binary에도 `hooks need review before they can run` 문구와 `trusted_hash` 칸이 있다.

영향: codex에 맡기면 첫 번(그리고 hook이 바뀐 뒤)에는 사람이 trust할 때까지 turn 끝 신호가 안 와서 state가 unknown이다.

고치려면:
- 그대로 두고 confirm 화면에서 "codex에서 /hooks로 trust하라"를 알린다(작음).
- `config.toml`에 trust 기록을 쓴다(중간. toml을 고치는 코드와 hash 규칙을 알아야 한다).

## coding agent가 CLI만으로 준비한 release의 완료를 보고할 수 없다

```yaml
kind: bug
modules: [packages/protocol, packages/coding-agent, packages/core/apps, packages/core/server]
```

지금: `lophn ticket report`(`protocol/coding-agent/cli-commands.ts`, 입력 `ticketReportToolInputSchema`)는 준비된 `release` id를 받는다. 그런데 `lophn release prepare`(`release.prepare_bundle`)의 출력에는 `request_key`, `status`, hash, manifest만 있고 release id가 없다. release id를 돌려주는 `releases/preparation`(`release.preparation`, `protocol/apps/releases.ts`의 출력 주석 "ticket report가 쓴다")은 CLI 명령 표에 없어 coding token으로 부를 길이 없다. 준비 확정도 그 read를 부를 때 일어난다(`finalizer.observe`, 계획 `e2e-coverage`의 brief 조사). 완료에 필요한 app test의 test hash와 결과를 CLI로 얻는 길도 없는 것으로 읽힌다. 코드로 읽었고 돌려 보지 않았다.

영향: coding agent가 앱을 고치고 release를 준비해도 완료 보고를 못 한다. 그러면 App Engineer의 검증과 `TicketVerified`가 없어 activation이 시작되지 않는다. 사람이 lophn으로 앱을 만들어 쓸 수 없다. 앱 E2E도 이 길을 지나야 한다.

고치려면:
- CLI에 `release status`(`releases/preparation`), `app test status`, `app test result`를 coding token 명령으로 연다(중간). 계획 `e2e-coverage`의 `app-cli-finish` brief가 이 안이다. 추천.
- `release prepare`가 끝날 때까지 기다려 release id를 돌려주게 한다(중간). 준비가 300초까지 걸려 CLI가 그동안 막힌다.

정한 것: CLI에 `release status`, `app test status`, `app test result`를 coding token 명령으로 연다(계획 `e2e-coverage`의 `app-cli-finish`). (사람)
