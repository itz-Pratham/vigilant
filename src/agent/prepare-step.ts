// src/agent/prepare-step.ts
// Builds the prepareStep callback for NeuroLink generate() calls.
// Forces getCurrentTime on step 0 and sequentialThinking on step 1
// for the first outer iteration; subsequent iterations use auto.

type StepControl = {
  toolChoice?: { type: 'tool'; toolName: string } | 'auto' | 'none';
  experimental_activeTools?: string[];
};

type PrepareStepOptions = {
  stepNumber: number;
  [key: string]: unknown;
};

/**
 * Returns a prepareStep function for `neurolink.generate()`.
 * @param outerIteration - the current outer loop iteration (0-indexed)
 */
export function buildPrepareStepFn(outerIteration: number): (options: PrepareStepOptions) => Promise<StepControl> {
  return async (options: PrepareStepOptions): Promise<StepControl> => {
    const step = options.stepNumber;
    if (outerIteration === 0) {
      if (step === 0) {
        return {
          toolChoice:               { type: 'tool', toolName: 'getCurrentTime' },
          experimental_activeTools: ['getCurrentTime'],
        };
      }
      if (step === 1) {
        return {
          toolChoice:               { type: 'tool', toolName: 'sequentialThinking' },
          experimental_activeTools: ['sequentialThinking'],
        };
      }
    }
    // All other steps: model chooses freely
    return { toolChoice: 'auto' };
  };
}
