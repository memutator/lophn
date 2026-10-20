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


## Anthropic 요청이 대화에 cache 표시를 달지 않아 긴 turn이 매 call 대화 전체를 cache 없이 낸다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금: `models/binding.ts`의 `anthropicPacker`는 "cache 표시는 system 층에 이미 있다"며 `buildRequest`의 경계를 모두 끈다(`final_user: false`). 그래서 cache 표시는 `prompt-assembly/layers.ts`의 system 층에만 붙고, tool을 오가며 길어지는 messages에는 붙지 않는다. model call마다 system과 tools만 cache로 읽히고 그 뒤 대화 전체는 cache 없는 input으로 매겨진다. 재현: App Engineer가 앱을 직접 짠 일회성 eval(`claude-sonnet-5-5`, model call 96번). input 2,648,568 중 cache_read 2,390,890, cache_write 662였다. call마다 system·tools 약 25k만 cache였고 대화 평균 약 27.6k는 매번 새로 매겨졌다. 같은 model의 Claude Code coding agent는 같은 앱을 만들 때 input 6.47M 가운데 cache 없는 input이 144였다.

영향: tool을 여러 번 부르는 turn일수록 돈이 크게 샌다. 위 run에서 App Engineer는 $5.97을 썼고 그중 약 $5.3이 cache 없는 대화 input이다. 같은 양을 cache로 읽었으면 $1 아래다. 앱 설계·검증처럼 짧은 turn도 call마다 대화가 다시 매겨진다.

고치려면:
- Anthropic 요청에서 마지막 message의 마지막 content block에 cache 표시를 단다(system 2개 + 대화 끝 1개, 상한 4개 안). 지금 `markLast`는 message 객체 자체에 다는데 API는 content block의 표시만 본다(작음). **추천.**
- 대화 중간에도 일정 간격으로 표시를 단다(중간. 대화가 cache 최소 길이보다 짧을 때와 표시 개수 상한을 같이 다뤄야 한다).
