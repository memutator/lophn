declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}

declare module "*.svg" {
  const markup: string;
  export default markup;
}
