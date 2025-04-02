import { FrameworkOrchestrator } from './framework-orchestrator';
import { TemplateProcessor } from './template-processor';
import type { MountedComponentInstance, ProcessedTemplate } from './types';

const frameworkOrchestrator = FrameworkOrchestrator.getInstance();
const processor = new TemplateProcessor();

export function html(
  staticStrings: TemplateStringsArray,
  ...expressions: unknown[]
) {
  return processor.process(staticStrings, expressions);
}

export function render(shell: ProcessedTemplate, container: HTMLElement) {
  const mountedInstance = frameworkOrchestrator.renderer.mount(
    shell,
    container,
  );

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
