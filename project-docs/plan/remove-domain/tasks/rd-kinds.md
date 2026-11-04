# rd-kinds

kind 기능(`kinds.yaml`, kinds worker, `kind.*` 명령, 위반 알림, `kinds_changed` notice, place 정보 Kinds 절)을 대체 없이 지운다. domain은 건드리지 않는다.

- 단위: kinds (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/projects/{kinds-file,kinds-file_test,kinds-api,kinds-work,mod}.ts`
  - `packages/protocol/lophn-agent/{kind-text,input-tags,skill-settings}.ts`
  - `packages/protocol/events/transient.ts`
  - `packages/core/projects/kinds/**`, `packages/core/projects/register.ts`
  - `packages/core/main/worker/main.ts`, `packages/core/main/daemon/wiring/kinds.ts`, `packages/core/main/daemon/assembly.ts`
  - `packages/core/lophn-agent/prompt-assembly/**`, `packages/core/lophn-agent/run-loop/prepare.ts`
  - `packages/core/agent-places/place/{place-info,place-data}.ts`, `packages/core/agent-places/credentials.ts`, `packages/core/agent-places/skills/write-kinds/`
  - `packages/cli/commands/{kind,mod}.ts`
  - `packages/shell/renderer/desktop/connection/events/reactions.ts`, `packages/design/i18n/catalog/data.ts`
  - `tests/e2e/kinds_test.ts`, `tests/eval/restore/kinds.ts`, `tests/eval/materials/tax-kinds/`, `tests/eval/registry/` 중 kind 항목
- 읽을 것:
  - architecture: `project-docs/architecture/kinds.md`(지우는 동작의 자리)
  - 제품 결정: `project-docs/products/roadmap/agent-platform.md` 정한 것 7
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음

## 할 일

1. 지운다: `core/projects/kinds/**`(check, extract, host, index, query, worker), `core/main/daemon/wiring/kinds.ts`, worker entry(`KINDS_WORKER_KIND`, `runKindsWorker`), `protocol/projects/kinds-*`, `protocol/lophn-agent/kind-text.ts`, `prompt-assembly/kind-text.ts`, `cli/commands/kind.ts`, 내장 skill `write-kinds`.
2. 고친다: `assembly.ts`와 `projects/register.ts`의 kinds 등록, transient event `KindViolationFound`와 renderer toast·i18n `waiting.toast-kind-violation.*`, notice `kinds_changed`(`input-tags.ts`, `turn-prompt.ts`), `SeenBasis`의 `kinds`(`basis.ts`, `prepare.ts`, memory에만 있어 migration 없음), place 정보 `kindLines`·`PlaceData.kinds`, credential `kindGet`.
3. derived DB `<data>/derived/kinds.sqlite`를 더 만들지 않는다. 남은 file은 `rd-domains`의 마지막 data step이 지운다.
4. kind test와 eval 자료(`tests/e2e/kinds_test.ts`, `restore/kinds.ts`, `materials/tax-kinds`, registry의 `kind.*` tool·`write-kinds`·`kinds-yaml` skill)를 지운다. scenario O6가 kind에 기대면 그 기대 줄을 지운다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rnE "kinds\.yaml|KindViolation|kinds_changed|kind\.(list|check)|kindGet|write-kinds" packages tests tools`가 0줄이다(wireframes는 `rd-domains`).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴(바꾼 file, check, 등록할 것, 정한 것, 넘길 줄, 계약 바꾸기 요청, 무겁게 짠 것, 알려진 미완 동작).
