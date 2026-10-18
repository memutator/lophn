# fb-rewind-unchanged

app test의 되돌리기 확인(`rewind`)이 fixture 입력에서 바꿀 것이 없는 write app-api(없는 id를 지우는 `remove`처럼 맞게 짠 것)를 떨어뜨린다. 바뀐 것이 없으면 되돌릴 것도 없으니 통과로 둔다(사람).

- 단위: fb-rewind-unchanged (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/problems/tests/harness/checks.ts`
  - `packages/core/problems/tests/work/app-driver.ts`
  - `packages/core/problems/tests/harness/checks_test.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/coding-agent.md`의 "app test가 바꿀 것이 없는 write app-api를 떨어뜨린다"
  - `packages/core/problems/tests/harness/driver.ts`의 `RewindRun`(called, changed, applied, restored, reason)
  - architecture: `project-docs/architecture/coding-agent.md`(release 확정, app test)
- 계약:
  - 쓰는 것: `AppDriver.rewind(api): Promise<RewindRun>`
  - 내놓는 것: 바뀌는 계약 없음. `RewindRun`의 칸 뜻을 더 정확히 채운다

## 할 일

1. `app-driver.ts`의 `rewind`에서 호출이 changeset을 내지 않은 갈래(`if (!body.changeset)`)도 `changed`를 실제 값(`dataState() !== before`)으로 돌려준다. 지금은 `none`의 `changed: false`라서, changeset 없이 data를 바꾼 api가 "안 바꿨다"로 보인다.
2. `checks.ts`의 `rewind`에서 통과 조건을 `run.called && (!run.changed || (run.applied && run.restored))`로 바꾼다. 바뀐 것이 없으면 되돌릴 것이 없어 통과다. 바뀌었는데 changeset이 없거나 되돌리지 못하면 지금처럼 떨어진다. 통과 이유 글에 "바꾼 것이 없는 api는 되돌릴 것이 없다"를 더한다.
3. `checks_test.ts`를 만든다. 가짜 `AppDriver`(rewind만 쓴다)로 그 check를 부른다. `rewind`가 export되지 않았으면 그것을 부르는 export를 통해 부른다.
   - `{ called: true, changed: false }`인 api만 있으면 통과다.
   - `{ called: true, changed: true, applied: false }`(changeset이 없거나 적용 실패)면 떨어진다.
   - `{ called: false }`면 떨어진다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "바꿀 것이 없는 write app-api는 되돌리기 확인을 통과하고, data를 바꾼 뒤 되돌리지 못한 api와 호출에 실패한 api는 여전히 떨어진다." 이것이 틀리면 맞게 짠 앱이 켜지지 않거나, 되돌릴 수 없는 앱이 켜진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 정한 것: 없으면 "없음"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
