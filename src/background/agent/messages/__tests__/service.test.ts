import { describe, expect, it } from 'vitest';
import MessageManager, { MessageManagerSettings } from '../service';
import { imagePart, systemMessage, textPart, userMessage } from '@src/background/llm/messages';
import type { ModelMessage } from '@src/background/llm/types';

function newManager(options: ConstructorParameters<typeof MessageManagerSettings>[0] = {}) {
  const manager = new MessageManager(new MessageManagerSettings(options));
  manager.initTaskMessages(systemMessage('system prompt'), 'find the price');
  return manager;
}

function sumTokens(manager: MessageManager): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const history = (manager as any).history;
  return history.messages.reduce((sum: number, m: { metadata: { tokens: number } }) => sum + m.metadata.tokens, 0);
}

function totalTokens(manager: MessageManager): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (manager as any).history.totalTokens;
}

describe('MessageManager', () => {
  it('initTaskMessages produces system, task, example tool call, tool result, and the history marker', () => {
    const messages = newManager().getMessages();
    expect(messages.map(m => m.role)).toEqual(['system', 'user', 'user', 'assistant', 'tool', 'user']);

    const [call] = messages[3].content as { type: string; toolCallId: string; toolName: string }[];
    expect(call).toMatchObject({ type: 'tool-call', toolName: 'AgentOutput' });
    const [result] = messages[4].content as { type: string; toolCallId: string; output: unknown }[];
    expect(result).toMatchObject({ type: 'tool-result', toolName: 'AgentOutput', toolCallId: call.toolCallId });
    expect(result.output).toEqual({ type: 'text', value: 'Browser started' });
    expect(messages[5]).toEqual(userMessage('[Your task history memory starts here]'));
  });

  it('addModelOutput and removeLastStateMessage keep totalTokens consistent', () => {
    const manager = newManager();
    manager.addStateMessage(userMessage('state '.repeat(100)));
    expect(totalTokens(manager)).toBe(sumTokens(manager));

    manager.removeLastStateMessage();
    manager.addModelOutput({ current_state: { next_goal: 'click' }, action: [{ click_element: { index: 1 } }] });
    expect(totalTokens(manager)).toBe(sumTokens(manager));

    const messages = manager.getMessages();
    const assistant = messages[messages.length - 2];
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toEqual([
      { type: 'text', text: 'tool call' },
      expect.objectContaining({ type: 'tool-call', toolName: 'AgentOutput', toolCallId: '2' }),
    ]);
    expect(messages[messages.length - 1].role).toBe('tool');
  });

  it('counts image file parts as imageTokens and tool calls from their JSON', () => {
    const manager = newManager({ imageTokens: 800, estimatedCharactersPerToken: 3 });
    const before = totalTokens(manager);
    manager.addStateMessage(userMessage([textPart('abcdef'), imagePart('AAAA')]));
    expect(totalTokens(manager) - before).toBe(800 + 2);

    const afterState = totalTokens(manager);
    manager.addModelOutput({ action: [] });
    expect(totalTokens(manager)).toBeGreaterThan(afterState);
  });

  it('cutMessages drops the image before truncating text', () => {
    const manager = newManager({ imageTokens: 800 });
    const base = totalTokens(manager);
    const text = 'x'.repeat(3000); // 1000 tokens
    manager.addStateMessage(userMessage([textPart(text), imagePart('AAAA')]));

    // limit leaves room for the text but not the image
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).settings.maxInputTokens = base + 1000;
    manager.cutMessages();
    let last = manager.getMessages().at(-1) as ModelMessage;
    expect(last).toEqual(userMessage(text));
    expect(totalTokens(manager)).toBe(sumTokens(manager));

    // a tighter limit truncates the text
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).settings.maxInputTokens = base + 500;
    manager.cutMessages();
    last = manager.getMessages().at(-1) as ModelMessage;
    expect(typeof last.content).toBe('string');
    expect((last.content as string).length).toBeLessThan(text.length);
    expect(totalTokens(manager)).toBe(sumTokens(manager));
  });

  it('replaces sensitive data in string and text-part content', () => {
    const manager = newManager({ sensitiveData: { password: 'hunter2' } });
    manager.addStateMessage(userMessage('my password is hunter2'));
    manager.addStateMessage(userMessage([textPart('type hunter2'), imagePart('AAAA')]));

    const messages = manager.getMessages();
    expect(messages.at(-2)).toEqual(userMessage('my password is <secret>password</secret>'));
    expect(messages.at(-1)).toEqual(userMessage([textPart('type <secret>password</secret>'), imagePart('AAAA')]));
  });
});
