import type {
  AttributeMetadata,
  ContentMetadata,
  EventMetadata,
  MountedComponentInstance,
  ProcessedTemplate,
} from './types';
import { assert } from './utils/assert';

export class Renderer {
  public mount(
    processedTemplate: ProcessedTemplate,
    container: HTMLElement,
  ): MountedComponentInstance {
    const mountedInstance: MountedComponentInstance = {
      id: crypto.randomUUID(),
      container,
      processedTemplate,
      rootNodes: [],
      dynamicNodeMap: new Map(),
      eventListenerMap: new Map(),
      childInstanceMap: new Map(),
    };

    const templateElement = document.createElement('template');
    templateElement.innerHTML = processedTemplate.staticHtml;
    const fragment = templateElement.content;

    const nodesToProcess = this.collectNodesToProcess(fragment);

    for (const node of nodesToProcess) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        this.processElement(node as Element, mountedInstance);
      } else if (node.nodeType === Node.COMMENT_NODE) {
        this.processComment(node as Comment, mountedInstance);
      }
    }

    mountedInstance.rootNodes = Array.from(fragment.childNodes);
    container.appendChild(fragment);

    return mountedInstance;
  }

  private collectNodesToProcess(fragment: DocumentFragment): Node[] {
    const walker = document.createTreeWalker(
      fragment,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT,
      {
        acceptNode: (node: Node) =>
          (node.nodeType === Node.COMMENT_NODE &&
            node.textContent?.startsWith('placeholder-')) ||
          node.nodeType === Node.ELEMENT_NODE
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT,
      },
    );

    const nodes: Node[] = [];
    let currentNode: Node | null;
    while ((currentNode = walker.nextNode())) {
      nodes.push(currentNode);
    }
    return nodes;
  }

  private processElement(
    element: Element,
    mountedInstance: MountedComponentInstance,
  ): void {
    const attributes = Array.from(element.attributes);
    for (const attr of attributes) {
      if (!attr.value.startsWith('placeholder-')) continue;

      const index = parseInt(attr.value.substring('placeholder-'.length), 10);
      assert(
        !isNaN(index),
        `invalid placeholder index in attribute: ${attr.value}`,
      );

      const part = mountedInstance.processedTemplate.dynamicParts.find(
        (p) => p.index === index,
      );

      if (!part) {
        element.removeAttribute(attr.name);
        continue;
      }

      switch (part.type) {
        case 'attribute': {
          this.applyAttributePart(
            element,
            attr,
            part as AttributeMetadata,
            mountedInstance,
          );
          break;
        }
        case 'event': {
          this.applyEventPart(
            element,
            attr,
            part as EventMetadata,
            mountedInstance,
          );
          break;
        }
        default: {
          element.removeAttribute(attr.name);
        }
      }
    }
  }

  private applyAttributePart(
    element: Element,
    attr: Attr,
    part: AttributeMetadata,
    mountedInstance: MountedComponentInstance,
  ): void {
    element.setAttribute(part.attributeName, String(part.value));
    if (attr.name !== part.attributeName) {
      element.removeAttribute(attr.name);
    }
    mountedInstance.dynamicNodeMap.set(part.index, element);
  }

  private applyEventPart(
    element: Element,
    attr: Attr,
    part: EventMetadata,
    mountedInstance: MountedComponentInstance,
  ): void {
    const eventName = part.eventName.startsWith('on')
      ? part.eventName.substring(2)
      : part.eventName;
    const handler = part.value as EventListener;
    element.addEventListener(eventName, handler);
    element.removeAttribute(attr.name);
    mountedInstance.eventListenerMap.set(part.index, {
      element,
      eventName,
      handler,
    });
    mountedInstance.dynamicNodeMap.set(part.index, element);
  }

  private processComment(
    comment: Comment,
    mountedInstance: MountedComponentInstance,
  ): void {
    const placeholderText = comment.textContent;
    if (!placeholderText?.startsWith('placeholder-')) return;

    const index = parseInt(
      placeholderText.substring('placeholder-'.length),
      10,
    );
    assert(
      !isNaN(index),
      `Invalid placeholder index in comment: ${placeholderText}`,
    );

    const part = mountedInstance.processedTemplate.dynamicParts.find(
      (p) => p.index === index && p.type === 'content',
    ) as ContentMetadata | undefined;
    if (!part) {
      comment.remove();
      return;
    }

    this.applyContentPart(comment, part, mountedInstance);
  }

  private applyContentPart(
    comment: Comment,
    part: ContentMetadata,
    mountedInstance: MountedComponentInstance,
  ): void {
    const parent = comment.parentNode;
    if (!parent) {
      console.error('Comment node has no parent.', comment);
      return;
    }

    const value = part.value;
    if (value instanceof Node) {
      parent.replaceChild(value, comment);
      mountedInstance.dynamicNodeMap.set(part.index, value);
    } else if (this.isProcessedTemplate(value)) {
      const childInstance = this.mount(
        value as ProcessedTemplate,
        parent as HTMLElement,
      );
      mountedInstance.childInstanceMap.set(part.index, childInstance);
    } else if (Array.isArray(value)) {
      const childElement = document.createElement('div');

      const childInstances: MountedComponentInstance[] = [];
      for (const item of value) {
        if (this.isProcessedTemplate(item)) {
          const itemInstance = this.mount(
            item as ProcessedTemplate,
            childElement,
          );
          childInstances.push(itemInstance);
        } else {
          parent.appendChild(document.createTextNode(String(item)));
        }
      }
      parent.replaceChild(childElement, comment);
      if (childInstances.length > 0) {
        mountedInstance.childInstanceMap.set(part.index, childInstances);
      }
    } else if (value !== null && value !== undefined) {
      const textNode = document.createTextNode(String(value));
      parent.replaceChild(textNode, comment);
      mountedInstance.dynamicNodeMap.set(part.index, textNode);
    } else {
      const emptyTextNode = document.createTextNode('');
      parent.replaceChild(emptyTextNode, comment);
      mountedInstance.dynamicNodeMap.set(part.index, emptyTextNode);
    }
  }

  private isProcessedTemplate(value: unknown): value is ProcessedTemplate {
    return (
      typeof value === 'object' &&
      value !== null &&
      'staticHtml' in value &&
      'dynamicParts' in value
    );
  }
}
