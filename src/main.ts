import { FrameworkOrchestrator } from './framework-orchestrator';
import { Renderer } from './renderer';
import { TemplateProcessor } from './template-processor';
import type { ComponentDefinition, MountedComponentInstance } from './types';

const frameworkOrchestrator = FrameworkOrchestrator.getInstance();
const processor = new TemplateProcessor();
const renderer = new Renderer();

export function html(
  staticStrings: TemplateStringsArray,
  ...expressions: unknown[]
) {
  return processor.process(staticStrings, expressions);
}

export function render(
  definition: ComponentDefinition,
  container: HTMLElement,
) {
  const { componentFunction, props } = definition;

  const initialShell = componentFunction(props);

  const mountedInstance = renderer.mount(initialShell, container);

  function addInstances(
    instance: MountedComponentInstance | MountedComponentInstance[],
  ) {
    if (Array.isArray(instance)) {
      instance.forEach(addInstances);
      return;
    }

    frameworkOrchestrator.addMountedInstance(instance);

    instance.childInstanceMap.forEach((child) => addInstances(child));
  }

  addInstances(mountedInstance);
}
