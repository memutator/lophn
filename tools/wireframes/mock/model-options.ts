// model 고르기의 규칙. catalog data(models-data.ts)만 읽고, model 이름으로 갈라지지 않는다.

/** 고른 model과 그 model의 option 값(축 id → 값). */
export interface ModelSelection {
  readonly model: string;
  readonly values: Readonly<Record<string, string>>;
}
