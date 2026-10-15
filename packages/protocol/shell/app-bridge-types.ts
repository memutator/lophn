// apps SDK가 import하는 portable entry. Zod·platform runtime을 싣지 않는다.
// schema 정본은 app-bridge.ts이고, 이 타입은 그 입력과 같게 테스트로 맞춘다.

export const EXTERNAL_URL_MAX_CHARS = 8192;

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export type LophnApp = {
  call(api: string, input: Json): Promise<unknown>;
  openExternal(url: string): Promise<void>;
};
