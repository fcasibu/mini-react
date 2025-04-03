function shallowCompareArrays(
  arr1: unknown[] | undefined,
  arr2: unknown[] | undefined,
): boolean {
  if (!arr1 || !arr2) {
    return arr1 === arr2;
  }
  if (arr1.length !== arr2.length) {
    return false;
  }
  for (let i = 0; i < arr1.length; i++) {
    if (!Object.is(arr1[i], arr2[i])) {
      return false;
    }
  }
  return true;
}

interface EffectRecord {
  needExecuting: boolean;
  callback: () => (() => void) | void;
  deps?: unknown[];
  previousDeps: unknown[] | undefined;
  cleanup: (() => void) | undefined;
}

export class EffectManager {
  private effectStore = new Map<string, Map<number, EffectRecord>>();

  public registerEffect(
    instanceId: string,
    hookIndex: number,
    callback: () => (() => void) | void,
    deps: unknown[] | undefined,
  ) {
    let effectStore = this.effectStore.get(instanceId);
    if (!effectStore) {
      effectStore = new Map<number, EffectRecord>();
      this.effectStore.set(instanceId, effectStore);
    }

    const effectInstance = effectStore.get(hookIndex);

    if (!effectInstance) {
      const newRecord: EffectRecord = {
        needExecuting: true,
        callback: callback,
        deps: deps,
        previousDeps: undefined,
        cleanup: undefined,
      };
      effectStore.set(hookIndex, newRecord);
    } else {
      const previousDeps = effectInstance.deps;
      let shouldExecute = false;

      if (!deps) {
        shouldExecute = true;
      } else if (!shallowCompareArrays(deps, previousDeps)) {
        shouldExecute = true;
      }

      effectStore.set(hookIndex, {
        ...effectInstance,
        callback: callback,
        deps: deps,
        needExecuting: effectInstance.needExecuting || shouldExecute,
      });
    }
  }

  public runEffects(instanceId: string) {
    const effectStore = this.effectStore.get(instanceId);

    if (!effectStore) return;

    for (const [hookIndex, effectRecord] of effectStore.entries()) {
      if (effectRecord.needExecuting) {
        if (typeof effectRecord.cleanup === 'function') {
          effectRecord.cleanup();
        }

        const newCleanup = effectRecord.callback();

        effectStore.set(hookIndex, {
          ...effectRecord,
          cleanup: typeof newCleanup === 'function' ? newCleanup : undefined,
          needExecuting: false,
          previousDeps: effectRecord.deps,
        });
      }
    }
  }

  public cleanUpEffectsForInstance(instanceId: string) {
    const effectStore = this.effectStore.get(instanceId);
    if (!effectStore) {
      return;
    }

    for (const effectRecord of effectStore.values()) {
      if (typeof effectRecord.cleanup === 'function') {
        effectRecord.cleanup();
      }
    }

    this.effectStore.delete(instanceId);
  }
}
