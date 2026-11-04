# extension-core

extension 단위의 바탕: manifest를 읽는 registry, 켜진 것만 load하는 loader, 설정 키, 판 검사.

- 단위: extension (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - 새 `packages/protocol/extensions/**`
  - 새 `packages/shell/main/extensions/**`, shell main 조립 file 하나
  - `packages/protocol/config/declaration.ts` 쓰는 곳 중 설정 선언 file(`packages/core/config/setting-declarations.ts`)
  - `tools/check-deps.ts`(새 folder 규칙, `PACKAGE_DEPENDENCIES`)
  - `project-docs/boundary-catalog.yaml`, `project-docs/module-catalog.yaml`
- 읽을 것:
  - architecture: `project-docs/architecture/layers.md`, `coding-agent.md`
  - 선례: `packages/core/apps/packages/install.ts`(data root로 복사, sha256, 0444, 다시 해도 같음), `packages/coding-agent/harnesses/*`의 `.lophn-shared` 표시 file(자기가 쓴 것만 지운다), `packages/shell/main/build.ts`(esbuild 한 bundle)
  - 제품 결정: 계획 README 정한 것 1~4
- 계약:
  - 쓰는 것: `declareSetting`
  - 내놓는 것: manifest type `ExtensionManifest {id, name, description, version, entry, provides}`, `activate(ctx) / deactivate()`, ctx `{core, settings, spawn, clock, ids}`, 설정 `extensions.<id>.enabled`

## 할 일

1. protocol: manifest type과 판 규칙(제품 판과 같아야 한다).
2. shell main registry: manifest를 읽어 목록을 낸다(code를 load하지 않고). 켜진 것만 진입점을 load해 `activate`한다. 끄면 `deactivate`.
3. 설정 `extensions.<id>.enabled`(기본 false). 사람만 켠다.
4. 설치 표시: `<data>/extensions/<id>/`에 표시 file. 지우기는 extension이 쓴 file만.
5. esbuild bundle에서 extension 진입점은 따로 load되는 꼴로 둔다(본체 bundle에 묶여 늘 load되지 않게).

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "켰다가 끄고 지우면 data root가 처음과 같고 사람 file과 다른 설정은 그대로다"
  - "manifest 판이 제품 판과 다르면 켜지 않고, 꺼진 extension은 code를 load하지 않고 아무것도 등록하지 않는다"
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
