export type Component = (props?: Record<string, unknown>) => unknown;

export interface ComponentRenderContext {
  instanceId: string;
  hookIndex: number;
}

export type MetadataType = 'event' | 'content';
export type Events = 'onClick';

export interface EventMetadata {
  index: number;
  type: 'event';
  attributeName: Events;
  value: (event: Event) => void;
}

export interface ContentMetadata {
  index: number;
  type: 'content';
  value: unknown;
}

export type ComponentMetadata = EventMetadata | ContentMetadata;

export interface ProcessedTemplate {
  staticHtml: string;
  dynamicParts: ComponentMetadata[];
}
