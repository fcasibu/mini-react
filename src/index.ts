import { TemplateProcessor } from './template-processor';

const processor = new TemplateProcessor();

export function html(
  staticStrings: TemplateStringsArray,
  ...expressions: unknown[]
) {
  return processor.process(staticStrings, expressions);
}

console.log(
  html`<button type="${'button'}" onClick:${() => undefined}>${123}</button>`,
);

