# e2e-rewrite

e2e와 test 지원 code가 fake model에게 부르게 하던 옛 native tool(`call`, `reply`, `cancel`, `app_create`, `release_prepare`, `preview_*`, `job_*`, `workflow_*`, 앱 tool `<domain>_<tool>` 등)을 `lophn {args}` 명령 호출로 고친다.

- 단위: text (wave 2)
- 선행: cmd-followups. `preview.call`이 명령으로 옮겨진 뒤의 이름을 쓴다.
- 소유(이 task만 고친다):
  - `tests/e2e/**`
  - `tests/support/**`
  - `tests/harness/**`
  - `tests/live/**`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/command-surface.md`
  - 명령 표: `packages/cli/commands/`(실제 명령 이름), `lophn help`의 출력
  - architecture: `project-docs/architecture/testing.md`, `project-docs/architecture/agent-definition.md`(`lophn` tool)
- 계약:
  - 쓰는 것: 명령 표와 `lophn` tool(wave 1, 2가 만든 것)

## 할 일

1. fake model 각본의 tool 호출을 `lophn` tool 호출(`{args: [...]}`)로 바꾼다. 기록·event를 tool 이름으로 확인하던 곳은 기록 이름(명령 이름, 예 `call.send`, `app.create`)으로 맞춘다.
2. place 종류를 tool 목록으로 가려내던 곳(예: `workflow_check`가 있으면 project)은 남은 native tool이나 `lophn` 설명의 명령 목록으로 가린다.
3. `npm run e2e:deps` 뒤 `npm run e2e`로 고친 test를 돌린다. 새 e2e는 만들지 않는다.

## 끝남

- `npm run check:full`이 통과하고 `boot.sh`가 두 번 `exit 0`이다.
- `npm run e2e`가 통과한다(제품 bug로 실패하면 고치지 말고 보고한다).
- 남지 않음: `grep -rn '"call"\|"reply"\|"cancel"\|app_create\|release_prepare\|tool_load\|tool_call' tests/e2e tests/support tests/harness`에 옛 native tool 호출이 0줄이다.

## 보고

- 바꾼 file, 통과한 check와 e2e
- 정한 것, 넘길 줄
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
