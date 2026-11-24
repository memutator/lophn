// An .svg import is the file's text (svg-text-transformer.js).
declare module "*.svg" {
  const text: string;
  export default text;
}

declare module "*.png" {
  import type { ImageSourcePropType } from "react-native";
  const image: ImageSourcePropType;
  export default image;
}
