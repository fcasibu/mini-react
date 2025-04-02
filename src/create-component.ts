import type {
  ComponentApi,
  ComponentDefinition,
  ProcessedTemplate,
} from './types';

export function component<P>(
  componentFunc: (props: P) => ProcessedTemplate,
): ComponentApi<P> {
  const api: ComponentApi<P> = (props?: P): ComponentDefinition<P> => {
    return { componentFunction: componentFunc, props: props ?? ({} as P) };
  };

  return api;
}
