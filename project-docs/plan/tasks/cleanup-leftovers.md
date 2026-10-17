# cleanup-leftovers

앞 task들이 소유가 겹쳐 남겨 둔 죽은 칸, 닿지 않는 상태, 틀린 이유 주석을 지운다. 동작은 바꾸지 않는다.

- 단위: cleanup (wave 3)
- 선행: trust-view-error-signing, apps-large-changeset, dead-platform, harness-global-install, dead-agent, dead-contexts, annotation-target, apps-activation-no-retry. 모두 merged인 main에서 시작한다.
- 소유(이 task만 고친다):
  - `packages/protocol/apps/app-start.ts`, `packages/protocol/apps/calls/process-wire.ts`
  - `packages/protocol/apps/channel.ts`, `packages/protocol/apps/invocations.ts`
  - `packages/protocol/apps/activation/activation.ts`
  - `packages/core/apps/releases/activation/{queue,assembly}.ts`, `packages/core/apps/releases/commands.ts`
  - `packages/core/apps/releases/ui-build/{binaries,eval-blueprint}.ts`
  - `packages/shell/renderer/app-frame/app-detail/versions/versions-tab.tsx`
  - `packages/design/wording/catalog/app-space.ts`, `packages/design/wording/catalog/app-space.placeholders.ts`
  - `packages/protocol/coding-agent/cli-commands.ts`
  - `packages/core/lophn-agent/prompt-assembly/turn-prompt.ts`
  - `packages/protocol/projects/context-contract.ts`와 `outlineSourceSchema.format`을 쓰는 fixture·test
  - 위 칸을 쓰는 곳이 더 나오면 그 file(보고에 적는다)
- 읽을 것:
  - AGENTS.md "속도"의 위협 원칙(사용자 앱과 사람이 쓴 글은 공격자로 보지 않는다), "코드"의 "주석은 왜만"
  - `project-docs/issues/code-health.md`의 "사용자 앱을 공격자로 보는 장치와 문장"
  - `project-docs/plan/README.md`
- 계약:
  - 바꾸는 것: `appStartInputSchema.verify_key` 삭제, `ActivationPhase`의 `queued` 삭제, `signedConfirmProofSchema`(쓰는 곳이 없을 때) 삭제, `outlineSourceSchema.format`(값이 `markdown` 하나뿐이면) 삭제. 쓰는 쪽은 같은 변경에서 고친다.

## 할 일

1. `verify_key`: `protocol/apps/app-start.ts`의 칸과 `protocol/apps/calls/process-wire.ts`의 구조 분해(`verify_key: _verifyKey`)와 그 주석("옛 시작 입력에서 verify_key와 …")을 지운다. 서명은 `trust-view-error-signing`이 이미 지웠다.
2. `signedConfirmProofSchema`(`protocol/apps/channel.ts`)와 `invocations.ts`의 `proof` 칸: 이 proof를 만드는 곳이 있는지 `grep -rn "proof" packages/core packages/shell packages/sdk`로 확인한다. 만드는 곳이 없으면 schema와 칸, 그것을 받는 route 처리까지 지운다. 있으면 건드리지 않고 보고한다.
3. `ActivationPhase`의 `queued`(`protocol/apps/activation/activation.ts` 131줄 근처와 276줄의 `z.enum(["queued", "running"])`): `apps-activation-no-retry` 뒤로 닿지 않는다. 지우고 `core/apps/releases/activation/queue.ts`, `commands.ts`, renderer `versions-tab.tsx`의 분기와 wording `app-detail.note.applying-queued`를 지운다. `deno task wording`으로 placeholders를 다시 만든다.
4. 틀린 이유 주석을 고친다(코드는 그대로):
   - `core/apps/releases/ui-build/binaries.ts`, `eval-blueprint.ts`, `core/apps/releases/activation/assembly.ts`의 "앱 source(코드)는 신뢰하지 않으므로" → AI가 쓴 코드의 실수가 퍼지지 않게.
   - `protocol/coding-agent/cli-commands.ts`의 "source 위치"(annotation source 위치는 지웠다) → 지금 돌려주는 것(메모, component 겹, release, screenshot 파일 경로).
   - `core/lophn-agent/prompt-assembly/turn-prompt.ts`의 "program이 쓴 문장만 쓰고 앱이 쓴 글은 넣지 않는다"의 이유를 prefix cache(앞부분이 turn마다 같아야 cache가 맞는다)로.
5. `outlineSourceSchema.format`: `dead-contexts` 뒤 값이 `markdown` 하나뿐이면 칸을 지우고 fixture를 맞춘다. 둘 이상 남았으면 건드리지 않는다.
6. 마지막으로 `grep -rnE "신뢰하지 않|untrusted app|앱을 믿지" packages --include=*.ts`로 같은 framing이 더 남았는지 보고, 코드가 실수나 인터넷을 막는 것이면 이유만 고친다. 앱을 공격자로 보는 것만 막는 코드가 더 나오면 고치지 말고 보고한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음.
- 남지 않음: `grep -rnE "verify_key|applying-queued|\"queued\"" packages/protocol/apps packages/core/apps/releases packages/shell/renderer/app-frame packages/design/wording`이 0줄. `grep -rn "신뢰하지 않으므로" packages`가 0줄.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 안 쓰게 된 export
- 정한 것: 2, 5에서 지웠는지 남겼는지와 근거
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
