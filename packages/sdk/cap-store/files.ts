// 앱 file의 handle 모양과 한도다. 앱 file은 바뀌지 않는 bytes이고 이름은 그 내용의 sha256이다.
// protocol/apps/app-file-values.ts·core/apps/app-files/store.ts와 같은 규칙이다(SDK는 protocol과 core를 import할 수 없어 사본으로
// 둔다. 같은지는 core/apps/app-files/parity_test.ts가 본다).

export const APP_FILE_MAX_BYTES = 64 * 1024 * 1024;
export const APP_FILE_TYPE_MAX_CHARS = 127;
export const APP_FILE_NAME_MAX_CHARS = 255;
export const APP_FILE_HASH = /^[0-9a-f]{64}$/;

// operation의 입력·출력, DB row, 화면을 그대로 지나가는 작은 JSON이다.
export type AppFileHandle = {
  file: string;
  type: string;
  size: number;
  name?: string;
  width?: number;
  height?: number;
};

export type AppFileMeta = { type: string; name?: string };

export type AppFileOptions = {
  // 앱 data 영역. 기본은 lophn이 앱 process에 준 영역이다.
  dataPath?: string;
};
