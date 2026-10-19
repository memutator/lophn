# activation

ticket 확인됨 뒤 prepared release를 운영 앱으로 올리는 순서와 실패 복구. `project-docs/architecture/activation.md`.

## examples가 아닌 ticket의 release에서 "증명 못 함" write tool을 알리지 않는다

```yaml
kind: bug
modules: [packages/core/problems, packages/core/apps]
```

지금: app test `rewind` 검사가 만든 입력의 호출이 실패한 write tool을 "증명 못 함"으로 두고(증거 `unproven`, pass 이유 한 줄), problem은 examples ticket의 examples run이 끝날 때만 낸다(`project-docs/issues/archived/activation.md`의 "write app-api의 rewind 검사가 fail로 나온다"의 다시 정한 것). check가 `app_test`·`text`인 ticket의 release는 증명 못 한 write tool이 있어도 problem이 없다.

지금 이미 하는 것: App Engineer 지침이 write tool을 바꾸는 ticket에 examples check를 쓰게 하고 `rewind_unproven` problem을 받으면 그 tool의 examples ticket을 만들게 한다(`packages/core/agent-roles/roles/app-engineer/prompt.md`). 지침이라 program이 막지는 않는다.

영향: App Engineer가 지침을 어기고 examples 없이 활성화한 release의 write tool은 되돌리기가 틀려도 아무도 모른다. rewind가 그 tool의 호출을 틀리게 되돌리면 사람이 고른 시점의 앱 data가 어긋난다.

고치려면: activation 때 그 release의 app test 증거에서 `unproven`을 읽어 problem으로 낸다(중간. activation(`packages/core/apps/releases/activation`)이 app test 증거를 모르므로 apps → problems port가 필요하다). 지침이 지켜지는지 보고 필요해질 때 한다.
