# found-bugs: eval을 준비하다 찾은 bug 넷을 고친다

- 목표: eval 계획의 brief를 쓰며 코드에서 찾은 bug 넷을 고친다. 모두 고칠 곳이 몇 줄이다.
- 재료: `project-docs/issues/coding-agent.md`("앱이 낸 package를 import한 앱은 app test에서 떨어진다"), `project-docs/issues/shell.md`("데스크톱이 CLI의 `--json` 결과를 `data` 칸에서 찾는다"), `project-docs/issues/eval.md`("run 요약이 늘 dirty로 남는다"), `project-docs/issues/coding-agent.md`("app test가 바꿀 것이 없는 write app-api를 떨어뜨린다").
- 범위 밖: 없음.
- 돌리는 방식: worker 없이 lead 혼자 한다. 패치가 좁다. task마다 brief가 있고 lead가 차례로 한다.
- 단위: `tasks/*.md`. task id는 `fb-`로 시작한다.
- 순서: 넷은 서로 기대지 않는다. 한 wave다.
- 시작 조건: 없음. 계획 `eval-coding`의 wave 3(재료)이 `fb-sdk-me`와 `fb-rewind-unchanged`를 기다린다.

## 정한 것

- 셋(`fb-sdk-me`, `fb-cli-json`, `fb-eval-dirty`)은 이슈의 추천대로 고친다(agent). 고칠 곳이 좁고 잃는 것이 없다.
- app test는 바꿀 것이 없는 write app-api를 통과로 둔다(사람). 바뀐 것이 없으면 되돌릴 것도 없다. 잃는 것: 쓰기를 아예 못 하는 write app-api를 이 확인으로는 잡지 못한다. `fb-rewind-unchanged`가 하고, 위험 test를 하나 둔다.
- `fb-sdk-me`와 `fb-cli-json`은 위험 test를 하나씩 둔다. 앞은 사용자 앱이 켜지지 못하는 규칙이고, 뒤는 데스크톱에서 coding agent에게 맡기는 길 전체가 막히는 규칙이다(`write-test`). `fb-eval-dirty`는 test를 두지 않는다(git 경로 지정 한 줄).

## lead가 할 일

- 고친 이슈를 `issue` skill대로 `project-docs/issues/archived/`로 옮긴다(`closed: fixed`, guard는 그 test).
- `project-docs/products/change-log/`의 열린 판에 항목 하나를 덧붙인다.
