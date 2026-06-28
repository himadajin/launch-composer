import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isDebugRequestOption,
  isInternalProfileRequestSelectValue,
  resolveProfileRequestSelectState,
} from '../src/components/profileRequestSelect.js';

test('resolveProfileRequestSelectState accepts launch and attach values', () => {
  assert.deepEqual(resolveProfileRequestSelectState('launch'), {
    value: 'launch',
    options: ['launch', 'attach'],
    optionLabels: ['launch', 'attach'],
  });
  assert.deepEqual(resolveProfileRequestSelectState('attach'), {
    value: 'attach',
    options: ['launch', 'attach'],
    optionLabels: ['launch', 'attach'],
  });
});

test('resolveProfileRequestSelectState exposes a repair option for missing values', () => {
  const state = resolveProfileRequestSelectState(undefined);

  assert.equal(isInternalProfileRequestSelectValue(state.value), true);
  assert.deepEqual(state.options.slice(1), ['launch', 'attach']);
  assert.deepEqual(state.optionLabels, [
    'Select a request...',
    'launch',
    'attach',
  ]);
  assert.match(state.helperMessage ?? '', /required/);
});

test('resolveProfileRequestSelectState preserves invalid string values for display', () => {
  assert.deepEqual(resolveProfileRequestSelectState('start'), {
    value: 'start',
    options: ['launch', 'attach', 'start'],
    optionLabels: ['launch', 'attach', 'start (invalid)'],
    helperMessage:
      'Profile request "start" is invalid. Choose launch or attach.',
  });
});

test('isDebugRequestOption only accepts saved request options', () => {
  assert.equal(isDebugRequestOption('launch'), true);
  assert.equal(isDebugRequestOption('attach'), true);
  assert.equal(isDebugRequestOption('start'), false);
});
