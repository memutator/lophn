# app-sync-policy-and-keep-both

- 단위: app declaration policy, keep_both sync conflict, SDK bump (wave 1)
- 선행: 없음
- 목표: `@lophn/declaration >= 6.0.0`(및 기존 `5.0.0–5.2.0` phone+computer 앱)에 대해 앱 데이터 기본 동기화 정책을 `"computers"`로 두고 `"local"` opt-out을 지원하며(기존 `<= 5.2.0` computer-only 번들은 local 유지), 기존 `lophn_sync_*` 표만 써서 `keep_both`("둘 다 남김") 텍스트 충돌 보존을 구현하고 SDK 3종(`declaration` 6.0.0, `app-ui` 2.26.0, `app-ui-native` 1.12.0)과 `migrate-sdk` 메모를 갱신한다.
- 소유:
  - `packages/protocol/apps/declaration/`
  - `packages/protocol/apps/sync/`
  - `packages/core/apps/declaration/`
  - `packages/core/apps/sync/`
  - `packages/core/agent-workspaces/skills/migrate-sdk/`
  - `packages/sdk/declaration/`
  - `packages/sdk/app-ui/`
  - `packages/sdk/app-ui-native/`
- 참조:
  - `packages/protocol/apps/app-sync.ts`
  - `packages/mobile/src/apps/local/sync/`
  - `packages/mobile/modules/lophn-app-db/`
  - `tools/deps-declaration.ts`
  - `tools/check-sdk-notes.ts`
  - `.claude/skills/sdk-note/SKILL.md`
  - `project-docs/products/roadmap/computer-hub.md`

## 구현

1. **선언 데이터 정책 (`@lophn/declaration` 6.0.0) & 하위 호환 (`sync-plan.ts`)**:
   - **제약 준수**: `packages/protocol/apps/declaration/`은 외부 의존성 없는 pure TS(`checkDeclarationGraph`), `packages/protocol/apps/sync/`는 `node:*` 금지(`portable-import`)!
   - `packages/protocol/apps/declaration/types.ts`, `value.ts`, `tools.ts`, `sync-plan.ts`:
     - Table별/앱별 정책에 `"local"`(또는 default `"computers"`) 및 충돌 전략 `conflict?: "lww" | "keep_both"`(선언/메타 형태 깔끔히 설계)을 표현할 수 있게 한다.
     - `syncPlanOf(declaration, override?)` version-gate 규칙:
       - `@lophn/declaration >= 6.0.0`: 명시적으로 `"local"`로 뺀 표 외에는 **컴퓨터 앱 표도 기본 `"computers"`**(내장/표준 shared destination으로 동기화)!
       - 기존 봉인 번들 `5.0.0–5.2.0`: `runs_on`에 `"phone"`과 `"computer"`가 함께 있고 `sync`가 생략된 경우에만 `"computers"`로 취급; `<= 5.2.0`의 computer-only 앱(`mafia`, `holdem`, `omok`, `agent-monitor`, `masup`, `mahas`) 중 `sync`가 없으면 기존처럼 local 유지(단, Wave 2에서 붙일 `sync.app_policies` user override를 받을 수 있도록 optional override 인자 열어둠).
     - `packages/core/apps/declaration/` 검사 로직도 6.0.0 규칙과 맞춘다.

2. **`keep_both` ("둘 다 남김") 텍스트 충돌 보존 (`packages/protocol/apps/sync/`)**:
   - **Android C++ authorizer 불변식**: `packages/mobile/modules/lophn-app-db`는 `lophn_sync_row`, `lophn_sync_col`, `lophn_sync_kept` 표 이름만 허용한다! 절대로 새 `lophn_sync_*` 표를 추가하지 말고 기존 `lophn_sync_row`, `lophn_sync_col`, `lophn_sync_kept`만 사용한다!
   - `packages/protocol/apps/sync/apply.ts` (컴퓨터 core와 폰 mobile이 공용으로 부르는 apply 함수), `local.ts`, `changeset.ts`, `packages/core/apps/sync/`:
     - 동시 수정(concurrent edit, HLC 비교상 서로 인과가 겹치며 두 기기/node id가 다른 경우) 시 텍스트 컬럼(`TEXT`)이 충돌하면 LWW로 패자 값을 버리는 대신:
       - 승자 row는 원래 PK로 유지하고,
       - **결정론적 `dupPk`**(예: 원본 PK + 패자/충돌 hash 접미사 또는 PK 스키마 호환 결정론적 키 — integer/hex/text PK 각각 안전 처리)로 충돌 사본 row를 INSERT하거나 `lophn_sync_kept`에 기록해 두 버전 모두 데이터 유실 없이 보존하고 모든 replica(컴퓨터·폰)가 같은 PK·행으로 수렴하게 한다.
     - 단위 테스트에서 서로 반대 순서(`A→B`, `B→A`)로 적용해도 두 replica가 정확히 동일한 두 행(원본 + 결정론적 conflict copy)으로 수렴함을 검증한다.

3. **SDK 판 올리기 & `migrate-sdk` 노트**:
   - `.claude/skills/sdk-note/SKILL.md`를 읽고 따른다.
   - `@lophn/declaration` → `6.0.0`, `@lophn/app-ui` → `2.26.0`, `@lophn/app-ui-native` → `1.12.0` (`packages/sdk/*/package.json` 및 `protocol/apps`의 버전 상수/`SUPPORTED_FROM` 등 확인).
   - `packages/core/agent-workspaces/skills/migrate-sdk/`에 새 migration 노트(`declaration-6.0.0.md`, `app-ui-2.26.0.md`, `app-ui-native-1.12.0.md`)를 작성해 `node tools/check-sdk-notes.ts`를 통과시킨다.

## 완료 기준

- `node --test packages/protocol/apps/**/*_test.ts packages/core/apps/sync/*_test.ts packages/core/apps/declaration/*_test.ts` (해당 test 파일들) 통과
- `node tools/check-deps.ts && node tools/check-sdk-notes.ts && npm run check` 통과
