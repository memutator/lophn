# @lophn/format-document

## 목적

내장 document format의 선언을 앱이 읽게 내보내는 Package다(documents Q10).
구성은 이름·media type 목록·구조·metadata 요구·template·guide·vocabulary·
FormatRef의 정확한 module hash뿐이다(apps/sdk#R2). 검사 코드는 없다 — 검사는
core 밖 격리 환경에서 돌는 `/v1/formats/validate`만 한다(documents/formats#R18).

## 공개 API와 type

```ts
import {
  DOCUMENT_MEDIA_TYPES,
  DOCUMENT_MODULE_HASH,
  documentFormat,
  documentFormatRef,
} from "@lophn/format-document";
```

- `documentFormat` — document format 선언 전체이다(선언 이름 `document`).
- `documentFormatRef` — document의 `FormatRef` 기본 값이다(name·module_hash;
  `explicit`은 저장 결과가 정한다).
- `DOCUMENT_MODULE_HASH` — documents#T4 bundle.js 묶음의 sha256이다.
- `DOCUMENT_MEDIA_TYPES` — document가 지원하는 다섯 media type이다
  (documents/formats#R2).

## 요구 permission

없다. 데이터 선언뿐이라 접근을 하지 않는다. Zod를 끌어오는 contracts 파일도
import하지 않는다(SDK는 앱 bundle에 그대로 들어간다).

## peer 의존

정확한 peer는 없다(단독 사용).

## pdf·image·data

pdf·image·data는 원문 format이다 — 원문 바이트 보존·version·읽기만 하고 section
추출이 없으므로(apps#T29 완료 기준 documents 팀 추천) Package를 만들지 않는다.
이 Package는 document 하나만 내보낸다.

## 예제

```ts
import { documentFormat, documentFormatRef } from "@lophn/format-document";

// app blueprint으로 document 원문을 저장할 때의 format 참조다.
const format = {
  name: documentFormatRef.name,
  module_hash: documentFormatRef.module_hash,
  explicit: true,
};

// 선언은 media type·구조·template·guide를 읽는 데 쓴다.
console.log(documentFormat.media_types);
```

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 선언 필드·media type 추가다(documents/formats의
  declaration이 먼저 바뀐다).
- **major**: 선언 내용의 제거나 변경, module hash의 교체다. documents/formats의
  선언이 바뀌면 이 Package가 같이 올라간다.
