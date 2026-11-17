# sweep-tools

개발 도구를 고친다: check의 tsc를 node 쪽 한 program으로 묶고, merge.sh가 의존이 바뀌면 `npm ci`를 돌리게 한다.

- 단위: tools (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/check.ts`
  - `tsconfig.node.json`
  - `project-docs/plan/tools/lead/merge.sh`
- 읽을 것:
  - 고칠 이슈마다 `project-docs/issues/<id>.yaml`의 `now`·`fix`·`decided`(추천안과 정한 것이 할 일이다)와 그 이슈의 `topic` 이름의 `project-docs/architecture/<topic>.md`
  - 화면을 바꾸면 `.claude/skills/ui-design/SKILL.md`(wireframe을 먼저 고친다)
- 계약:
  - 쓰는 것: 소유 밖의 protocol, port, shell IPC, preload는 고치지 않는다. 필요하면 보고의 "계약 바꾸기 요청"에 적는다.
  - i18n catalog(`packages/design/i18n/catalog/`)에는 key를 더하기만 한다.

## 할 일

아래 이슈를 하나씩 고친다. 이슈 file은 고치지 않는다(lead가 닫는다). 이슈의 글이 지금 코드와 다르면 코드를 믿고 보고에 적는다.

1. `tsc-projects-recheck-shared-code`: 추천안. 묶기 전과 뒤에 type 오류가 같은지(지금은 0) 보고, 시간과 memory를 재서 보고에 적는다
2. `merge-sh-stale-lead-node-modules`: `main-lib.sh`의 `deps` 함수를 쓴다

알아 둘 것:
- 이 task는 project-docs 아래 `merge.sh` 하나를 고친다(예외). 다른 project-docs는 고치지 않는다.
- 다른 worker들이 지금 `npm run check:full`을 돌리고 있다. 재는 일은 가볍게 한 번씩만 한다.

## 끝남

- `npm run check:full`이 통과한다.
- 위험 test: 이슈의 `fix`가 "test를 쓴다"고 한 것과 데이터·권한에 닿는 것만(`write-test` skill). 나머지는 없음
- 이슈마다 고쳤는지, 못 고쳤으면 왜인지가 보고에 있다.

## 보고

- 이슈마다: 고침 / 일부 / 못 함(이유), 지금 코드가 어떻게 하나 한두 문장, 지키는 test 이름(없으면 없음)
- 바꾼 file, 통과한 check
- 등록할 것, 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것(실제 폰이나 Electron에서 못 본 것 포함). 없으면 "없음"
