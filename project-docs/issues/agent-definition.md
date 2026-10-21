# agent-definition

agent 정의와 turn 조립(지침, tool, skill, place 정보, cache)에 걸린 열린 이슈. 흐름과 불변 조건은 `project-docs/architecture/agent-definition.md`.

## 파일 읽기가 pdf와 이미지 말고 docx 같은 형식을 못 읽는다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금: `packages/core/lophn-agent/tools/file/read.ts`는 UTF-8 텍스트만 읽고, 아니면 pdf/이미지는 각 tool을 안내하고 나머지는 `not a UTF-8 text file`로 거절한다. pdf는 `packages/core/lophn-agent/tools/file/pdf.ts`(`unpdf`), 이미지는 `packages/core/lophn-agent/tools/file/image.ts`뿐이다. docx, xlsx 등의 reader는 없다.

영향: 사람이 place 폴더에 둔 docx 문서를 agent가 읽지 못한다. 사람이 텍스트로 바꿔 줘야 한다.

고치려면: 필요한 형식마다 reader를 더한다(`unpdf`처럼 의존성 하나를 판 고정으로 들이고 쓸 때만 불러온다). 형식을 하나씩 늘리는 것은 비용이 작지만 의존성이 는다. 추천: 쓰는 형식(docx)부터 하나만.

정한 것: 필요해지는 형식 하나씩만 더한다.

## Agents 탭의 Instructions 카드가 LOPHN.md 내용을 늘 비워 보인다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/shell/ipc]
```

지금: Agents 탭의 Instructions 카드(`packages/shell/renderer/workspace/agents/agents-tab.tsx` 132의 미리보기)는 `core-source.ts`의 `instructionsOf`가 `core-extensions.ts`의 `readInstructions`로 채운다. `readInstructions`는 `instructions.open`(`packages/shell/ipc/instructions.ts`)으로 document와 version을 받은 뒤 `link.worker("documents", "read", …)`를 부른다. `documents.read` route는 protocol에 없고, main의 allowlist(`packages/shell/main/desktop/core/allowlist.ts`)는 `worker` 종류를 받지 않으며, core의 worker route 종류도 지웠다(changelog 0.6.0). 그래서 실패를 `""`로 삼키고 카드는 늘 빈 미리보기다. renderer의 `Link.worker`(`core-link.ts` 29·43·59·73)와 IPC kind의 `"worker"`(`packages/shell/ipc/core.ts` 13)도 이것 하나 때문에 남았다.

영향: 사람이 Agents 탭에서 project 지침이 비어 있는 줄 안다. 실제로는 그 project의 모든 agent prompt에 LOPHN.md가 실린다(`instructions.get`). [Edit]으로 열면 내용이 있다.

고치려면:
- [Edit]이 여는 길(`instructions.open`이 주는 `path`)의 본문을 shell main이 읽어 돌려주게 하고 `Link.worker`와 `"worker"` kind를 지운다(작음). **추천.** 지침 본문을 읽는 user route(`instructions.preview`)는 전역 층만 받아, project 층을 더하면 core route를 넓혀야 한다.
- core `instructions.preview`에 `layer: "project"`와 `place`를 더한다(중간. route와 actor 판정을 같이 고친다).
