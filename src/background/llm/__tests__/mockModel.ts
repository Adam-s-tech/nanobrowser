import { MockLanguageModelV4 } from 'ai/test';
import type { ChatModel, StructuredMode } from '../types';

export type MockResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

export function textResult(text: string): MockResult {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: 'stop' as const, raw: 'stop' },
    usage,
    warnings: [],
  };
}

export function toolCallResult(toolName: string, input: unknown, text?: string): MockResult {
  return {
    content: [
      ...(text ? [{ type: 'text' as const, text }] : []),
      {
        type: 'tool-call' as const,
        toolCallId: 'call-1',
        toolName,
        input: typeof input === 'string' ? input : JSON.stringify(input),
      },
    ],
    finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
    usage,
    warnings: [],
  };
}

export function mockChatModel(
  results: MockResult | MockResult[],
  structuredMode: StructuredMode = 'native',
  overrides: Partial<ChatModel> = {},
): { chatModel: ChatModel; model: MockLanguageModelV4 } {
  const model = new MockLanguageModelV4({ doGenerate: results });
  return {
    model,
    chatModel: {
      provider: 'openai',
      modelName: 'mock-model',
      model,
      settings: {},
      structuredMode,
      ...overrides,
    },
  };
}
