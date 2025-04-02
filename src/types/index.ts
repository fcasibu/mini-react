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
  value: unknown;
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
  value: unknown;
}

export type ComponentMetadata =
  | EventMetadata
  | ContentMetadata
  | AttributeMetadata;

export interface ProcessedTemplate {
  staticHtml: string;
  dynamicParts: ComponentMetadata[];
}
