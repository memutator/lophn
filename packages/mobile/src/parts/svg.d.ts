// An .svg import is the file's text (svg-text-transformer.js).
declare module "*.svg" {
  const text: string;
  export default text;
}
