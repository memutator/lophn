# settings-keep

`settings.json`에 모르는 key나 틀린 값이 있어도 나머지 설정을 살리고, 쓰기가 그 key를 지우지 않게 한다.

- 단위: config (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/config/store.ts`
  - `packages/core/config/store_test.ts` (없으면 새로)
- 읽을 것:
  - `packages/core/config/store.ts` 96-160행(`registry.validate`가 `unknown_key`면 파일 전체 거절, 다음 update가 `{...chosen}`만 씀)
  - `packages/core/config/workspace-rename.ts` 3행 주석(선언을 지우면 data step 없이는 이 일이 난다)
- 계약:
  - 쓰는 것: setting registry(`validate`). 고치지 않는다.
  - 내놓는 것: 없음

## 할 일

1. 읽을 때 key 하나씩 판정한다. 모르는 key와 값이 틀린 key는 그 key만 무시(기본값)하고 나머지는 적용한다. 무시한 key는 core log에 한 번 남긴다.
2. 쓸 때 원래 file의 raw object에서 시작해 바꾼 key만 덮는다. 모르는 key와 틀린 값은 사람이 그 key를 직접 바꾸지 않는 한 file에 그대로 남는다.
3. JSON 자체가 깨진 file은 지금 동작을 확인하고, 쓰기가 그 file을 빈 설정으로 덮는다면 쓰기를 거절(`unavailable`)한다. 덮지 않으면 그대로 둔다.

## 끝남

- `npm run check:full`이 통과한다(lead가 준 Windows 기준선 실패는 빼고).
- 위험 test: "모르는 key가 있는 settings.json에서 다른 setting 하나를 update하면, 모르는 key는 file에 남고 아는 setting들은 적용된다" 하나. 깨진 JSON 동작을 바꿨으면 "깨진 file은 쓰기가 덮지 않는다" 하나.
- `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`.

## 보고

brief-template의 보고 꼴.
