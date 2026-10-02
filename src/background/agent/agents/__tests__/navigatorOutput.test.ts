import { describe, expect, it } from 'vitest';
import { jsonSchema } from '@src/background/llm/generate';
import { normalizeNavigatorOutput, validateNavigatorOutput } from '../navigatorOutput';
import { generateStructured } from '@src/background/llm/generate';
import { userMessage } from '@src/background/llm/messages';
import type { StructuredMode } from '@src/background/llm/types';
import { type MockResult, mockChatModel, textResult, toolCallResult } from '@src/background/llm/__tests__/mockModel';

const currentState = { evaluation_previous_goal: 'ok', memory: 'm', next_goal: 'g' };

describe('normalizeNavigatorOutput', () => {
  it('parses action given as a JSON string', () => {
    const out = normalizeNavigatorOutput({ current_state: currentState, action: '[{"click_element":{"index":1}}]' });
    expect(out).toEqual({ current_state: currentState, action: [{ click_element: { index: 1 } }] });
  });

  it('repairs a malformed but repairable action string', () => {
    const out = normalizeNavigatorOutput({ action: "[{click_element: {index: 1}}, {done: {text: 'x'}}" });
    expect(out).toEqual({ action: [{ click_element: { index: 1 } }, { done: { text: 'x' } }] });
  });

  it('wraps a single action object in an array', () => {
    expect(normalizeNavigatorOutput({ action: { go_back: {} } })).toEqual({ action: [{ go_back: {} }] });
  });

  it('drops null entries and accepts an empty array', () => {
    expect(normalizeNavigatorOutput({ action: [null, { go_back: {} }, null] })).toEqual({ action: [{ go_back: {} }] });
    expect(normalizeNavigatorOutput({ action: [] })).toEqual({ action: [] });
  });

  it('throws for an unrepairable action string', () => {
    expect(() => normalizeNavigatorOutput({ action: 'click the button' })).toThrow('Invalid action output format');
  });
});

describe('validateNavigatorOutput', () => {
  it('passes unknown action names and invalid arguments through untouched', () => {
    const raw = { current_state: currentState, action: [{ fly_to_moon: { speed: 'fast' } }, { click_element: 'x' }] };
    const result = validateNavigatorOutput(raw);
    expect(result).toEqual({ success: true, value: raw });
  });

  it('rejects an action that is not an array of objects', () => {
    expect(validateNavigatorOutput({ action: 42 }).success).toBe(false);
    expect(validateNavigatorOutput({ action: ['x'] }).success).toBe(false);
    expect(validateNavigatorOutput({}).success).toBe(false);
  });

  it('rejects a non-object current_state', () => {
    expect(validateNavigatorOutput({ current_state: 'x', action: [] }).success).toBe(false);
  });

  it('returns an error instead of throwing for unrepairable actions', () => {
    const result = validateNavigatorOutput({ action: 'click the button' });
    expect(result.success).toBe(false);
  });
});

describe('navigator output through generateStructured', () => {
  const schema = jsonSchema(
    {
      type: 'object',
      properties: { current_state: { type: 'object' }, action: { type: 'array', items: { type: 'object' } } },
      required: ['current_state', 'action'],
    },
    { validate: validateNavigatorOutput },
  );
  const reply = { current_state: currentState, action: '[{"click_element":{"index":5}}]' };
  const expected = { current_state: currentState, action: [{ click_element: { index: 5 } }] };

  it.each<[StructuredMode, MockResult]>([
    ['native', textResult(JSON.stringify(reply))],
    ['tool', toolCallResult('navigator_output', reply)],
    ['text', textResult('```json\n' + JSON.stringify(reply) + '\n```')],
  ])('normalizes a stringified action in %s mode', async (mode, result) => {
    const { chatModel } = mockChatModel(result, mode);
    const { output } = await generateStructured({
      chatModel,
      messages: [userMessage('state')],
      schema,
      name: 'navigator_output',
    });
    expect(output).toEqual(expected);
  });
});
