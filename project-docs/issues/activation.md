# activation

ticket 확인됨 뒤 prepared release를 운영 앱으로 올리는 순서와 실패 복구. `project-docs/architecture/activation.md`.

## app test 검사별 detail을 아무도 읽지 못한다

```yaml
kind: defect
modules: [packages/core/problems, packages/core/storage]
```

지금: 검사마다의 이유와 증거는 verification의 `observations` blob에 있다. 그 칸은 `general_read: false`로 등록돼(`packages/core/problems/tests/blobs.ts`의 `TEST_BLOB_FIELDS`) `blob.read`가 어느 actor에게도 주지 않는다(`packages/core/storage/blobs/refs.ts`의 `generalReadAllowed`). `GetVerification`의 `detail: true`는 별도 권한을 보지만(`packages/core/problems/tests/reads.ts`의 `readVerification`) 허락돼도 hash만 든 같은 Verification을 돌려준다. 그래서 detail은 disk에서만 읽힌다.

영향: 검사가 떨어진 이유를 coding agent와 사람이 화면·CLI로 볼 수 없다. 계획 `rewind-check` 진단은 data root의 blob 파일을 직접 열어 원인을 찾았다. fail 이유 한 줄에 검사별 이유를 실어 지금 필요한 만큼은 보인다. 증명 못 한 write tool도 같은 까닭에 core가 app test pass 이유 한 줄을 parse해 읽는다(`packages/core/problems/tests/unproven.ts`의 `unprovenOfReason`).

고치려면:
- 그대로 둔다(비용 0). fail 이유 한 줄이 검사별 이유를 싣는다. 추천.
- `detail: true`가 허락된 자격에 observations 내용을 싣는다(작음~중간. 그 blob에 앱 출력이 들어 있어 누가 읽을지 정해야 한다).

## examples가 아닌 ticket의 release에서 "증명 못 함" write tool을 알리지 않는다

```yaml
kind: bug
modules: [packages/core/problems, packages/core/apps]
```

지금: app test `rewind` 검사가 만든 입력의 호출이 실패한 write tool을 "증명 못 함"으로 두고(증거 `unproven`, pass 이유 한 줄), problem은 examples ticket의 examples run이 끝날 때만 낸다(`project-docs/issues/archived/activation.md`의 "write app-api의 rewind 검사가 fail로 나온다"의 다시 정한 것). check가 `app_test`·`text`인 ticket의 release는 증명 못 한 write tool이 있어도 problem이 없다.

영향: examples 없이 활성화된 release의 write tool은 되돌리기가 틀려도 아무도 모른다. rewind가 그 tool의 호출을 틀리게 되돌리면 사람이 고른 시점의 앱 data가 어긋난다.

고치려면:
- activation 때 그 release의 app test 증거에서 `unproven`을 읽어 problem으로 낸다(중간. activation(`packages/core/apps/releases/activation`)이 app test 증거를 모르므로 apps → problems port가 필요하다).
- Project Manager 지침이 write tool을 바꾸는 ticket에 examples check를 쓰게 한다(작음. 지침 문장. domain-place가 `packages/core/agent-roles/roles/project-manager/prompt.md`에 넣었다. 지침이라 program이 막지는 않는다).
