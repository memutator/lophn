// 앱 템플릿의 파일 묶음과 내용 hash. 템플릿은 상대 경로와 byte의 묶음이고 별도 상태가
// 없다. hash는 경로 순으로 정렬한 묶음의 sha256이며 설치 SDK 묶음과 같은 byte 규칙을 쓴다.
import type { SourceFile } from "../vendor.ts";

export type TemplateFile = SourceFile;

export type TemplateFailure = {
  code: "invalid_input" | "not_found" | "unavailable";
  message: string;
};

// 저장소의 템플릿 원본 폴더. 파일 이름 끝의 `.tmpl`은 저장소 도구(fmt·lint·check·test)가 템플릿 소스를
// 앱으로 읽지 않게 하는 표시이고, 설치와 앱 만들기는 이 접미를 뗀다.

// 앱 템플릿이 반드시 가지는 파일. 이것이 빠진 폴더는 템플릿이 아니다.

// 폴더의 파일을 읽는다. symlink와 `..` 경로는 읽지 않는다.

// 내장 템플릿. 저장소 원본에서 접미를 떼어 읽는다.
