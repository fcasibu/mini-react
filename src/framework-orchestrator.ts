import type { ComponentRenderContext } from './types';
import { assert } from './utils/assert';

// TODO(fcasibu): StateManager, EffectManager, Renderer
export class FrameworkOrchestrator {
  private static instance: FrameworkOrchestrator;
  private componentContextStack: ComponentRenderContext[] = [];

  private constructor() {}

  public static getInstance(): FrameworkOrchestrator {
    if (!FrameworkOrchestrator.instance) {
      FrameworkOrchestrator.instance = new FrameworkOrchestrator();
    }

    return FrameworkOrchestrator.instance;
  }

  public startComponentRender(instanceId: string) {
    this.componentContextStack.push({ instanceId, hookIndex: 0 });
  }

  public finishComponentRender() {
    assert(
      this.componentContextStack.length,
      'Component context stack should contain something',
    );

    this.componentContextStack.pop();
  }

  public getCurrentComponentContext(): ComponentRenderContext {
    if (!this.componentContextStack.length) {
      throw new Error('A hook was called outside of render');
    }

    const currentComponentContext =
      this.componentContextStack[this.componentContextStack.length - 1];

    assert(
      currentComponentContext,
      'Component context should exist at this point',
    );

    return currentComponentContext;
  }

  public getNextHookIndex() {
    const currentContext = this.getCurrentComponentContext();

    const originalHookIndex = currentContext.hookIndex;
    currentContext.hookIndex += 1;

    return originalHookIndex;
  }
}
