# sweep-core-apps

앱 runtime과 sync의 bug를 고친다: 조용히 끝난 앱, 권한 거두기, `@me` 권한, sync 적용의 답, 폰 전용 앱, release 준비.

- 단위: core-apps (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/{runtime,permissions,releases,sync,phone,calls,rewind,registration}/`
  - `packages/core/apps/packages/{publish.ts,commands.ts,commands_test.ts,install.ts,install_test.ts,model.ts,reads.ts,rows.ts,store.ts,sdk-sync.ts}`
  - `packages/core/main/app-supervisor/`
  - `packages/core/host-queue/{phone.ts,phone_test.ts}`
- 읽을 것:
  - 고칠 이슈마다 `project-docs/issues/<id>.yaml`의 `now`·`fix`·`decided`(추천안과 정한 것이 할 일이다)와 그 이슈의 `topic` 이름의 `project-docs/architecture/<topic>.md`
  - 화면을 바꾸면 `.claude/skills/ui-design/SKILL.md`(wireframe을 먼저 고친다)
- 계약:
  - 쓰는 것: 소유 밖의 protocol, port, shell IPC, preload는 고치지 않는다. 필요하면 보고의 "계약 바꾸기 요청"에 적는다.
  - i18n catalog(`packages/design/i18n/catalog/`)에는 key를 더하기만 한다.

## 할 일

아래 이슈를 하나씩 고친다. 이슈 file은 고치지 않는다(lead가 닫는다). 이슈의 글이 지금 코드와 다르면 코드를 믿고 보고에 적는다.

1. `app-clean-exit-not-restarted`
2. `grant-revoke-blocked-while-app-runs`: 위와 같은 뿌리
3. `me-dependency-permission-not-followed`
4. `sync-apply-timeout-closes-as-failed`
5. `sync-rewind-reply-capped`: 위와 같은 file
6. `phone-only-app-still-starts-on-computer`
7. `phone-backend-source-map-in-bundle`
8. `phone-preview-lacks-kit-font`
9. `phone-drive-two-devices-pick`

알아 둘 것:
- `packages/core/apps/update-state/`는 `sweep-folder-identity`의 것이다.
- ledger schema를 바꿔야 하면 새 schema step으로 하고(AGENTS.md "호환성") 등록은 보고의 "등록할 것"에 적는다.

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
