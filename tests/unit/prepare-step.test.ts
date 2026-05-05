// tests/unit/prepare-step.test.ts
// Unit tests for src/agent/prepare-step.ts

import { describe, it, expect } from 'vitest';
import { buildPrepareStepFn } from '../../src/agent/prepare-step.js';

describe('buildPrepareStepFn', () => {
  describe('iteration 0 (first outer loop pass)', () => {
    const prepareFn = buildPrepareStepFn(0);

    it('forces getCurrentTime on step 0', async () => {
      const result = await prepareFn({ stepNumber: 0 });
      expect(result.toolChoice).toEqual({ type: 'tool', toolName: 'getCurrentTime' });
      expect(result.experimental_activeTools).toEqual(['getCurrentTime']);
    });

    it('forces sequentialThinking on step 1', async () => {
      const result = await prepareFn({ stepNumber: 1 });
      expect(result.toolChoice).toEqual({ type: 'tool', toolName: 'sequentialThinking' });
      expect(result.experimental_activeTools).toEqual(['sequentialThinking']);
    });

    it('returns auto toolChoice on step 2+', async () => {
      const result = await prepareFn({ stepNumber: 2 });
      expect(result.toolChoice).toBe('auto');
    });

    it('returns auto toolChoice on step 10', async () => {
      const result = await prepareFn({ stepNumber: 10 });
      expect(result.toolChoice).toBe('auto');
    });
  });

  describe('iteration 1+ (subsequent passes)', () => {
    const prepareFn = buildPrepareStepFn(1);

    it('returns auto on step 0', async () => {
      const result = await prepareFn({ stepNumber: 0 });
      expect(result.toolChoice).toBe('auto');
    });

    it('returns auto on step 1', async () => {
      const result = await prepareFn({ stepNumber: 1 });
      expect(result.toolChoice).toBe('auto');
    });

    it('returns auto on step 5', async () => {
      const result = await prepareFn({ stepNumber: 5 });
      expect(result.toolChoice).toBe('auto');
    });
  });

  describe('high iteration number', () => {
    it('always returns auto for iteration 99 step 0', async () => {
      const prepareFn = buildPrepareStepFn(99);
      const result = await prepareFn({ stepNumber: 0 });
      expect(result.toolChoice).toBe('auto');
    });
  });
});
