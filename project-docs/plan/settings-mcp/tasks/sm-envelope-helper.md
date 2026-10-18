# sm-envelope-helper

renderer가 command 봉투를 만드는 helper 하나를 두고, 설정 화면(provider 연결, 기본 model 바꾸기)이 그것만 쓰게 한다. 지금 설정 화면은 `compare`를 빼고 보내 core에 닿기 전에 `invalid_input`으로 거절되어 provider를 하나도 붙이지 못한다. 이 task가 그 bug를 고치는 첫 일이다.

- 단위: sm-envelope (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/command-call.ts`
  - `packages/shell/renderer/command-call_test.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-env.ts`
  - `packages/shell/renderer/desktop/settings/core-call.ts`
  - `packages/shell/renderer/desktop/settings/providers/core-source.ts`
  - `packages/shell/renderer/desktop/settings/agents/core-source.ts`
- 읽을 것:
  - issue: `project-docs/issues/shell.md`의 "설정 화면의 command가 compare를 빼서 provider 연결과 기본 model 바꾸기가 모두 거절된다"
  - 봉투 정본: `packages/protocol/base/envelope.ts`의 `commandRequestSchema`(strict object. `compare`는 route에 compare가 없어도 `{}`로 필수, `prepared`는 필수, `confirmation`은 route가 `required`를 선언하면 필수)
  - 본보기: `agent-tab-core-source-env.ts`의 `CommandBody`·`CompareOf`·`Env.command`(대화는 이미 route에서 type을 꺼낸다)
  - test: `.claude/skills/write-test/SKILL.md`
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/shell/renderer`(boundary `shell`)
- 계약:
  - 쓰는 것: `packages/protocol/base/route.ts`의 `CommandRoute`, `packages/protocol/base/confirmation-handle.ts`의 `ConfirmationRef`, `packages/shell/ipc/core.ts`의 `CoreCall`, `packages/protocol/base/envelope.ts`의 `commandRequestSchema`(test만)
  - 내놓는 것(`sm-envelope-sites`가 쓴다): `packages/shell/renderer/command-call.ts`
    - `CommandBody<R extends CommandRoute>`: `{ input: z.input<R["input"]>; compare: CompareOf<R>; key: string; confirmation?: ConfirmationRef }`. `CompareOf<R>`은 `agent-tab-core-source-env.ts`의 것을 옮긴다(compare가 없는 route는 `{}`를 강제한다).
    - `commandBody(route, body)`: 봉투 `{ input, idempotency_key: body.key, compare: body.compare, prepared: [], ...confirmation }`를 돌려준다. compare를 빼는 길이 없다.
    - `commandCall(route, body)`: `CoreCall`(`{ kind: "command", resource: route.resource, method: route.method, body: commandBody(route, body) }`)을 돌려준다.

## 할 일

1. `packages/shell/renderer/command-call.ts`를 만든다. `agent-tab-core-source-env.ts`의 `CommandBody`와 `CompareOf`를 옮겨 위 계약대로 둔다. renderer 루트(`prefixed-id.ts`, `source-result.ts` 옆)에 두는 것은 대화·설정·workspace·앱·launcher가 같이 쓰기 때문이다.
2. `conversation/agent-tab-core-source-env.ts`: `createEnv`의 `command`가 body를 `commandBody(route, body)`로 만들고, 옮긴 type은 helper에서 import한다. 대화 쪽 호출 file(`-commands`, `-calls`, `-sessions`, `-model`, `-rewind`)은 `env.command` 인자 모양이 그대로라 고치지 않는다.
3. `desktop/settings/core-call.ts`: `command()`를 `command(core, route, body: CommandBody<R>)` 꼴로 바꿔 `call(core, "command", route.resource, route.method, commandBody(route, body))`로 보낸다(손으로 짠 `...(body.compare === undefined ? {} : …)` 분기를 지운다). `SourceResult`로 감싸는 `call()`은 그대로 쓴다.
4. `desktop/settings/providers/core-source.ts`: `command(core, "providers", …)` 호출 다섯(`connect` 둘, `login-begin`, `login-complete`, `login-cancel`)을 `packages/protocol/lophn-agent/providers.ts`의 `connectProvider`, `loginBegin`, `loginComplete`, `loginCancel` route로 바꾼다. `disconnect`(`call(core, "command", "providers", "disconnect", {…})`로 봉투를 손으로 짠 곳)는 `command(core, disconnectProvider, { input, compare: { revision }, key, confirmation })`로 바꾼다.
5. `desktop/settings/agents/core-source.ts`: `changeDefaultModel`을 `packages/protocol/lophn-agent/models.ts`의 `modelDefaultChange` route로 바꾼다.
6. `command-call_test.ts`에 test 하나를 쓴다(아래 끝남). process를 띄우지 않는다.
7. 이 task 뒤 `grep -rn "idempotency_key" packages/shell/renderer --include=*.ts --include=*.tsx --exclude-dir=dist`는 helper와 아직 안 고친 8곳(`sm-envelope-sites`가 고친다)만 남는다.

## 끝남

- `deno task check`가 통과한다.
- `deno run -A packages/shell/renderer/build.ts`가 통과한다.
- 위험 test(하나): "helper가 만든 봉투는 compare가 없는 route, compare가 있는 route, confirmation이 필수인 route 모두 `commandRequestSchema(route)`를 통과한다." 표로 세 route를 돈다. 입력이 `{}`뿐인 작은 route를 `defineCommand`로 test 안에서 만들어 쓴다(진짜 provider route의 긴 input을 맞추지 않는다. 지키는 것은 봉투 칸이다). 칸 하나가 빠져 provider 연결 전체가 조용히 막힌 bug다. 화면 test는 가짜 CoreSource를, e2e는 직접 만든 봉투를 써서 화면이 만든 봉투를 contract schema로 보는 곳이 없으므로 위험 test 대상이다(`write-test`: 경계를 넘는 판정).
- 남지 않음: `grep -rn "body.compare === undefined" packages/shell/renderer --include=*.ts --include=*.tsx --exclude-dir=dist`가 0줄이다.
- 손으로 확인: lead가 `deno task dev`(fake provider)로 설정 화면을 열어 custom provider 연결과 Agents 탭의 기본 model 바꾸기가 거절 없이 되는지 본다. 진짜 provider key는 쓰지 않는다.

## 보고

- 바꾼 file, 통과한 check
- 정한 것: `compare`는 type에서 필수로 두고(대화의 `CommandBody` 그대로) 기본값으로 채우지 않는다. 기본값으로 채우면 compare가 필요한 route에서 빠뜨려도 type이 못 잡는다.
- 넘길 줄: `sm-envelope-sites`가 남은 8곳을 고친다.
- 무겁게 짠 것 / 알려진 미완 동작: 없으면 "없음"
