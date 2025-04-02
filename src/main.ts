import { component } from './create-component';
import { FrameworkOrchestrator } from './framework-orchestrator';
import { Renderer } from './renderer';
import { StateManager } from './state-manager';
import { TemplateProcessor } from './template-processor';
import type { ComponentDefinition, MountedComponentInstance } from './types';

const frameworkOrchestrator = FrameworkOrchestrator.getInstance();
const processor = new TemplateProcessor();
const stateManager = new StateManager(frameworkOrchestrator);
const renderer = new Renderer(frameworkOrchestrator, stateManager);

export { component };

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
  const mountedInstance = renderer.mount(definition, container);

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

export function $state<T>(newValue?: T | ((prev: T) => T)) {
  const currentComponentContext =
    frameworkOrchestrator.getCurrentComponentContext();

  const hookIndex = frameworkOrchestrator.getNextHookIndex();

  return stateManager.registerState<T>(
    currentComponentContext.instanceId,
    hookIndex,
    newValue,
  );
}

const Button = component<{ onClick: () => void; count: number }>(
  ({ onClick, count }) => {
    const double = count * 2;
    const [theme, setTheme] = $state('light');
    const [anotherCount, setAnotherCount] = $state(4);

    return html`<button
      type="button"
      class="${theme}"
      onclick="${() => {
        onClick();
        setAnotherCount(anotherCount * 2);
        setTheme(theme === 'light' ? 'dark' : 'light');
      }}"
    >
      <span>Click me! ${double}</span>
      <span>${anotherCount}</span>
    </button>`;
  },
);

const Counter = component(() => {
  const [count, setCount] = $state(0);

  return html`<div>
    <span>${count}</span>
    ${Button({ onClick: () => setCount(count + 1), count })}
  </div>`;
});

render(Counter({}), document.getElementById('app')!);
