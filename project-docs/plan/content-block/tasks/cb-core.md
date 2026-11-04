# cb-core

protocol에 content block을 두고 call 본문·답과 사람 메시지가 block으로 저장되어 model까지 간다. 이미지는 blob hash로 저장하고 runtime이 bytes를 읽어 provider image block으로 싣는다.

- 단위: core (wave 1)
- 선행: 없음. remove-domain의 `rd-layers`가 land한 뒤 연다(README "열 때").
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{content-block,message-content,calls,inputs,messages,received-messages,message-images,mod}.ts`
  - `packages/core/lophn-agent/session/**`, `packages/core/lophn-agent/places/messages.ts`, `packages/core/lophn-agent/message-images.ts`
  - `packages/core/router/**`, `packages/core/main/daemon/wiring/router.ts`
  - `packages/core/lophn-agent/run-loop/{input-text,history,turn,core-ports,prepare,ports,inbox}.ts`(+test)
  - `packages/core/lophn-agent/prompt-assembly/{model,summary,layers,budget}.ts`(+test)
  - `packages/core/lophn-agent/models/binding.ts`, `packages/core/lophn-agent/providers/adapters/{messages,responses,chat-completions,cloud-code,claude-code,codex}.ts`(+test)
  - `packages/core/main/agent-runtime/turn-source-link.ts`
  - `packages/cli/commands/call.ts`, `packages/core/lophn-agent/tools/lophn/**`(`call` 도움말만)
- 읽을 것:
  - architecture: `project-docs/architecture/agent-call.md`, `project-docs/architecture/agent-definition.md`(입력 예산, cache)
  - 선례: `packages/core/apps/annotations/blobs.ts`(screenshot blob 선언), `packages/core/lophn-agent/models/binding.ts`의 `tool_result_image`와 `IMAGE_OMITTED`
  - 제품 결정: 계획 README 정한 것 1~6
- 계약:
  - 쓰는 것: blob store(prepare 16 MiB)
  - 내놓는 것: `contentBlockSchema`(`protocol/lophn-agent/content-block.ts`), `SendMessage.content`·`SendCall.body`·`ReplyCall.body`·envelope `body`가 block 배열, 저장 part kind `image`·`resource_link`·`resource`. `cb-screen`이 쓴다.

## 할 일

1. protocol: `content-block.ts`에 block schema(정한 것 1, mime은 png·jpeg·gif·webp). `calls.ts`의 `body: z.string()`(send, reply, envelope)과 `inputs.ts` `SendMessage.content`를 block 배열로 바꾼다. `message-content.ts`에 part kind를 더한다(`schema_version` 1 그대로, 옛 text blob은 그대로 읽힌다). `attachmentImageLine`은 쓰는 곳(renderer)이 `cb-screen`에서 지우므로 여기서는 남긴다.
2. 저장: router(`core/router/**`)와 받은 메시지 recorder가 block을 part로 쓴다. 이미지는 blob으로 prepare한다(screenshot 선례). call body preparer는 글 block만 redaction한다. column을 더하지 않으면 ledger step이 없다. 더하면 새 step id.
3. prompt: 받은 메시지와 사람 메시지를 part 목록(tag 여는 글, 글 줄, image part, 닫는 글)으로 만드는 함수 하나(`run-loop/input-text.ts`). 받은 turn과 이력 재생(`session/history.ts`)이 같은 함수를 쓴다. `HistoryPart`·prompt model에 사용자 image part. `wireSize`·`session/context.ts` `tailTokens`가 그것을 4096으로 센다. title·검색·compact는 고정 글.
4. image bytes: runtime이 blob hash로 bytes를 읽는 길(지금 runtime child는 body만 읽는다). machine 읽기 하나를 더하고 그 session의 메시지에 걸린 blob만 읽게 한다.
5. packer 넷(`binding.ts`): Anthropic은 user content의 `image` block, Responses·Codex는 message content의 `input_image`, Chat Completions는 image가 있을 때 user content 배열, Cloud Code는 `inlineData`. `images:false`면 `IMAGE_OMITTED`.
6. CLI `call send|reply`: `--body` 글은 text block 하나. `--image <path>`는 그 session이 읽을 수 있는 file을 image block으로 싣는다(지금의 file 읽기 검사).

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "image가 든 call의 받은 turn part와 뒤 이력 재생 part가 같다"(`input-text_test.ts`를 넓힌다)
  - "아직 시작 안 한 사람 메시지의 image block이 재시작 뒤 같은 bytes로 입력함에 돌아온다"
  - "session A가 보낸 image를 받은 session B는 A의 `attachment:`를 읽지 못한다"
  - "네 packer에서 같은 입력 두 번이 같은 wire JSON이고, `images:false`면 `IMAGE_OMITTED`다"
- 남지 않음: `grep -rn "body: z.string()" packages/protocol/lophn-agent/calls.ts`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
