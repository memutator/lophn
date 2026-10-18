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


## 앱이 낸 package를 import한 앱은 app test에서 "선언하지 않은 의존"으로 떨어진다

```yaml
kind: bug
modules: [packages/core/problems, packages/core/apps]
```

지금:
- 앱이 낸 package는 `sdk/@me/<part>/<version>`에 깔린다(`packages/core/apps/packages/install.ts`의 `packageInstallPath`). 내장 SDK는 `sdk/<part>/<version>`이다.
- app test의 의존 확인(`packages/core/problems/tests/app-test/generate.ts`의 `checkDependencies`)은 import 값을 `SDK_COPY = /^\.\/sdk\/([^/]+)\/([^/]+)\//`로 읽는다. `./sdk/@me/date-range/1.0.0/...`은 이름 `@me`, version `date-range`로 읽혀 blueprint에 선언한 의존과 맞지 않는다.
- 그래서 `@me/*`를 의존에 적고 import한 앱은 그 import가 늘 "선언하지 않은 의존"이 된다.

영향: 앱이 낸 package를 다른 앱이 쓰는 길이 막혀 있다. App Engineer가 `package.publish`로 낸 logic을 다른 앱이 쓰면 그 release는 app test를 넘지 못해 켜지지 않는다. eval의 재사용 확인(계획 `eval-coding`의 calendar-mvp)도 이 때문에 떨어진다.

고치려면: `SDK_COPY`가 `@me/`를 건너뛰고 읽게 한다(`/^\.\/sdk\/(?:@me\/)?([^/]+)\/([^/]+)\//`, 작음). 이름 비교는 `item.name.split("/").pop()`이라 그대로 맞는다. `@me` package를 import하는 app test 입력 하나로 test를 둔다. 추천.

## app test가 바꿀 것이 없는 write app-api를 떨어뜨린다

```yaml
kind: bug
modules: [packages/core/problems]
```

지금: `packages/core/problems/tests/harness/checks.ts`의 `rewind`는 write app-api를 선언 순서대로 가장 단순한 입력으로 한 번씩 부르고, 그 호출이 data를 바꿨는지(`changed`)를 통과 조건에 넣는다(`run.called && run.changed && run.applied && run.restored`). 그래서 그 입력에서 바꿀 것이 없는 write app-api(없는 id를 지우는 `remove`처럼 맞게 짠 것)는 떨어진다.

영향: coding agent가 맞게 짠 앱이 app test를 넘지 못한다. 넘기려면 바꿀 것이 없을 때도 무언가를 쓰게(지운 기록 표 등) 앱을 일그러뜨려야 한다. eval의 기준 캘린더 앱도 그렇게 짜야 한다.

고치려면:
- 바뀐 것이 없으면 그 api는 되돌릴 것이 없으니 되돌리기 확인을 통과로 둔다(작음). 잃는 것: 쓰기를 아예 못 하는 write app-api를 이 확인으로는 잡지 못한다. 추천.
- 앞 호출이 만든 행(예: 앞선 `add`의 id)을 다음 호출의 입력으로 넣는다(중간). 입력 꼴마다 규칙이 필요하다.

정한 것: 바뀐 것이 없으면 통과로 둔다(사람). changeset을 내지 않은 호출도 `changed`를 실제 값으로 채워, changeset 없이 data를 바꾼 api는 여전히 떨어지게 한다. 계획 `found-bugs`가 한다.
