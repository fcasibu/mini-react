import type { FrameworkOrchestrator } from './framework-orchestrator';
import { assert } from './utils/assert';

interface StateRecord<T = unknown> {
  value: T;
  setState: (state: T | ((prev: T) => T)) => void;
}

export class StateManager {
  private stateStore = new Map<string, Map<number, StateRecord<any>>>();

  constructor(private readonly frameworkOrchestrator: FrameworkOrchestrator) {}

  public registerState<T>(
    instanceId: string,
    hookIndex: number,
    initialValue?: T | ((prev: T) => T),
  ): [T, (state: T | ((prev: T) => T)) => void] {
    if (!this.stateStore.has(instanceId)) {
      this.stateStore.set(instanceId, new Map());
    }

    const stateInstance = this.stateStore.get(instanceId);

    assert(stateInstance, 'stateInstance should exist at this point');

    const value =
      typeof initialValue === 'function'
        ? (initialValue as (prev: T) => T)(stateInstance.get(hookIndex)?.value)
        : initialValue;

    if (!stateInstance.has(hookIndex)) {
      stateInstance.set(hookIndex, {
        value: initialValue,
        setState: (newValue: T | ((prev: T) => T)) => {
          const mountedInstance =
            this.frameworkOrchestrator.getMountedInstance(instanceId);

          assert(
            mountedInstance,
            'mounted instance should exist at this point',
          );

          const stateRecord = stateInstance.get(hookIndex);

          assert(stateRecord, 'state record should exist at this point');
          const currentState = stateRecord.value;

          const newState =
            typeof newValue === 'function'
              ? (newValue as (prev: T) => T)(currentState)
              : newValue;

          if (!Object.is(newState, currentState)) {
            stateRecord.value = newState;

            mountedInstance.renderer.triggerComponentRerender(mountedInstance);
          }
        },
      });
    }

    const stateRecord = stateInstance.get(hookIndex);

    return [(stateRecord?.value ?? value) as T, stateRecord?.setState!];
  }

  public cleanUpStateForInstance(instanceId: string) {
    this.stateStore.delete(instanceId);
  }
}
