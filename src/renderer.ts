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
      renderer: this,
    };

    const templateElement = document.createElement('template');
    templateElement.innerHTML = processedTemplate.staticHtml;
    const fragment = templateElement.content;

    const nodesToProcess = this.collectNodesToProcess(fragment);

    for (const node of nodesToProcess) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        this.processElement(
          node as Element,
          mountedInstance,
          processedTemplate.dynamicParts,
        );
      } else if (node.nodeType === Node.COMMENT_NODE) {
        this.processComment(
          node as Comment,
          mountedInstance,
          processedTemplate.dynamicParts,
        );
      }
    }

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
      parentNode.replaceChild(fragment, placeholderNode);
    } else {
      parentNode.appendChild(fragment);
    }

    return mountedInstance;
  }

  private unmount(
    targetInstance: MountedComponentInstance | MountedComponentInstance[],
  ): void {
    if (Array.isArray(targetInstance)) {
      targetInstance.forEach((instanceToUnmount) =>
        this.unmount(instanceToUnmount),
      );
      return;
    }

    targetInstance.childInstanceMap.forEach((childInstance) =>
      this.unmount(childInstance),
    );
    targetInstance.childInstanceMap.clear();

    targetInstance.eventListenerMap.forEach(
      ({ element, eventName, handler }) => {
        element.removeEventListener(eventName, handler);
      },
    );
    targetInstance.eventListenerMap.clear();

    targetInstance.rootNodes.forEach((node) =>
      node.parentNode?.removeChild(node),
    );
    targetInstance.rootNodes = [];

    this.stateManager.cleanUpStateForInstance(targetInstance.id);
    this.frameworkOrchestrator.removeMountedInstance(targetInstance.id);

    targetInstance.dynamicNodeMap.clear();
  }

  public update(
    mountedInstance: MountedComponentInstance,
    newProcessedTemplate: ProcessedTemplate,
  ): void {
    const newDynamicParts = newProcessedTemplate.dynamicParts;
    const newIndices = new Set(newDynamicParts.map((part) => part.index));

    for (const newPart of newDynamicParts) {
      const index = newPart.index;
      const oldNode = mountedInstance.dynamicNodeMap.get(index);
      const oldListener = mountedInstance.eventListenerMap.get(index);
      const oldChild = mountedInstance.childInstanceMap.get(index);

      switch (newPart.type) {
        case 'event': {
          this.updateEvent(
            index,
            newPart,
            oldNode,
            oldListener,
            mountedInstance,
          );
          break;
        }

        case 'attribute': {
          this.updateAttribute(newPart, oldNode);
          break;
        }

        case 'content': {
          this.updateContent(
            index,
            newPart,
            oldNode,
            oldChild,
            mountedInstance,
          );
          break;
        }
      }
    }

    const oldIndices = new Set([
      ...mountedInstance.dynamicNodeMap.keys(),
      ...mountedInstance.eventListenerMap.keys(),
      ...mountedInstance.childInstanceMap.keys(),
    ]);

    for (const oldIndex of oldIndices) {
      if (!newIndices.has(oldIndex)) {
        this.cleanupStalePart(oldIndex, mountedInstance);
      }
    }

    mountedInstance.processedTemplate = newProcessedTemplate;
  }

  public triggerComponentRerender(mountedInstance: MountedComponentInstance) {
    this.frameworkOrchestrator.startComponentRender(mountedInstance.id);

    const { componentFunction, props } =
      mountedInstance.componentDefinition ?? {};
    const newProcessedTemplate = componentFunction?.(props);

    this.frameworkOrchestrator.finishComponentRender();

    if (newProcessedTemplate) {
      this.update(mountedInstance, newProcessedTemplate);
    }
  }

  private updateEvent(
    index: number,
    newPart: EventMetadata,
    oldNode: Node | Element | undefined,
    oldListener:
      | { element: Element; eventName: string; handler: EventListener }
      | undefined,
    mountedInstance: MountedComponentInstance,
  ) {
    if (!newPart.eventName || typeof newPart.value !== 'function') {
      return;
    }
    const element = oldNode as Element;
    const eventName = newPart.eventName.startsWith('on')
      ? newPart.eventName.substring(2)
      : newPart.eventName;
    const newHandler = newPart.value as EventListener;

    if (!element || typeof element.addEventListener !== 'function') {
      return;
    }

    if (oldListener) {
      if (
        !Object.is(oldListener.handler, newHandler) ||
        oldListener.eventName !== eventName
      ) {
        element.removeEventListener(oldListener.eventName, oldListener.handler);
        element.addEventListener(eventName, newHandler);
        oldListener.handler = newHandler;
        oldListener.eventName = eventName;
      }
    } else {
      element.addEventListener(eventName, newHandler);
      mountedInstance.eventListenerMap.set(index, {
        element,
        eventName,
        handler: newHandler,
      });
    }
  }

  private updateAttribute(
    newPart: AttributeMetadata,
    oldNode: Node | Element | undefined,
  ) {
    if (!newPart.attributeName) {
      return;
    }
    const element = oldNode as Element;
    if (!element || typeof element.setAttribute !== 'function') {
      return;
    }

    const newValue = String(newPart.value ?? '');
    const currentAttrValue = element.getAttribute(newPart.attributeName);

    if (!Object.is(currentAttrValue, newValue)) {
      element.setAttribute(newPart.attributeName, newValue);
    }
  }

  private updateContent(
    index: number,
    newPart: ContentMetadata,
    oldNode: Node | Element | undefined,
    oldChild: MountedComponentInstance | MountedComponentInstance[] | undefined,
    mountedInstance: MountedComponentInstance,
  ) {
    if (!oldNode || !oldNode.parentNode) {
      return;
    }
    const parentElement = oldNode.parentNode;
    const newIsPrimitive = !(
      this.isComponentDefinition(newPart.value) ||
      Array.isArray(newPart.value) ||
      newPart.value instanceof Node
    );
    const oldIsText = oldNode.nodeType === Node.TEXT_NODE;
    const oldIsComponentOrList = mountedInstance.childInstanceMap.has(index);

    if (newIsPrimitive) {
      const newTextValue = String(newPart.value ?? '');
      if (oldIsText) {
        if (!Object.is(oldNode.textContent, newTextValue)) {
          oldNode.textContent = newTextValue;
        }
      } else {
        if (oldIsComponentOrList) {
          this.unmount(mountedInstance.childInstanceMap.get(index)!);
          mountedInstance.childInstanceMap.delete(index);
        }
        const newNode = document.createTextNode(newTextValue);
        parentElement.replaceChild(newNode, oldNode);
        mountedInstance.dynamicNodeMap.set(index, newNode);
      }
    } else if (this.isComponentDefinition(newPart.value)) {
      const newDefinition = newPart.value as ComponentDefinition<any>;
      if (oldIsComponentOrList && !Array.isArray(oldChild)) {
        const oldChildInstance = oldChild as MountedComponentInstance;
        const existingMountedInstance =
          this.frameworkOrchestrator.getMountedInstance(oldChildInstance.id);
        if (
          existingMountedInstance &&
          existingMountedInstance.componentDefinition?.componentFunction ===
            newDefinition.componentFunction
        ) {
          if (
            !Object.is(
              existingMountedInstance.componentDefinition.props,
              newDefinition.props,
            )
          ) {
            existingMountedInstance.componentDefinition.props =
              newDefinition.props;
            this.triggerComponentRerender(existingMountedInstance);
          }
        } else {
          this.unmount(oldChildInstance);
          const newChildInstance = this.mount(
            newDefinition,
            parentElement as HTMLElement,
            oldNode,
          );
          mountedInstance.dynamicNodeMap.set(
            index,
            newChildInstance.rootNodes[0] || oldNode,
          );
          mountedInstance.childInstanceMap.set(index, newChildInstance);
        }
      } else {
        if (oldIsComponentOrList) {
          this.unmount(oldChild as MountedComponentInstance[]);
        }
        const newChildInstance = this.mount(
          newDefinition,
          parentElement as HTMLElement,
          oldNode,
        );
        mountedInstance.dynamicNodeMap.set(
          index,
          newChildInstance.rootNodes[0] || oldNode,
        );
        mountedInstance.childInstanceMap.set(index, newChildInstance);
      }
    } else if (Array.isArray(newPart.value)) {
      if (oldIsComponentOrList) {
        this.unmount(mountedInstance.childInstanceMap.get(index)!);
      }
      mountedInstance.childInstanceMap.delete(index);

      const listFragment = document.createDocumentFragment();
      const newChildInstances: MountedComponentInstance[] = [];
      for (const item of newPart.value) {
        if (this.isComponentDefinition(item)) {
          const childInstance = this.mount(item, document.createElement('div'));
          childInstance.rootNodes.forEach((node) =>
            listFragment.appendChild(node),
          );
          newChildInstances.push(childInstance);
        } else if (item instanceof Node) {
          listFragment.appendChild(item.cloneNode(true));
        } else {
          listFragment.appendChild(document.createTextNode(String(item ?? '')));
        }
      }
      parentElement.replaceChild(listFragment, oldNode);
      mountedInstance.dynamicNodeMap.set(index, oldNode);
      if (newChildInstances.length > 0) {
        mountedInstance.childInstanceMap.set(index, newChildInstances);
      }
    } else if (newPart.value instanceof Node) {
      if (!Object.is(oldNode, newPart.value)) {
        if (oldIsComponentOrList) {
          this.unmount(mountedInstance.childInstanceMap.get(index)!);
          mountedInstance.childInstanceMap.delete(index);
        }
        parentElement.replaceChild(newPart.value, oldNode);
        mountedInstance.dynamicNodeMap.set(index, newPart.value);
      }
    }
  }

  private cleanupStalePart(
    index: number,
    mountedInstance: MountedComponentInstance,
  ): void {
    if (mountedInstance.childInstanceMap.has(index)) {
      this.unmount(mountedInstance.childInstanceMap.get(index)!);
      mountedInstance.childInstanceMap.delete(index);
    }

    const listenerToRemove = mountedInstance.eventListenerMap.get(index);
    if (listenerToRemove) {
      listenerToRemove.element.removeEventListener(
        listenerToRemove.eventName,
        listenerToRemove.handler,
      );
      mountedInstance.eventListenerMap.delete(index);
    }

    const nodeToRemoveRef = mountedInstance.dynamicNodeMap.get(index);
    if (
      nodeToRemoveRef &&
      nodeToRemoveRef.nodeType !== Node.ELEMENT_NODE &&
      !this.isNodeInInstanceRoots(nodeToRemoveRef, mountedInstance)
    ) {
      nodeToRemoveRef.parentNode?.removeChild(nodeToRemoveRef);
    }
    mountedInstance.dynamicNodeMap.delete(index);
  }

  private isNodeInInstanceRoots(
    node: Node,
    mountedInstance: MountedComponentInstance,
  ): boolean {
    return mountedInstance.rootNodes.some(
      (rootNode) => rootNode === node || rootNode.contains(node),
    );
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
    dynamicParts: ComponentMetadata[],
  ): void {
    const attributes = Array.from(element.attributes);
    for (const attr of attributes) {
      if (!attr.value.startsWith('placeholder-')) continue;

      const index = parseInt(attr.value.substring('placeholder-'.length), 10);
      const dynamicPart = dynamicParts.find((part) => part.index === index);

      if (!dynamicPart) {
        element.removeAttribute(attr.name);
        continue;
      }

      mountedInstance.dynamicNodeMap.set(dynamicPart.index, element);

      switch (dynamicPart.type) {
        case 'attribute': {
          this.applyAttributePart(
            element,
            attr,
            dynamicPart as AttributeMetadata,
          );
          break;
        }
        case 'event': {
          this.applyEventPart(
            element,
            attr,
            dynamicPart as EventMetadata,
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
    attribute: Attr,
    part: AttributeMetadata,
  ): void {
    element.setAttribute(part.attributeName, String(part.value ?? ''));
    if (attribute.name !== part.attributeName) {
      element.removeAttribute(attribute.name);
    }
  }

  private applyEventPart(
    element: Element,
    attribute: Attr,
    part: EventMetadata,
    mountedInstance: MountedComponentInstance,
  ): void {
    const eventName = part.eventName.startsWith('on')
      ? part.eventName.substring(2)
      : part.eventName;
    const handler = part.value as EventListener;
    element.addEventListener(eventName, handler);
    element.removeAttribute(attribute.name);
    mountedInstance.eventListenerMap.set(part.index, {
      element,
      eventName,
      handler,
    });
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
    if (value instanceof Node) {
      mountedInstance.dynamicNodeMap.set(part.index, value);
      parentElement.replaceChild(value, commentNode);
    } else if (this.isComponentDefinition(value)) {
      const childInstance = this.mount(
        value,
        parentElement as HTMLElement,
        commentNode,
      );
      mountedInstance.childInstanceMap.set(part.index, childInstance);
      mountedInstance.dynamicNodeMap.set(
        part.index,
        childInstance.rootNodes[0] || commentNode,
      );
    } else if (Array.isArray(value)) {
      const listFragment = document.createDocumentFragment();
      const childInstances: MountedComponentInstance[] = [];
      for (const item of value) {
        if (this.isComponentDefinition(item)) {
          const childInstance = this.mount(item, document.createElement('div'));
          childInstance.rootNodes.forEach((node) =>
            listFragment.appendChild(node),
          );
          childInstances.push(childInstance);
        } else if (item instanceof Node) {
          listFragment.appendChild(item.cloneNode(true));
        } else {
          listFragment.appendChild(document.createTextNode(String(item ?? '')));
        }
      }
      parentElement.replaceChild(listFragment, commentNode);
      if (childInstances.length > 0) {
        mountedInstance.childInstanceMap.set(part.index, childInstances);
      }
      mountedInstance.dynamicNodeMap.set(part.index, commentNode);
    } else if (value !== null && value !== undefined) {
      const textNode = document.createTextNode(String(value));
      parentElement.replaceChild(textNode, commentNode);
      mountedInstance.dynamicNodeMap.set(part.index, textNode);
    } else {
      const emptyTextNode = document.createTextNode('');
      parentElement.replaceChild(emptyTextNode, commentNode);
      mountedInstance.dynamicNodeMap.set(part.index, emptyTextNode);
    }
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
