# wireframe을 정본으로 하는 UI kit 하나로 모으기

상태: 로드맵. 아직 계획(`plan/`)으로 열지 않았다. 열 때 이 문서를 계획 README의 재료로 쓴다. 범위는 MVP까지다. preview, slot, shell theme, eject CLI는 다루지 않는다.

## 요구

1. wireframe에 그린 화면과 component가 정본이다. 사람이 보고 확인하기 쉽고, 거기서 명시적으로 승인한다.
2. lophn이 token부터 tabs, scrollbar, table까지 범용 UI component를 제공한다. 유지보수와 "UI slop" 비용은 lophn이 진다.
3. 사용자는 배포된 UI를 그대로 쓰되 고칠 수 있어야 한다. 사용자가 고친 것이 shell을 깨지 않고, lophn의 UI update가 사용자 component를 깨지 않는다.
4. wireframe에서 만든 component가 범용(사용자도 씀)인지 shell 전용인지 정할 수 있어야 한다. 기준은 범용성이다. 예: model picker는 배포하지 않는다.
5. wireframe의 component를 실제 frontend에서 최소 비용으로 쓰고, 동기화 여부를 쉽게 검증한다.
6. component 분류(taxonomy)가 분명해서 agent가 재사용할 component를 쉽게 찾는다.

## 지금 모양

- `packages/design`: token(`tokens.ts` → `generated/tokens.css`), 평평한 `components/`에 약 40개 export, `reading`, `wording`. CSS는 `style-check`가 token만 쓰게 막는다. chart는 `@lophn/chart`로 따로 있다.
- `packages/sdk/ui-*` 10개: 대부분 design 재export. `ui-layout`(AppShell, Grid, Sidebar), `ui-filter`(FilterBar 등), `ui-state`(AppErrorBoundary, ReadState), `ui-action`(AppApiButton, useAppApi)만 자기 코드가 있다. `ui-control`에는 "시각 값의 정본은 shell/design-system"이라는 낡은 주석이 남아 있다.
- `packages/shell/renderer`: design을 import한다. sdk는 import하지 않는다(`tools/check-deps.ts`).
- 앱 UI build(`core/apps/releases/ui-build/build.ts`)는 `FIXED_UI_DEPENDENCIES`에 있는 package만 허용하고, release 때 사본을 bundle에 굳힌다. sdk package는 `sdk/<part>/<version>`에 read-only로 설치된다.
- `tools/wireframes`: `frames/compositions/` 22파일(약 3.2k줄)은 renderer를 import해 실제 코드를 그린다. 14파일(약 1.2k줄)은 wireframe에만 있는 코드다.
- `lophn-build-app` skill은 ui package나 token을 언급하지 않는다.

이미 있는 격리:
- 사용자 변경 → shell: import 방향(shell은 sdk를 모른다)과 read-only 설치.
- lophn update → 실행 중인 앱: release bundle에 굳은 사본.

## 바꿀 모양

```
tools/wireframes/                        화면 승인 (정본을 보는 곳)
  pages/kit/<분류>/                       kit component 상태별 페이지
  pages/screens/                         lophn 화면 페이지
  mock/                                  가짜 data
  drafts/                                승인 전 실험. CSS와 component 정의는 여기서만
        │ import만
        ▼
packages/design  ── 공개 kit. 앱에 @lophn/ui로 배포 ──────────▶ 사용자 앱
  tokens.ts                                                    · 판 고정 import
  components/<분류>/   primitives · layout · navigation         · 고치려면 해당 파일을
                       data · feedback · overlay · reading        앱 src로 복사해 소유
                       input
  components/<분류>/mod.ts  ← export마다 "언제 쓰나" 한 줄. 이게 목록
        │
        ▼ repo에서 직접 import
packages/shell/renderer  ── lophn 전용 부품과 화면 (model picker 등)

packages/sdk  ── cap-*, blueprint, 앱 bridge를 쓰는 UI만
                 (AppApiButton, AppErrorBoundary 등)
```

## 요구마다 무엇이 지키나

| 요구 | 장치 | 새로 만드나 |
|---|---|---|
| 1. wireframe이 정본 | gallery는 실제 component를 import만 한다. 복사본 없음 | 정리만 |
| 2. lophn이 kit 책임 | `packages/design` = kit | 없음 |
| 3. 사용자 수정, 서로 안 깨짐 | shell은 repo의 design만 본다. 앱은 판 고정 + release bundle 사본. 고치려면 파일을 앱으로 복사 | 없음. 복사 절차만 build-app skill에 한 줄 |
| 4. 범용성이 기준 | 위치가 곧 결정: 범용은 design, lophn 전용은 renderer | 옮기기만 |
| 5. 최소 비용, 동기화 검증 | 처음부터 최종 위치에 쓴다. 아래 check 셋 | check 셋 |
| 6. 발견성 | 분류 폴더 + 분류별 `mod.ts`의 한 줄 문서. build-app skill에 분류 이름 8개만 push | 정리만 |

## check 셋

1. `tools/wireframes`에서 `drafts/` 밖에 CSS 파일이 없다. 스타일을 새로 쓰는 순간이 component를 새로 만드는 순간이라, "복사본 금지"를 가장 단순하게 잡는다.
2. design의 모든 export가 `pages/kit`에 한 번은 나온다. 승인되지 않은 kit 부품을 잡는다.
3. design의 모든 component가 분류 폴더 안에 있고, `mod.ts`에 한 줄 문서가 있다.

import 방향(shell은 sdk를 모르고, design은 renderer를 모른다)은 이미 `check-deps`가 본다.

## 지금에서 바꿀 것

| 지금 | 바꿈 |
|---|---|
| sdk `ui-*` 10개가 design을 골라 재export | 지우고 design을 `@lophn/ui`로 배포. 분류는 sub-path(`@lophn/ui/overlay`). `FIXED_UI_DEPENDENCIES`도 같이 고친다 |
| sdk `ui-layout`, `ui-filter`, `ui-state`의 범용 부품(AppShell, Sidebar, FilterBar…) | design의 분류 폴더로 |
| 앱 bridge를 쓰는 부품(AppApiButton, AppErrorBoundary) | sdk에 하나로 남김 |
| design 안의 lophn 전용 부품 | renderer로 (하나씩 판정) |
| design `components/` 평평한 약 40개 | 분류 폴더 8개로 |
| wireframe의 전용 코드 14파일 | 승인된 건 renderer나 design으로, 아닌 건 `drafts/`로 |
| `@lophn/chart`가 따로 있음 | design의 `data/` 분류로 합침 |

## 하지 않는 것

preview, slot, shell theme, eject CLI, token override 공식화, 앱 CSS 검사. 사용자가 복사해 간 파일은 사용자 것이다.

## 열 때 먼저 할 판단

design의 약 40개 component를 하나씩 "분류 8개 중 어디"와 "범용인가, lophn 전용인가"로 나누는 표. 표가 나오면 나머지는 대부분 기계적인 이동이다.
