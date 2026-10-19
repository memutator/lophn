# af-artifact-links

agent의 대화 글에 나온 artifact path를 link로 그리고, 누르면 artifact 탭을 연다. artifact 목록은 그 project의 목록(`artifacts/*/index.html`)이다. wave 1 wireframe `artifact-chat-link`를 renderer로 옮긴다.

- 단위: artifact-screen (wave 2)
- 선행: af-artifact-tab. 이 task는 그 task가 만든 `useArtifactList`와 `openArtifact`를 import하고 같은 `host.ts`·`use-tab-host-slices.ts`를 이어서 고친다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/message-list/message-body.tsx`
  - `packages/shell/renderer/conversation/message-list/message-body.module.css`
  - `packages/shell/renderer/conversation/message-list/artifact-text.tsx`
  - `packages/shell/renderer/conversation/agent-thread.tsx`
  - `packages/shell/renderer/conversation/agent-view.tsx`
  - `packages/shell/renderer/workspace/kinds/host.ts`
  - `packages/shell/renderer/workspace/use-tab-host-slices.ts`
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/artifact.md`의 "3. 대화와 prompt"(link: renderer가 대화 글에서 그 project의 artifact path를 찾아 link로 그린다. 누르면 artifact 탭이 열린다), 하지 않는 것("대화 안에 artifact를 live로 끼워 그리기"는 안 한다)
  - 본보기(화면): wave 1의 `tools/wireframes/drafts/artifact/`(`artifact-chat-link`, 옮길 코드), `conversation/message-list/message-body.tsx:28`(`Text`는 지금 `<p>{text}</p>`뿐이다. `MessageBody`가 `body.parts`의 text를 그린다), `conversation/agent-view.tsx:508`(`onOpenFile={host.openFile}`), `conversation/agent-thread.tsx:62`(`onOpenFile`), `workspace/kinds/host.ts`의 `AgentViewSlice`, `workspace/use-tab-host-slices.ts:140`(`openFile: (path) => openFile(hostRef.current(), path)`)
  - 계약: `packages/protocol/projects/artifact.ts`(`artifactMentions`, af-artifact-values), `renderer/artifact/use-artifact-list.ts`, `workspace/kinds/artifact.tsx`(`openArtifact`) — af-artifact-tab
  - 문구: 새 문구가 거의 없다(link의 tooltip 정도). 필요하면 `catalog/artifact.ts`에 key를 더한다(허용된 예외).
  - 스킬: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
- 계약:
  - 쓰는 것: `artifactMentions(text, names)`, `useArtifactList(project)`, `openArtifact`
  - 내놓는 것: `AgentViewSlice.artifacts: { names: readonly string[]; open(name: string): void; reload(): void }`

## 할 일

1. `host.ts`/`use-tab-host-slices.ts`: `AgentViewSlice`에 `artifacts`를 더한다. `names`는 `useArtifactList(project)`의 이름들, `open(name)`은 `openArtifact(hostRef.current(), project, name)`, `reload()`는 그 hook의 `reload`. 목록은 Agent 탭이 mount될 때 한 번 읽는다.
2. `artifact-text.tsx`: 글 하나와 `artifacts`를 받아 `artifactMentions`가 낸 구간을 link 모양 단추(`<a>`가 아니라 `button`, `@lophn/ui`의 link 모양이나 token 색 `--color-link`)로 바꾸고 나머지는 글로 그린다. 구간이 없으면 지금과 같은 `<p>`다. agent가 방금 만든 artifact도 그 대화에서 link가 되어야 하므로(roadmap "끝남 기준"), 글에 `artifacts/<slug>` 꼴인데 `names`에 없는 이름이 있으면 `artifacts.reload()`를 그 이름당 한 번 부른다(`ref`로 불렀던 이름을 기억한다. 목록이 갱신되면 같은 글이 다시 그려져 link가 된다).
3. `message-body.tsx`의 `Text`가 `ArtifactText`를 쓰게 하고, `agent-thread.tsx`·`agent-view.tsx`가 `host.artifacts`를 `MessageBody`까지 내려준다. 다른 part(`attached`, `app_card`)는 그대로다. 사람 말(`UserBody`)에도 같은 `Text`를 쓰므로 함께 link가 된다(사람이 쓴 path도 같은 artifact를 가리키면 된다).
4. 통로가 없는 창(artifact 목록을 못 읽는 mock)에서는 `artifacts`가 빈 목록이라 지금과 똑같이 그려진다.

## 끝남

- `deno task check`가 통과한다.
- `deno task wireframes`가 되고, `deno run -A packages/shell/renderer/build.ts`로 bundle이 선다.
- 위험 test: 없음(화면).
- 남지 않음: 직접 박은 문구가 없다(`deno run --allow-read tools/check-wording.ts`).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 사람 말에도 link를 그리는지, 목록을 읽는 때
- 넘길 줄: `host.ts`·`use-tab-host-slices.ts`는 domain-kinds, domain-place도 건드린다
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
