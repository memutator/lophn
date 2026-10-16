// Lophn Workspace가 읽는 통로. 팔레트의 project·앱 행만 있다. core route 이름은 core-source.ts만 안다.
// 모양은 outline.root에서 이 화면이 쓰는 field만 옮긴 것이다(contracts를 들이면 zod가 renderer bundle에 들어간다).

export type SourceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string };

interface Named {
  readonly id: string;
  readonly title: string;
}

/** 팔레트에서 고르는 project와 앱. */
export interface Catalog {
  readonly projects: readonly Named[];
  readonly apps: readonly Named[];
}

export interface LophnSource {
  catalog(): Promise<SourceResult<Catalog>>;
}
