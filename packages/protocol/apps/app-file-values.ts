// 앱 file의 한도와 내장 sample. 의존성이 없어 shell preload·main과 폰도 읽는다(route와 zod schema는 `app-files.ts`).
// 앱 file은 바뀌지 않는 bytes이고 이름은 그 내용의 sha256이다. 손잡이(handle)는 그 file을 가리키는 작은 JSON이다.

export const APP_FILE_MAX_BYTES = 64 * 1024 * 1024;
// 한 번의 route 호출이 나르는 조각. base64 JSON이 remote frame(16 MiB)에 든다.
export const APP_FILE_PIECE_MAX_BYTES = 8 * 1024 * 1024;

export const APP_FILE_HASH = /^[0-9a-f]{64}$/;

export type AppFileHandle = {
  file: string;
  type: string;
  size: number;
  name?: string;
  width?: number;
  height?: number;
};

type Sample = { bytes_base64: string; handle: AppFileHandle };

// preview의 data 영역에 심고, 폰 기능의 preview stand-in이 가리키는 file 둘. 64x64 한 색 PNG와 짧은 글이다.
export const APP_FILE_SAMPLE_IMAGE: Sample = {
  bytes_base64:
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsOtlO0P7NoJvYbACS/W8FgEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQGBywLwQDGWcbO0gAAAAABJRU5ErkJggg==",
  handle: {
    file: "cbbcdf7be8b2d2fdb832a24ca950191bce72f653ad435b659f41e6df23476090",
    type: "image/png",
    size: 136,
    name: "sample.png",
    width: 64,
    height: 64,
  },
};

export const APP_FILE_SAMPLE_TEXT: Sample = {
  bytes_base64: "U2FtcGxlIGZpbGUgZnJvbSBsb3Bobi4K",
  handle: {
    file: "3bf5f3c7d20fe67235ec686c42e8149a8e73b0957bddabb311e5d8125b08e8f6",
    type: "text/plain",
    size: 24,
    name: "sample.txt",
  },
};

export const APP_FILE_SAMPLES = [
  APP_FILE_SAMPLE_IMAGE,
  APP_FILE_SAMPLE_TEXT,
] as const;
