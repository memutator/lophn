# approval

판정(Gate)과 사람에게 묻는 request의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/approval.md`.

## 공유 요청 승인이 agent 파일을 하나씩 쓰다 둘째가 실패하면 첫 agent에 앱이 남는다

```yaml
kind: bug
modules: [packages/core/approvals, packages/core/main, packages/core/lophn-agent]
```

지금: `applyApproval`(`packages/core/approvals/share-requests/commands.ts`)은 받을 agent마다 `assignments.set`을 부른다. 그 port의 `writeAssignment`(`packages/core/main/daemon/wiring/assignment-file.ts`)는 호출 즉시 `writeAgentAssignment`로 agent 정의 파일(`agents/<id>.md`)을 쓴다. 파일 쓰기는 ledger tx에 들어 있지 않다. 둘째 agent에서 실패하면(정의 파일이 깨졌거나 읽기·쓰기 오류, 그 사이 revision이 바뀐 `conflict`) tx는 되돌려져 공유 요청 행은 그대로 열려 있지만, 첫째 agent의 파일은 이미 앱이 더해진 채다. activation 동의가 같이 승인하는 길(`approveShareWithConsent`)도 같은 함수를 쓴다. 이 승인 중 commit이 실패해도 파일은 남는다.

영향: 사람이 승인하지 않은 것처럼 보이는(요청이 아직 열려 있고 승인이 오류로 끝난) 상태에서 첫 agent가 그 앱의 tool을 쓸 수 있다. 할당은 권한이라 사람이 본 결과와 실제 권한이 어긋난다. 다시 승인하면 `entries.some`이 이미 있는 줄을 건너뛰어 마무리되지만, 사람이 거절하면 첫 agent에 할당이 남는다.

고치려면:
- 쓰기 전에 받을 agent 모두의 정의 파일을 읽고 파싱해 검사하고, 모두 통과하면 쓴다. 작음. 둘째 쓰기의 오류 대부분(깨진 파일, 없는 agent)이 첫 쓰기 전에 잡힌다. 디스크 오류는 남는다. 추천.
- 쓰다 실패하면 이미 쓴 agent의 파일을 이전 내용으로 되돌린다. 중간. 되돌리다 또 실패하는 경우가 남는다.
- 파일 쓰기를 commit 뒤(`afterCommit`)로 옮긴다. 큼. 승인 결과를 ledger가 먼저 확정해 파일 쓰기 실패를 따로 다뤄야 한다.
