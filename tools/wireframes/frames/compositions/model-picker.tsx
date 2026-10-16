// model 고르기 조각. 그리는 일은 renderer의 model picker이고 agent 설정 화면이 같은 부품을 쓴다.
export {
  FavoritesContext,
  ModelField,
  ModelPicker,
  OptionAxes,
} from "../../../../packages/shell/renderer/conversation/model-picker/model-picker.tsx";

/** 별표 찍은 model. 찍은 순서 그대로 둔다(provider로 다시 묶지 않는다). */
export const FAVORITE_START: readonly string[] = ["GPT-6.1 Sol", "Sonnet 5.5"];
