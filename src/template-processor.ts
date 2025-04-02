import type {
  AttributeMetadata,
  ComponentMetadata,
  ContentMetadata,
  EventMetadata,
  EventNames,
  ProcessedTemplate,
} from './types';
import assert from 'assert/strict';

const EVENT_REGEX = /(on[A-Z][a-zA-Z]*):/;
const ATTRIBUTE_REGEX = /([a-zA-Z]+)="/;

const createPlaceholderComment = (index: number): string =>
  `<--placeholder-${index}-->`;

export class TemplateProcessor {
  public process(
    staticStrings: TemplateStringsArray,
    expressions: unknown[],
  ): ProcessedTemplate {
    assert(staticStrings.length > 0, 'Static strings array cannot be empty');
    assert(expressions.length > 0, 'Expressions array cannot be empty');
    assert(
      staticStrings.length === expressions.length + 1,
      'Invalid template structure',
    );

    const processedTemplate: ProcessedTemplate = {
      staticHtml: '',
      dynamicParts: [],
    };

    this.processExpressions(staticStrings, expressions, processedTemplate);
    processedTemplate.staticHtml +=
      staticStrings[expressions.length]?.trim() ?? '';

    return processedTemplate;
  }

  private processExpressions(
    staticStrings: TemplateStringsArray,
    expressions: unknown[],
    processedTemplate: ProcessedTemplate,
  ): void {
    for (let i = 0; i < expressions.length; ++i) {
      const staticString = staticStrings[i]?.trim();
      const expression = expressions[i];

      assert(staticString, 'Invalid HTML segment');

      const dynamicPart = this.createDynamicPart(i, staticString, expression);

      processedTemplate.staticHtml += `${staticString}${createPlaceholderComment(i)}`;
      processedTemplate.dynamicParts.push(dynamicPart);
    }
  }

  private createDynamicPart(
    index: number,
    staticString: string,
    expression: unknown,
  ): ComponentMetadata {
    if (EVENT_REGEX.test(staticString)) {
      return this.createEventMetadata(index, staticString, expression);
    } else if (ATTRIBUTE_REGEX.test(staticString)) {
      return this.createAttributeMetadata(index, staticString, expression);
    } else {
      return this.createContentMetadata(index, expression);
    }
  }

  private createEventMetadata(
    index: number,
    staticString: string,
    expression: unknown,
  ): EventMetadata {
    const eventName = staticString.match(EVENT_REGEX)?.[1];

    assert(eventName, 'Event name should exist');
    assert(
      typeof expression === 'function',
      'Event handler must be a function',
    );

    return {
      index,
      type: 'event',
      eventName: eventName as EventNames,
      value: expression as (event: Event) => void,
    };
  }

  private createAttributeMetadata(
    index: number,
    staticString: string,
    expression: unknown,
  ): AttributeMetadata {
    const match = staticString.match(ATTRIBUTE_REGEX);
    const attributeName = match?.[1];

    assert(attributeName, 'Attribute name should exist');

    return {
      index,
      type: 'attribute',
      attributeName,
      value: expression,
    };
  }

  private createContentMetadata(
    index: number,
    expression: unknown,
  ): ContentMetadata {
    return {
      index,
      type: 'content',
      value: expression,
    };
  }
}
