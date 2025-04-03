import { FrameworkOrchestrator } from './framework-orchestrator';
import { StateManager } from './state-manager';
import type {
  ComponentDefinition,
  MountedComponentInstance,
  ProcessedTemplate,
  ComponentMetadata,
  AttributeMetadata,
  EventMetadata,
  ContentMetadata,
} from './types';

export class Renderer {
  constructor(
    private readonly frameworkOrchestrator: FrameworkOrchestrator,
    private readonly stateManager: StateManager,
  ) {}

  public mount(
    componentDefinition: ComponentDefinition,
    containerElement: HTMLElement,
    placeholderNode?: Node | null,
  ): MountedComponentInstance {
    const { componentFunction, props } = componentDefinition;
    const instanceId = crypto.randomUUID();

    this.frameworkOrchestrator.startComponentRender(instanceId);
    const processedTemplate = componentFunction(props);
    this.frameworkOrchestrator.finishComponentRender();

    const mountedInstance = this.performMount(
      componentDefinition,
      processedTemplate,
      containerElement,
      instanceId,
      placeholderNode,
    );

    this.frameworkOrchestrator.addMountedInstance(mountedInstance);

    return mountedInstance;
  }

  private performMount(
    componentDefinition: ComponentDefinition,
    processedTemplate: ProcessedTemplate,
    containerElement: HTMLElement,
    instanceId: string,
    placeholderNode?: Node | null,
  ): MountedComponentInstance {
    const mountedInstance: MountedComponentInstance = {
      id: instanceId,
      container: placeholderNode ? null : containerElement,
      processedTemplate,
      rootNodes: [],
      componentDefinition: componentDefinition,
      dynamicNodeMap: new Map(),
      eventListenerMap: new Map(),
      childInstanceMap: new Map(),
      listAnchorMap: new Map(),
      renderer: this,
    };

    const templateElement = document.createElement('template');
    templateElement.innerHTML = processedTemplate.staticHtml;
    const fragment = templateElement.content;

    this.processFragmentNodes(
      fragment,
      mountedInstance,
      processedTemplate.dynamicParts,
    );

    mountedInstance.rootNodes = Array.from(fragment.childNodes);

    const parentNode = placeholderNode
      ? placeholderNode.parentNode
      : containerElement;

    if (!parentNode) {
      throw new Error(
        `Cannot mount component ${instanceId}: Target parent node not found.`,
      );
    }

    if (placeholderNode) {
      if (placeholderNode.parentNode === parentNode) {
        parentNode.replaceChild(fragment, placeholderNode);
      } else {
        parentNode.appendChild(fragment);
      }
    } else {
      parentNode.appendChild(fragment);
    }

    return mountedInstance;
  }

  private processFragmentNodes(
    fragment: DocumentFragment,
    mountedInstance: MountedComponentInstance,
    dynamicParts: ComponentMetadata[],
  ): void {
    const nodesToProcess = this.collectNodesToProcess(fragment);

    for (const node of nodesToProcess) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        this.processElement(node as Element, mountedInstance, dynamicParts);
      } else if (
        node.nodeType === Node.COMMENT_NODE &&
        node.textContent?.startsWith('placeholder-')
      ) {
        this.processComment(node as Comment, mountedInstance, dynamicParts);
      }
    }
  }

  private unmount(
    targetInstanceOrInstances:
      | MountedComponentInstance
      | MountedComponentInstance[],
  ): void {
    const instances = Array.isArray(targetInstanceOrInstances)
      ? targetInstanceOrInstances
      : [targetInstanceOrInstances];

    for (const targetInstance of instances) {
      targetInstance.childInstanceMap.forEach((childInstance) =>
        this.unmount(childInstance),
      );
      targetInstance.childInstanceMap.clear();

      targetInstance.listAnchorMap.forEach(({ childInstances }) => {
        this.unmount(childInstances);
      });
      targetInstance.listAnchorMap.clear();

      targetInstance.eventListenerMap.forEach(
        ({ element, eventName, handler }) => {
          element.removeEventListener(eventName.slice(2), handler);
        },
      );
      targetInstance.eventListenerMap.clear();

      targetInstance.rootNodes.forEach((node) => {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      });
      targetInstance.rootNodes = [];

      this.stateManager.cleanUpStateForInstance(targetInstance.id);
      this.frameworkOrchestrator.removeMountedInstance(targetInstance.id);

      targetInstance.dynamicNodeMap.clear();
    }
  }

  public update(
    mountedInstance: MountedComponentInstance,
    newProcessedTemplate: ProcessedTemplate,
  ): void {
    if (!this.isProcessedTemplate(newProcessedTemplate)) {
      return;
    }

    const oldDynamicParts = mountedInstance.processedTemplate.dynamicParts;
    const newDynamicParts = newProcessedTemplate.dynamicParts;

    const oldPartsMap = new Map(oldDynamicParts.map((p) => [p.index, p]));
    const newPartsMap = new Map(newDynamicParts.map((p) => [p.index, p]));

    const allIndices = new Set([...oldPartsMap.keys(), ...newPartsMap.keys()]);

    for (const index of allIndices) {
      const oldPart = oldPartsMap.get(index);
      const newPart = newPartsMap.get(index);

      const oldNode = mountedInstance.dynamicNodeMap.get(index);
      const oldListener = mountedInstance.eventListenerMap.get(index);
      const oldChild = mountedInstance.childInstanceMap.get(index);
      const oldListAnchors = mountedInstance.listAnchorMap.get(index);

      if (newPart && oldPart) {
        if (newPart.type !== oldPart.type) {
          this.cleanupStalePart(index, mountedInstance, oldPart.type);
        } else {
          switch (newPart.type) {
            case 'event':
              this.updateEvent(index, newPart, oldListener, mountedInstance);
              break;
            case 'attribute':
              this.updateAttribute(newPart, oldNode as Element);
              break;
            case 'content':
              this.updateContent(
                index,
                newPart,
                oldNode,
                oldChild,
                oldListAnchors,
                mountedInstance,
              );
              break;
          }
        }
      } else if (oldPart) {
        this.cleanupStalePart(index, mountedInstance, oldPart.type);
      }
    }

    mountedInstance.processedTemplate = newProcessedTemplate;
  }

  public triggerComponentRerender(mountedInstance: MountedComponentInstance) {
    if (!mountedInstance || !mountedInstance.componentDefinition) {
      return;
    }

    this.frameworkOrchestrator.startComponentRender(mountedInstance.id);

    const { componentFunction, props } = mountedInstance.componentDefinition;
    let newProcessedTemplate: ProcessedTemplate | undefined = undefined;

    try {
      const result = componentFunction(props);
      if (!this.isProcessedTemplate(result)) {
        throw new Error(
          `Component function for instance ${mountedInstance.id} did not return a valid ProcessedTemplate during rerender.`,
        );
      }
      newProcessedTemplate = result;
    } catch (error) {
    } finally {
      this.frameworkOrchestrator.finishComponentRender();
    }

    if (newProcessedTemplate) {
      this.update(mountedInstance, newProcessedTemplate);
    }
  }

  private updateEvent(
    index: number,
    newPart: EventMetadata,
    oldListener:
      | { element: Element; eventName: string; handler: EventListener }
      | undefined,
    mountedInstance: MountedComponentInstance,
  ) {
    const element = mountedInstance.dynamicNodeMap.get(index) as Element;

    if (!newPart.eventName || typeof newPart.value !== 'function') {
      if (oldListener) {
        element.removeEventListener(
          oldListener.eventName.slice(2),
          oldListener.handler,
        );
        mountedInstance.eventListenerMap.delete(index);
      }
      return;
    }

    const eventName = newPart.eventName;
    const newHandler = newPart.value as EventListener;

    if (oldListener) {
      if (
        oldListener.handler !== newHandler ||
        oldListener.eventName !== eventName
      ) {
        element.removeEventListener(
          oldListener.eventName.slice(2),
          oldListener.handler,
        );
        element.addEventListener(eventName.slice(2), newHandler);

        mountedInstance.eventListenerMap.set(index, {
          element,
          eventName,
          handler: newHandler,
        });
      }
    } else {
      element.addEventListener(eventName.slice(2), newHandler);
      mountedInstance.eventListenerMap.set(index, {
        element,
        eventName,
        handler: newHandler,
      });
    }
  }

  private updateAttribute(newPart: AttributeMetadata, element: Node) {
    if (!element) {
      return;
    }

    const targetEl = (
      element.nodeType === Node.TEXT_NODE
        ? (element.parentElement ?? element.parentNode)
        : element
    ) as HTMLElement;

    if (!newPart.attributeName) {
      return;
    }

    const newValue =
      newPart.value === null || newPart.value === undefined
        ? null
        : String(newPart.value);

    if (typeof newPart.value === 'boolean') {
      if (newPart.value) {
        targetEl.setAttribute(newPart.attributeName, '');
      } else {
        targetEl.removeAttribute(newPart.attributeName);
      }
    } else if (newValue === null) {
      targetEl.removeAttribute(newPart.attributeName);
    } else {
      const currentAttrValue = targetEl.getAttribute(newPart.attributeName);

      if (currentAttrValue !== newValue) {
        targetEl.setAttribute(newPart.attributeName, newValue);
      }
    }
  }

  private updateContent(
    index: number,
    newPart: ContentMetadata,
    oldNode: Node | Element | undefined,
    oldChild: MountedComponentInstance | MountedComponentInstance[] | undefined,
    oldListAnchors:
      | {
          startIndex: number;
          endIndex: number;
          startAnchor: Comment;
          endAnchor: Comment;
          childInstances: MountedComponentInstance[];
        }
      | undefined,
    mountedInstance: MountedComponentInstance,
  ) {
    const newValue = newPart.value;

    if (Array.isArray(newValue)) {
      if (oldListAnchors) {
        this.clearBetweenAnchors(
          oldListAnchors.startAnchor,
          oldListAnchors.endAnchor,
        );
        this.unmount(oldListAnchors.childInstances);

        const newChildInstances = this.renderAndInsertListItems(
          newValue,
          mountedInstance,
          oldListAnchors.endAnchor,
        );

        mountedInstance.listAnchorMap.set(index, {
          ...oldListAnchors,
          childInstances: newChildInstances,
        });
      } else {
        let parentElement = oldNode?.parentNode;
        let insertionPoint = oldNode;

        if (!parentElement || !insertionPoint || !insertionPoint.parentNode) {
          return;
        }

        const startAnchor = document.createComment(`list-start-${index}`);
        const endAnchor = document.createComment(`list-end-${index}`);

        parentElement.insertBefore(startAnchor, insertionPoint);
        parentElement.insertBefore(endAnchor, insertionPoint);

        if (oldChild) {
          this.unmount(oldChild);
          mountedInstance.childInstanceMap.delete(index);
        }

        if (oldNode !== startAnchor && oldNode !== endAnchor && !oldChild) {
          parentElement.removeChild(oldNode as Element);
        }

        const newChildInstances = this.renderAndInsertListItems(
          newValue,
          mountedInstance,
          endAnchor,
        );

        mountedInstance.listAnchorMap.set(index, {
          startIndex: index,
          endIndex: index,
          startAnchor,
          endAnchor,
          childInstances: newChildInstances,
        });
        mountedInstance.dynamicNodeMap.set(index, startAnchor);
        if (oldChild) mountedInstance.childInstanceMap.delete(index);
      }
    } else {
      if (oldListAnchors) {
        this.clearBetweenAnchors(
          oldListAnchors.startAnchor,
          oldListAnchors.endAnchor,
        );
        this.unmount(oldListAnchors.childInstances);

        const newNode = this.renderAndInsertSingleItem(
          newValue,
          mountedInstance,
          oldListAnchors.endAnchor,
        );

        oldListAnchors.startAnchor.parentNode?.removeChild(
          oldListAnchors.startAnchor,
        );
        oldListAnchors.endAnchor.parentNode?.removeChild(
          oldListAnchors.endAnchor,
        );

        mountedInstance.listAnchorMap.delete(index);
        if (newNode instanceof Node) {
          mountedInstance.dynamicNodeMap.set(index, newNode);
        }
        if (this.isComponentDefinition(newValue) && newNode instanceof Node) {
        } else {
          mountedInstance.childInstanceMap.delete(index);
        }
      } else {
        let parentElement = oldNode?.parentNode;
        if (!oldNode || !parentElement) {
          return;
        }

        if (oldChild && !this.isComponentDefinition(newValue)) {
          this.unmount(oldChild);
          mountedInstance.childInstanceMap.delete(index);
        }

        const newNode = this.renderAndInsertSingleItem(
          newValue,
          mountedInstance,
          oldNode,
        );

        if (newNode !== oldNode && newNode instanceof Node) {
          mountedInstance.dynamicNodeMap.set(index, newNode);
        } else if (
          newNode === oldNode &&
          !this.isComponentDefinition(newValue)
        ) {
          mountedInstance.dynamicNodeMap.set(index, oldNode);
          mountedInstance.childInstanceMap.delete(index);
        }
      }
    }
  }

  private renderAndInsertListItems(
    items: any[],
    parentInstance: MountedComponentInstance,
    insertionPoint: Node,
  ): MountedComponentInstance[] {
    const childInstances: MountedComponentInstance[] = [];
    const fragment = document.createDocumentFragment();

    for (const item of items) {
      if (this.isProcessedTemplate(item)) {
        const templateElement = document.createElement('template');
        templateElement.innerHTML = item.staticHtml;
        const itemFragment = templateElement.content;

        this.processFragmentNodes(
          itemFragment,
          parentInstance,
          item.dynamicParts,
        );

        fragment.appendChild(itemFragment);
      } else if (this.isComponentDefinition(item)) {
        const tempContainer = document.createElement('div');
        const childInstance = this.mount(item, tempContainer);
        childInstance.rootNodes.forEach((node) => fragment.appendChild(node));
        childInstances.push(childInstance);
      } else if (item instanceof Node) {
        fragment.appendChild(item.cloneNode(true));
      } else {
        fragment.appendChild(document.createTextNode(String(item ?? '')));
      }
    }

    insertionPoint.parentNode?.insertBefore(fragment, insertionPoint);

    return childInstances;
  }

  private renderAndInsertSingleItem(
    value: any,
    mountedInstance: MountedComponentInstance,
    insertionPointOrOldNode: Node,
  ): Node | null {
    const parentElement = insertionPointOrOldNode.parentNode;
    if (!parentElement) {
      return null;
    }
    const index =
      mountedInstance.processedTemplate.dynamicParts.find(
        (p) => p.value === value,
      )?.index ?? -1;

    let newNode: Node | null = null;

    if (this.isComponentDefinition(value)) {
      const existingChild = mountedInstance.childInstanceMap.get(index);

      if (
        existingChild &&
        !Array.isArray(existingChild) &&
        existingChild.componentDefinition?.componentFunction ===
          value.componentFunction
      ) {
        if (existingChild.componentDefinition) {
          existingChild.componentDefinition.props = value.props;
        }

        newNode = existingChild.rootNodes[0] || insertionPointOrOldNode;
      } else {
        const oldChild = mountedInstance.childInstanceMap.get(index);
        if (oldChild) {
          this.unmount(oldChild);
        }

        const childInstance = this.mount(
          value,
          parentElement as HTMLElement,
          insertionPointOrOldNode,
        );
        mountedInstance.childInstanceMap.set(index, childInstance);
        newNode = childInstance.rootNodes[0] || null;
      }
    } else if (value instanceof Node) {
      const oldChild = mountedInstance.childInstanceMap.get(index);
      if (oldChild) {
        this.unmount(oldChild);
        mountedInstance.childInstanceMap.delete(index);
      }

      if (insertionPointOrOldNode !== value) {
        parentElement.replaceChild(value, insertionPointOrOldNode);
        newNode = value;
      } else {
        newNode = value;
      }
    } else {
      const oldChild = mountedInstance.childInstanceMap.get(index);
      if (oldChild) {
        this.unmount(oldChild);
        mountedInstance.childInstanceMap.delete(index);
      }

      const textValue = String(value ?? '');

      if (insertionPointOrOldNode.nodeType === Node.TEXT_NODE) {
        if (insertionPointOrOldNode.textContent !== textValue) {
          insertionPointOrOldNode.textContent = textValue;
        }
        newNode = insertionPointOrOldNode;
      } else {
        newNode = document.createTextNode(textValue);
        parentElement.replaceChild(newNode, insertionPointOrOldNode);
      }
    }

    if (newNode && index !== -1) {
      mountedInstance.dynamicNodeMap.set(index, newNode);
      if (!this.isComponentDefinition(value)) {
        mountedInstance.childInstanceMap.delete(index);
      }
    } else if (index !== -1 && !this.isComponentDefinition(value)) {
      mountedInstance.childInstanceMap.delete(index);
    }

    return newNode;
  }

  private clearBetweenAnchors(startAnchor: Node, endAnchor: Node): void {
    const parent = startAnchor.parentNode;
    if (!parent) return;

    let currentNode = startAnchor.nextSibling;
    while (currentNode && currentNode !== endAnchor) {
      const next = currentNode.nextSibling;
      parent.removeChild(currentNode);
      currentNode = next;
    }
  }

  private cleanupStalePart(
    index: number,
    mountedInstance: MountedComponentInstance,
    partType: ComponentMetadata['type'],
  ): void {
    const listAnchors = mountedInstance.listAnchorMap.get(index);
    if (listAnchors) {
      this.clearBetweenAnchors(listAnchors.startAnchor, listAnchors.endAnchor);
      this.unmount(listAnchors.childInstances);

      listAnchors.startAnchor.parentNode?.removeChild(listAnchors.startAnchor);
      listAnchors.endAnchor.parentNode?.removeChild(listAnchors.endAnchor);
      mountedInstance.listAnchorMap.delete(index);
    }

    if (mountedInstance.childInstanceMap.has(index)) {
      this.unmount(mountedInstance.childInstanceMap.get(index)!);
      mountedInstance.childInstanceMap.delete(index);
    }

    const listenerToRemove = mountedInstance.eventListenerMap.get(index);
    if (listenerToRemove) {
      if (listenerToRemove.element.parentNode) {
        listenerToRemove.element.removeEventListener(
          listenerToRemove.eventName.slice(2),
          listenerToRemove.handler,
        );
      }
      mountedInstance.eventListenerMap.delete(index);
    }

    const nodeToRemoveRef = mountedInstance.dynamicNodeMap.get(index);

    if (
      nodeToRemoveRef &&
      nodeToRemoveRef.nodeType !== Node.ELEMENT_NODE &&
      nodeToRemoveRef.nodeType !== Node.COMMENT_NODE &&
      nodeToRemoveRef.parentNode &&
      partType === 'content' &&
      !listAnchors
    ) {
      nodeToRemoveRef.parentNode.removeChild(nodeToRemoveRef);
    }

    mountedInstance.dynamicNodeMap.delete(index);
  }

  private collectNodesToProcess(fragment: DocumentFragment | Element): Node[] {
    const walker = document.createTreeWalker(
      fragment,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT,
      {
        acceptNode: (node: Node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            return NodeFilter.FILTER_ACCEPT;
          }

          if (
            node.nodeType === Node.COMMENT_NODE &&
            node.textContent?.startsWith('placeholder-')
          ) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        },
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
    dynamicParts: ComponentMetadata[],
  ): void {
    const attributes = Array.from(element.attributes);
    let elementProcessed = false;

    for (const attr of attributes) {
      if (!attr.value.startsWith('placeholder-')) continue;

      const index = parseInt(attr.value.substring('placeholder-'.length), 10);
      if (isNaN(index)) continue;

      const dynamicPart = dynamicParts.find((part) => part.index === index);

      if (!dynamicPart) {
        element.removeAttribute(attr.name);
        continue;
      }

      if (!elementProcessed) {
        mountedInstance.dynamicNodeMap.set(index, element);
        elementProcessed = true;
      }

      switch (dynamicPart.type) {
        case 'attribute':
          this.applyAttributePart(
            element,
            attr,
            dynamicPart as AttributeMetadata,
            mountedInstance,
            index,
          );
          break;
        case 'event':
          this.applyEventPart(
            element,
            attr,
            dynamicPart as EventMetadata,
            mountedInstance,
            index,
          );
          break;
        default:
          element.removeAttribute(attr.name);
      }
    }
  }

  private applyAttributePart(
    element: Element,
    placeholderAttribute: Attr,
    part: AttributeMetadata,
    mountedInstance: MountedComponentInstance,
    index: number,
  ): void {
    const attributeName = part.attributeName;
    const value = part.value;

    if (typeof value === 'boolean') {
      if (value) {
        element.setAttribute(attributeName, '');
      } else {
        element.removeAttribute(attributeName);
      }
    } else if (value === null || value === undefined) {
      element.removeAttribute(attributeName);
    } else {
      element.setAttribute(attributeName, String(value));
    }

    if (placeholderAttribute.name !== attributeName) {
      element.removeAttribute(placeholderAttribute.name);
    }

    mountedInstance.dynamicNodeMap.set(index, element);
  }

  private applyEventPart(
    element: Element,
    placeholderAttribute: Attr,
    part: EventMetadata,
    mountedInstance: MountedComponentInstance,
    index: number,
  ): void {
    const handler = part.value as EventListener;

    if (typeof handler !== 'function') {
      element.removeAttribute(placeholderAttribute.name);
      return;
    }

    element.addEventListener(part.eventName.slice(2), handler);
    element.removeAttribute(placeholderAttribute.name);

    mountedInstance.eventListenerMap.set(index, {
      element,
      eventName: part.eventName,
      handler,
    });

    mountedInstance.dynamicNodeMap.set(index, element);
  }

  private processComment(
    commentNode: Comment,
    mountedInstance: MountedComponentInstance,
    dynamicParts: ComponentMetadata[],
  ): void {
    const placeholderText = commentNode.textContent;
    if (!placeholderText?.startsWith('placeholder-')) return;

    const index = parseInt(
      placeholderText.substring('placeholder-'.length),
      10,
    );
    if (isNaN(index)) {
      commentNode.remove();
      return;
    }

    const dynamicPart = dynamicParts.find(
      (part) => part.index === index && part.type === 'content',
    ) as ContentMetadata | undefined;

    if (!dynamicPart) {
      commentNode.remove();
      return;
    }

    this.applyContentPart(commentNode, dynamicPart, mountedInstance);
  }

  private applyContentPart(
    commentNode: Comment,
    part: ContentMetadata,
    mountedInstance: MountedComponentInstance,
  ): void {
    const parentElement = commentNode.parentNode;
    if (!parentElement) {
      return;
    }

    const value = part.value;
    const index = part.index;

    if (Array.isArray(value)) {
      const startAnchor = document.createComment(`list-start-${index}`);
      const endAnchor = document.createComment(`list-end-${index}`);

      parentElement.replaceChild(startAnchor, commentNode);

      parentElement.insertBefore(endAnchor, startAnchor.nextSibling);

      const childInstances = this.renderAndInsertListItems(
        value,
        mountedInstance,
        endAnchor,
      );

      mountedInstance.listAnchorMap.set(index, {
        startIndex: index,
        endIndex: index,
        startAnchor,
        endAnchor,
        childInstances,
      });

      mountedInstance.dynamicNodeMap.set(index, startAnchor);
    } else {
      const newNode = this.renderAndInsertSingleItem(
        value,
        mountedInstance,
        commentNode,
      );

      if (newNode) {
        mountedInstance.dynamicNodeMap.set(index, newNode);
      } else {
        const emptyText = document.createTextNode('');
        parentElement.replaceChild(emptyText, commentNode);
        mountedInstance.dynamicNodeMap.set(index, emptyText);
        mountedInstance.childInstanceMap.delete(index);
      }
    }
  }

  private isProcessedTemplate(value: unknown): value is ProcessedTemplate {
    return (
      typeof value === 'object' &&
      value !== null &&
      'staticHtml' in value &&
      typeof (value as any).staticHtml === 'string' &&
      'dynamicParts' in value
    );
  }

  private isComponentDefinition(value: unknown): value is ComponentDefinition {
    return (
      typeof value === 'object' &&
      value !== null &&
      'componentFunction' in value &&
      typeof (value as any).componentFunction === 'function' &&
      'props' in value
    );
  }
}
