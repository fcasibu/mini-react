import type { Renderer } from '../renderer';

export type Component = (props?: Record<string, unknown>) => unknown;

export interface ComponentRenderContext {
  instanceId: string;
  hookIndex: number;
}

export type MetadataType = 'event' | 'content' | 'attribute';
export type EventNames = 'onClick';

export interface AttributeMetadata {
  index: number;
  type: 'attribute';
  attributeName: string;
  value: string;
}

export interface EventMetadata {
  index: number;
  type: 'event';
  eventName: EventNames;
  value: (event: Event) => void;
}

export interface ContentMetadata {
  index: number;
  type: 'content';
  value: ProcessedTemplate | string;
}

export type ComponentMetadata =
  | EventMetadata
  | ContentMetadata
  | AttributeMetadata;

export interface ProcessedTemplate {
  staticHtml: string;
  dynamicParts: ComponentMetadata[];
}

export interface MountedComponentInstance {
  id: string;
  rootNodes: Node[];
  container: HTMLElement | null;
  renderer: Renderer;
  componentDefinition: ComponentDefinition | null;
  processedTemplate: ProcessedTemplate;
  dynamicNodeMap: Map<number, Node | Element>;
  eventListenerMap: Map<
    number,
    { element: Element; eventName: string; handler: EventListener }
  >;
  childInstanceMap: Map<
    number,
    MountedComponentInstance | MountedComponentInstance[]
  >;
}

export interface ComponentDefinition<P = any> {
  componentFunction: (props: P) => ProcessedTemplate;
  props: P;
}

export type ComponentApi<P = any> = (props: P) => ComponentDefinition<P>;
