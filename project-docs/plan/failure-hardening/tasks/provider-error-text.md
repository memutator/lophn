# provider-error-text

provider가 거절한 turn의 실패 문구가 원인(사용량 한도, 로그인 거절, rate limit)을 말하게 한다. 지금은 셋 다 "모델이나 provider를 지금 쓸 수 없다"로 보인다.

- 단위: provider (wave 1)
- 선행: 없음. `provider-failures`의 429 분류와 소유가 겹치지 않는다(분류가 고쳐지면 문구가 더 맞게 나온다).
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/wiring/{acp-build,acp-build_test}.ts`
  - `packages/protocol/acp/items.ts`
  - `packages/shell/renderer/conversation/thread/provider-error.tsx`
  - `packages/shell/renderer/conversation/agent-tab-source.ts`(`ThreadProviderError.evidence` type만)
  - `packages/design/i18n/catalog/conversation.ts`
- 읽을 것:
  - 계획 README "정한 것"의 429 줄과 실패 문구 줄
  - architecture: `project-docs/architecture/agent-definition.md` "경계와 계약"의 turn 실패 이유
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `acp`. `project-docs/module-catalog.yaml`의 `packages/core/main`, `packages/shell/renderer`
- 계약:
  - 쓰는 것: 실패한 call의 `ModelOutcome.http_status`(`model_calls.outcome`에 이미 저장된다).
  - 내놓는 것: ACP error notice의 `evidence`에 optional `http_status: number | null`. 지금 `evidence`를 내는 곳은 `acp-build.ts` 하나다(harness-gui는 내지 않는다).

## 할 일

1. **실패 원인 문구(loop #38).** 지금 `provider-error.tsx`는 `configuration_unavailable`이면 늘 "모델이나 provider를 지금 쓸 수 없다"다. 실패한 call의 `http_status`는 저장돼 있지만(`model_calls.outcome`) 화면에 오지 않는다.
   - `items.ts`: error notice `evidence`에 `http_status: z.number().int().nullable().optional()`.
   - `acp-build.ts` `failureEvidence`: `model_error`, `model_attempt_limit`에 더해 `configuration_unavailable`도 본다. 마지막 실패 call의 `http_status`를 싣는다.
   - `agent-tab-source.ts`: `ThreadProviderError.evidence` type에 그 칸을 더한다(`thread-layout.ts`는 `notice.evidence`를 그대로 넘기므로 고치지 않는다).
   - `provider-error.tsx`: 문구를 아래 표로 고른다. 표에 없으면 지금 그대로다. [Retry]와 지금의 key 단추는 건드리지 않는다.

     | 이유 | 근거 | 문구 key |
     |---|---|---|
     | `configuration_unavailable` | `http_status`가 402·429 | `conversation.error.turn-usage-limit` |
     | `configuration_unavailable` | `http_status`가 401·403 | `conversation.error.turn-sign-in-rejected` |
     | `model_error`·`model_attempt_limit` | `http_status`가 429 | `conversation.error.turn-rate-limited` |

   - `conversation.ts`: 위 셋의 영어 문구를 더한다. 예: "This provider's usage limit is reached. Check your plan or billing, or pick another model below.", "The provider rejected the key or sign-in. Enter the key again, or sign in again in Settings → Providers.", "The provider is limiting requests right now. Wait a moment, then retry." `packages/design`의 판은 올리지 않는다(catalog 문구만 더하는 일은 앞서도 판 없이 했다).

## 정한 것

- [Retry]는 숨기지 않는다. 결제하거나 key를 고친 사람은 그 자리에서 다시 하고 싶고, 헛도는 요청 하나는 provider가 바로 거절해 비용이 없다.
- quota 상태를 남겨 보내기 전에 막는 일(loop #16)은 하지 않는다. provider가 reset 시각을 주지 않으면 결제한 뒤에도 막히게 된다. `project-docs/products/roadmap/failure-hardening.md`에 있다. 그래서 `RecordProviderAvailability`, `credentialUsable`, `models/resolve.ts`는 건드리지 않고 `until`도 싣지 않는다.

## 끝남

- `npm run check`가 통과한다. renderer를 고쳤으므로 `node packages/shell/renderer/build.ts`도 된다.
- 위험 test(`packages/core/main/daemon/wiring/acp-build_test.ts`): "configuration_unavailable로 끝난 turn의 error notice는 실패 call의 http_status를 싣는다"
- 남지 않음: 없음.

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴(바꾼 file, 통과한 check, 등록할 것, 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청, **무겁게 짠 것**, **알려진 미완 동작**).

- 등록할 것: lead가 `project-docs/flows/areas/`의 화면 flow에 문구 규칙을 적는다.
