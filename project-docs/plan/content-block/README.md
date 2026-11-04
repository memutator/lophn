# content-block: call 본문과 답, 사람 입력을 content block으로

- 목표: protocol에 content block 하나를 두고 call 본문, call 답, 사람 메시지가 그것으로 오간다. 이미지는 `image.read` 없이 model에 image block으로 바로 간다(bare agent에는 `image.read`가 없다).
- 재료: `project-docs/products/roadmap/agent-platform.md` 단계 2(정한 것 4, 12, 13, 겹침 10·15). 코드 사실과 path는 task brief에 있다.
- 범위 밖: run 입력, workflow step 입력, report(글로 남는다). 받지 못하는 modality 거절(단계 4). session을 지울 때 image blob을 지우는 일(지금도 안 한다).
- 열 때: `remove-domain`의 `rd-layers`가 land한 뒤 연다. `cb-core`가 `prompt-assembly/`, `run-loop/`, `wiring/router.ts`를 고치고 remove-domain이 그 file을 wave 1~4에서 고친다.

## 정한 것

1. block은 MCP ContentBlock 꼴을 빌린다: `text {text}`, `image {mimeType, blob}`, `resource_link {uri, name, mimeType?, description?}`, `resource {uri, mimeType?, text}`. image는 bytes 대신 blob hash를 갖는다. content 상한(240 KiB)에 이미지가 안 들어가서다. runtime이 model에 보낼 때 bytes를 읽는다. (agent)
2. 사람 메시지에 붙인 이미지는 blob이 되고 image block으로 저장한다. `Attached image: ... image.read` 줄은 새로 만들지 않는다. 옛 메시지는 글 그대로 두고 `image.read`의 `attachment:`도 그대로다(소비한 메시지 body는 trigger가 막아 고칠 수 없다). (agent)
3. 넘길 것은 값으로 싣는다. agent는 `lophn call send|reply --image <path>`로 자기 session이 읽을 수 있는 file을 block으로 싣는다. 받는 쪽에 읽기 허락을 주지 않는다. (agent)
4. 받은 turn과 뒤 이력은 같은 bytes다. block을 싸는 함수는 하나다. 받은 이미지는 뒤 turn에도 그대로 싣고 하나에 4096 token으로 센다. 넘치면 지금의 자동 Compact가 맡는다. (agent)
5. `resource_link`·`resource`의 글은 본문과 같은 escape를 거쳐 tag 안의 글 줄이 되고, 이미지는 그 뒤 image part로 차례대로 간다. (agent)
6. redaction은 글(text, link, resource text)에만 한다. 이미지는 tool 결과 이미지처럼 거치지 않는다. 이미지를 못 받는 model에는 지금의 `IMAGE_OMITTED` 글이 간다. title, 검색, compact 요약에는 이미지 자리에 고정 글이 간다. (agent)

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `cb-core` | protocol block, 저장, router·recorder, prompt part, 네 packer, CLI `call` |
| 2 | `cb-screen` | composer, 메시지 목록, Agent 탭 source가 block을 쓴다. 첨부 줄 code를 지운다 |

## lead가 할 일

- `cb-core` merge 때: `architecture/agent-call.md`(본문, 같은 bytes), `agent-definition.md`(사람 메시지와 이미지, 입력 예산), `place-session.md`를 고친다.
- 다 끝나면: `agent-platform.md` 단계 2를 끝남으로 적고, change-log 열린 판에 동작과 결정을 적고, 계획 폴더를 지운다.
