import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveConfigProfileSelectState } from '../src/components/profileSelect.js';

test('resolveConfigProfileSelectState shows an explicit placeholder for a missing profile', () => {
  const state = resolveConfigProfileSelectState(
    [{ name: 'node' }, { name: 'cpp' }],
    '',
  );

  assert.equal(state.value, '__launch_composer_missing_profile__');
  assert.deepEqual(state.options, [
    '__launch_composer_missing_profile__',
    'node',
    'cpp',
  ]);
  assert.deepEqual(state.optionLabels, ['Select a profile...', 'node', 'cpp']);
  assert.equal(state.disabled, false);
  assert.match(state.helperMessage ?? '', /does not define a profile/i);
});

test('resolveConfigProfileSelectState treats a non-string profile value as invalid JSON data', () => {
  const state = resolveConfigProfileSelectState([{ name: 'node' }], undefined);

  assert.equal(state.value, '__launch_composer_missing_profile__');
  assert.deepEqual(state.options, [
    '__launch_composer_missing_profile__',
    'node',
  ]);
  assert.deepEqual(state.optionLabels, ['Select a profile...', 'node']);
  assert.equal(state.disabled, false);
  assert.match(state.helperMessage ?? '', /invalid profile value/i);
});

test('resolveConfigProfileSelectState keeps an unknown profile visible and labeled', () => {
  const state = resolveConfigProfileSelectState(
    [{ name: 'node' }, { name: 'cpp' }],
    'legacy',
  );

  assert.equal(state.value, 'legacy');
  assert.deepEqual(state.options, ['node', 'cpp', 'legacy']);
  assert.deepEqual(state.optionLabels, ['node', 'cpp', 'legacy (missing)']);
  assert.equal(state.disabled, false);
  assert.match(state.helperMessage ?? '', /missing profile "legacy"/i);
});

test('resolveConfigProfileSelectState disables the field when no profiles exist', () => {
  const state = resolveConfigProfileSelectState([], '');

  assert.equal(state.value, '__launch_composer_no_profiles__');
  assert.deepEqual(state.options, ['__launch_composer_no_profiles__']);
  assert.deepEqual(state.optionLabels, ['No profiles available']);
  assert.equal(state.disabled, true);
  assert.match(state.helperMessage ?? '', /no profiles are available/i);
});

test('resolveConfigProfileSelectState preserves an unknown profile when no profiles exist', () => {
  const state = resolveConfigProfileSelectState([], 'legacy');

  assert.equal(state.value, 'legacy');
  assert.deepEqual(state.options, ['legacy']);
  assert.deepEqual(state.optionLabels, ['legacy (missing)']);
  assert.equal(state.disabled, true);
  assert.match(state.helperMessage ?? '', /missing profile "legacy"/i);
});

test('resolveConfigProfileSelectState deduplicates valid profile names', () => {
  const state = resolveConfigProfileSelectState(
    [{ name: 'node' }, { name: '' }, { name: 'node' }, { name: 'cpp' }],
    'node',
  );

  assert.deepEqual(state.options, ['node', 'cpp']);
  assert.deepEqual(state.optionLabels, ['node', 'cpp']);
  assert.equal(state.disabled, false);
  assert.equal(state.helperMessage, undefined);
});
