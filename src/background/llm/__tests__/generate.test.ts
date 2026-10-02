import { describe, expect, it, vi } from 'vitest';
import { APICallError, generateText, RetryError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type * as AiModule from 'ai';
import { z } from 'zod';
import type { ChatModel, ModelMessage, StructuredMode } from '../types';
import {
  generatePlainText,
  generateStructured,
  isStructuredOutputUnavailableError,
  splitInstructions,
} from '../generate';
import {
  AGENT_OUTPUT_TOOL_NAME,
  imagePart,
  systemMessage,
  textPart,
  toolCallMessage,
  toolResultMessage,
  userMessage,
} from '../messages';
import { isAbortedError, ResponseParseError } from '@src/background/agent/agents/errors';
import { type MockResult, mockChatModel, textResult, toolCallResult } from './mockModel';

vi.mock('ai', async importOriginal => {
  const actual = await importOriginal<typeof AiModule>();
  return { ...actual, generateText: vi.fn(actual.generateText) };
});

const schema = z.object({ answer: z.string() });

const history: ModelMessage[] = [
  systemMessage('navigator system prompt'),
  userMessage('task'),
  toolCallMessage({ toolCallId: '1', input: { action: [] } }),
  toolResultMessage({ toolCallId: '1', content: 'Browser started' }),
  userMessage('state'),
];

describe('history sent as text', () => {
  it.each<StructuredMode>(['native', 'tool', 'text'])(
    'sends no tool calls or results in %s mode; own outputs stay assistant turns',
    async mode => {
      const result =
        mode === 'tool' ? toolCallResult(AGENT_OUTPUT_TOOL_NAME, { answer: 'ok' }) : textResult('{"answer":"ok"}');
      const { chatModel, model } = mockChatModel(result, mode);
      await generateStructured({
        chatModel,
        messages: history,
        schema,
        name: 'navigator_output',
        toolName: AGENT_OUTPUT_TOOL_NAME,
      });

      const prompt = model.doGenerateCalls[0].prompt;
      expect(prompt.some(m => m.role === 'tool')).toBe(false);
      expect(prompt.flatMap(m => (m.role === 'assistant' ? m.content : []))).toEqual([
        { type: 'text', text: JSON.stringify({ action: [] }) },
      ]);
    },
  );

  it("sends another agent's outputs as user context", async () => {
    const { chatModel, model } = mockChatModel(textResult('{"answer":"ok"}'), 'native');
    await generateStructured({ chatModel, messages: history, schema, name: 'planner_output' });

    const prompt = model.doGenerateCalls[0].prompt;
    expect(prompt.some(m => m.role === 'assistant' || m.role === 'tool')).toBe(false);
    expect(JSON.stringify(prompt)).toContain('Output of another agent:');
  });
});

describe('splitInstructions', () => {
  it('moves system messages into instructions', () => {
    const { instructions, messages } = splitInstructions(history);
    expect(instructions).toBe('navigator system prompt');
    expect(messages.some(m => m.role === 'system')).toBe(false);
    expect(messages).toHaveLength(history.length - 1);
  });

  it('returns no instructions when there is no system message', () => {
    expect(splitInstructions([userMessage('hi')]).instructions).toBeUndefined();
  });
});

describe('generateStructured', () => {
  it('sends exactly one system message, the history system prompt', async () => {
    const { chatModel, model } = mockChatModel(textResult('{"answer":"ok"}'));
    await generateStructured({ chatModel, messages: history, schema, name: 'navigator_output' });

    const prompt = model.doGenerateCalls[0].prompt;
    const systems = prompt.filter(m => m.role === 'system');
    expect(systems).toHaveLength(1);
    expect(prompt[0]).toEqual({ role: 'system', content: 'navigator system prompt' });
  });

  it("uses the planner's system prompt when it replaces messages[0]", async () => {
    const { chatModel, model } = mockChatModel(textResult('{"answer":"ok"}'));
    const plannerMessages = [systemMessage('planner system prompt'), ...history.slice(1)];
    await generateStructured({ chatModel, messages: plannerMessages, schema, name: 'planner_output' });

    const systems = model.doGenerateCalls[0].prompt.filter(m => m.role === 'system');
    expect(systems).toEqual([{ role: 'system', content: 'planner system prompt' }]);
  });

  it('passes settings and maxRetries through', async () => {
    const { chatModel, model } = mockChatModel(textResult('{"answer":"ok"}'), 'native', {
      settings: { maxOutputTokens: 100, reasoning: 'low' },
    });
    await generateStructured({ chatModel, messages: history, schema, name: 'planner_output' });

    const call = model.doGenerateCalls[0];
    expect(call.temperature).toBeUndefined();
    expect(call.topP).toBeUndefined();
    expect(call.reasoning).toBe('low');
    expect(call.maxOutputTokens).toBe(100);
  });

  it('passes maxRetries: 2 and the abort signal to generateText', async () => {
    const { chatModel } = mockChatModel(textResult('{"answer":"ok"}'));
    const controller = new AbortController();
    await generateStructured({ chatModel, messages: history, schema, name: 'x', abortSignal: controller.signal });

    expect(vi.mocked(generateText)).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxRetries: 2, abortSignal: controller.signal }),
    );
  });

  describe('native mode', () => {
    it('returns the parsed output and sends a json response format with the schema and name', async () => {
      const { chatModel, model } = mockChatModel(textResult('{"answer":"ok"}'));
      const { output } = await generateStructured({ chatModel, messages: history, schema, name: 'planner_output' });

      expect(output).toEqual({ answer: 'ok' });
      const responseFormat = model.doGenerateCalls[0].responseFormat;
      expect(responseFormat?.type).toBe('json');
      if (responseFormat?.type === 'json') {
        expect(responseFormat.name).toBe('planner_output');
        expect(responseFormat.schema).toMatchObject({ type: 'object', properties: { answer: { type: 'string' } } });
      }
    });

    it('rescues fenced JSON by manual parsing', async () => {
      const { chatModel } = mockChatModel(textResult('```json\n{"answer":"fenced"}\n```'));
      const { output } = await generateStructured({ chatModel, messages: history, schema, name: 'x' });
      expect(output).toEqual({ answer: 'fenced' });
    });

    it('rescues JSON wrapped in think tags', async () => {
      const { chatModel } = mockChatModel(textResult('<think>hmm</think>{"answer":"thought"}'));
      const { output } = await generateStructured({ chatModel, messages: history, schema, name: 'x' });
      expect(output).toEqual({ answer: 'thought' });
    });

    it('throws ResponseParseError for output that cannot be rescued', async () => {
      const { chatModel } = mockChatModel(textResult('{"wrong":1}'));
      await expect(generateStructured({ chatModel, messages: history, schema, name: 'x' })).rejects.toBeInstanceOf(
        ResponseParseError,
      );
    });

    it('throws ResponseParseError when no text is generated', async () => {
      const { chatModel } = mockChatModel({
        ...textResult(''),
        finishReason: { unified: 'length', raw: 'length' },
      });
      await expect(generateStructured({ chatModel, messages: history, schema, name: 'x' })).rejects.toBeInstanceOf(
        ResponseParseError,
      );
    });
  });

  describe('native mode fallback', () => {
    // What Ollama's MLX runner returns for any response format; not retryable here to skip the SDK backoff
    const unavailableError = (isRetryable = false) =>
      new APICallError({
        message: 'structured output is unavailable',
        url: 'http://localhost:11434/v1/chat/completions',
        requestBodyValues: {},
        statusCode: 501,
        isRetryable,
      });

    it('detects the error directly and inside a RetryError', () => {
      expect(isStructuredOutputUnavailableError(unavailableError())).toBe(true);
      const retryError = new RetryError({
        message: 'Failed after 3 attempts. Last error: structured output is unavailable',
        reason: 'maxRetriesExceeded',
        errors: [unavailableError(true), unavailableError(true), unavailableError(true)],
      });
      expect(isStructuredOutputUnavailableError(retryError)).toBe(true);
    });

    it('ignores other API errors', () => {
      const error = new APICallError({ message: 'model not found', url: 'u', requestBodyValues: {}, statusCode: 404 });
      expect(isStructuredOutputUnavailableError(error)).toBe(false);
      expect(isStructuredOutputUnavailableError(new Error('structured output is unavailable'))).toBe(false);
    });

    it('retries in tool mode and keeps using tool mode for later calls', async () => {
      const results = [toolCallResult('x', { answer: 'first' }), toolCallResult('x', { answer: 'second' })];
      let calls = 0;
      const model = new MockLanguageModelV4({
        doGenerate: async () => {
          calls++;
          if (calls === 1) throw unavailableError();
          return results[calls - 2];
        },
      });
      const chatModel: ChatModel = {
        provider: 'ollama-local',
        modelName: 'qwen3.8:27b-mlx',
        model,
        settings: {},
        structuredMode: 'native',
      };

      const first = await generateStructured({ chatModel, messages: history, schema, name: 'x' });
      const second = await generateStructured({ chatModel, messages: history, schema, name: 'x' });

      expect(first.output).toEqual({ answer: 'first' });
      expect(second.output).toEqual({ answer: 'second' });
      expect(chatModel.structuredMode).toBe('tool');
      expect(model.doGenerateCalls).toHaveLength(3);
      expect(model.doGenerateCalls[0].responseFormat?.type).toBe('json');
      for (const call of model.doGenerateCalls.slice(1)) {
        expect(call.responseFormat?.type).not.toBe('json');
        expect(call.toolChoice).toEqual({ type: 'tool', toolName: 'x' });
      }
    });

    it('does not fall back on other API errors', async () => {
      const model = new MockLanguageModelV4({
        doGenerate: async () => {
          throw new APICallError({ message: 'model not found', url: 'u', requestBodyValues: {}, statusCode: 404 });
        },
      });
      const chatModel: ChatModel = { provider: 'p', modelName: 'm', model, settings: {}, structuredMode: 'native' };
      await expect(generateStructured({ chatModel, messages: history, schema, name: 'x' })).rejects.toBeInstanceOf(
        APICallError,
      );
      expect(chatModel.structuredMode).toBe('native');
    });
  });

  describe('tool mode', () => {
    it('forces the tool and returns its input', async () => {
      const { chatModel, model } = mockChatModel(toolCallResult('planner_output', { answer: 'tool' }), 'tool');
      const { output } = await generateStructured({ chatModel, messages: history, schema, name: 'planner_output' });

      expect(output).toEqual({ answer: 'tool' });
      const call = model.doGenerateCalls[0];
      expect(call.toolChoice).toEqual({ type: 'tool', toolName: 'planner_output' });
      expect(call.tools?.map(t => t.name)).toEqual(['planner_output']);
      expect(call.responseFormat?.type ?? 'text').toBe('text');
    });

    it('throws ResponseParseError for a tool call that fails validation', async () => {
      const { chatModel } = mockChatModel(toolCallResult('planner_output', { answer: 42 }), 'tool');
      await expect(
        generateStructured({ chatModel, messages: history, schema, name: 'planner_output' }),
      ).rejects.toBeInstanceOf(ResponseParseError);
    });

    it('throws ResponseParseError when there is no tool call and the text is unparseable', async () => {
      const { chatModel } = mockChatModel(textResult('I cannot do that'), 'tool');
      await expect(
        generateStructured({ chatModel, messages: history, schema, name: 'planner_output' }),
      ).rejects.toBeInstanceOf(ResponseParseError);
    });

    it('offers, forces and reads the tool under toolName when given', async () => {
      const { chatModel, model } = mockChatModel(toolCallResult(AGENT_OUTPUT_TOOL_NAME, { answer: 'named' }), 'tool');
      const { output } = await generateStructured({
        chatModel,
        messages: history,
        schema,
        name: 'navigator_output',
        toolName: AGENT_OUTPUT_TOOL_NAME,
      });

      expect(output).toEqual({ answer: 'named' });
      const call = model.doGenerateCalls[0];
      expect(call.tools?.map(t => t.name)).toEqual([AGENT_OUTPUT_TOOL_NAME]);
      expect(call.toolChoice).toEqual({ type: 'tool', toolName: AGENT_OUTPUT_TOOL_NAME });
      expect(JSON.stringify(call.prompt[0])).toContain(`calling the ${AGENT_OUTPUT_TOOL_NAME} tool`);
    });

    it('does not accept a call to any other tool', async () => {
      const { chatModel } = mockChatModel(toolCallResult('other_tool', { answer: 'x' }), 'tool');
      await expect(
        generateStructured({ chatModel, messages: history, schema, name: 'planner_output' }),
      ).rejects.toBeInstanceOf(ResponseParseError);
    });

    it('does not accept an AgentOutput call when another tool is requested', async () => {
      const { chatModel } = mockChatModel(toolCallResult(AGENT_OUTPUT_TOOL_NAME, { answer: 'x' }), 'tool');
      await expect(
        generateStructured({ chatModel, messages: history, schema, name: 'planner_output' }),
      ).rejects.toBeInstanceOf(ResponseParseError);
    });

    it('rescues valid JSON text when there is no tool call', async () => {
      const { chatModel } = mockChatModel(textResult('{"answer":"text"}'), 'tool');
      const { output } = await generateStructured({ chatModel, messages: history, schema, name: 'planner_output' });
      expect(output).toEqual({ answer: 'text' });
    });

    it('offers the tool with automatic choice when the model asks for it', async () => {
      const { chatModel, model } = mockChatModel(toolCallResult('planner_output', { answer: 'tool' }), 'tool', {
        autoToolChoice: true,
      });
      const { output } = await generateStructured({ chatModel, messages: history, schema, name: 'planner_output' });

      expect(output).toEqual({ answer: 'tool' });
      const call = model.doGenerateCalls[0];
      expect(call.toolChoice).toEqual({ type: 'auto' });
      expect(JSON.stringify(call.prompt[0])).toContain('calling the planner_output tool');
    });

    it('parses JSON text when automatic tool choice gets no tool call', async () => {
      const { chatModel } = mockChatModel(textResult('{"answer":"text"}'), 'tool', { autoToolChoice: true });
      const { output } = await generateStructured({ chatModel, messages: history, schema, name: 'planner_output' });
      expect(output).toEqual({ answer: 'text' });
    });

    it.each<[MockResult['finishReason']['unified'], string]>([
      ['length', 'max_tokens'],
      ['length', 'length'],
      ['content-filter', 'refusal'],
      ['other', 'pause_turn'],
    ])('rejects valid JSON text that ended with %s (%s) under automatic tool choice', async (unified, raw) => {
      const result: MockResult = { ...textResult('{"answer":"text"}'), finishReason: { unified, raw } };
      const { chatModel } = mockChatModel(result, 'tool', { autoToolChoice: true });
      await expect(
        generateStructured({ chatModel, messages: history, schema, name: 'planner_output' }),
      ).rejects.toThrow(`finish reason ${raw}`);
    });

    it.each<MockResult['finishReason']['unified']>(['length', 'content-filter', 'other'])(
      'rejects valid JSON text that ended with %s when the forced tool call is missing',
      async unified => {
        const result: MockResult = { ...textResult('{"answer":"text"}'), finishReason: { unified, raw: 'raw' } };
        const { chatModel } = mockChatModel(result, 'tool');
        await expect(
          generateStructured({ chatModel, messages: history, schema, name: 'planner_output' }),
        ).rejects.toThrow(`finish reason ${unified}`);
      },
    );

    it('throws ResponseParseError when automatic tool choice gets unparseable text', async () => {
      const { chatModel } = mockChatModel(textResult('I cannot do that'), 'tool', { autoToolChoice: true });
      await expect(
        generateStructured({ chatModel, messages: history, schema, name: 'planner_output' }),
      ).rejects.toBeInstanceOf(ResponseParseError);
    });
  });

  describe('text mode', () => {
    it('parses JSON from the text without sending a response format or tools', async () => {
      const { chatModel, model } = mockChatModel(textResult('```json\n{"answer":"llama"}\n```'), 'text');
      const { output } = await generateStructured({ chatModel, messages: history, schema, name: 'x' });

      expect(output).toEqual({ answer: 'llama' });
      const call = model.doGenerateCalls[0];
      expect(call.responseFormat?.type ?? 'text').toBe('text');
      expect(call.tools ?? []).toHaveLength(0);
    });

    it('sends DeepSeek its own history outputs as bare JSON assistant turns', async () => {
      const { chatModel, model } = mockChatModel(textResult('{"answer":"deepseek"}'), 'text', {
        modelName: 'deepseek-flash',
      });
      await generateStructured({ chatModel, messages: history, schema, name: 'x', toolName: AGENT_OUTPUT_TOOL_NAME });

      const prompt = model.doGenerateCalls[0].prompt;
      expect(prompt.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
      expect(prompt[2].content).toEqual([{ type: 'text', text: '{"action":[]}' }]);
      const lastUser = JSON.stringify(prompt[3].content);
      expect(lastUser).toContain('Browser started\\n\\nstate');
    });

    it("sends DeepSeek another agent's history outputs as user context", async () => {
      const { chatModel, model } = mockChatModel(textResult('{"answer":"deepseek"}'), 'text', {
        modelName: 'deepseek-flash',
      });
      await generateStructured({ chatModel, messages: history, schema, name: 'planner_output' });

      const prompt = model.doGenerateCalls[0].prompt;
      expect(prompt.map(m => m.role)).toEqual(['system', 'user']);
      const user = JSON.stringify(prompt[1].content);
      expect(user).toContain('Output of another agent:\\n{\\"action\\":[]}');
      expect(user).toContain('Browser started');
      expect(user).not.toContain(AGENT_OUTPUT_TOOL_NAME);
    });

    it('keeps image parts when merging DeepSeek user messages', async () => {
      const { chatModel, model } = mockChatModel(textResult('{"answer":"deepseek"}'), 'text', {
        modelName: 'deepseek-flash',
      });
      const messages: ModelMessage[] = [
        userMessage([textPart('state'), imagePart('aGVsbG8=')]),
        userMessage('next'),
        userMessage('last'),
      ];
      await generateStructured({ chatModel, messages, schema, name: 'planner_output' });

      const prompt = model.doGenerateCalls[0].prompt;
      expect(prompt).toHaveLength(1);
      const parts = prompt[0].content as { type: string; text?: string }[];
      expect(parts.map(p => p.type)).toEqual(['text', 'file', 'text', 'text']);
      expect(parts.filter(p => p.type === 'text').map(p => p.text)).toEqual(['state', 'next', 'last']);
    });

    it.each([
      ['a <plan> wrapper copied from the history', '<plan>{"answer":"planned"}</plan>'],
      ['a sentence before the JSON', 'Here is my answer: {"answer":"planned"}'],
      ['code fences', 'Answer:\n```json\n{"answer":"planned"}\n```'],
    ])('parses JSON surrounded by %s', async (_label, text) => {
      const { chatModel } = mockChatModel(textResult(text), 'text');
      const { output } = await generateStructured({ chatModel, messages: history, schema, name: 'x' });
      expect(output).toEqual({ answer: 'planned' });
    });

    it('keeps code fences inside JSON string values', async () => {
      const answer = 'Run:\n```js\nconsole.log(1);\n```\ndone';
      const { chatModel } = mockChatModel(textResult(JSON.stringify({ answer })), 'text');
      const { output } = await generateStructured({ chatModel, messages: history, schema, name: 'x' });
      expect(output).toEqual({ answer });
    });

    it('throws ResponseParseError when the text has no JSON', async () => {
      const { chatModel } = mockChatModel(textResult('no json here'), 'text');
      await expect(generateStructured({ chatModel, messages: history, schema, name: 'x' })).rejects.toBeInstanceOf(
        ResponseParseError,
      );
    });

    const finishedWith = (text: string, unified: MockResult['finishReason']['unified'], raw?: string): MockResult => ({
      ...textResult(text),
      finishReason: { unified, raw },
    });

    it.each<[string, boolean]>([
      ['{"answer":"cut"}', false],
      ['{"answer":"cut"}', true],
      ['{"answer":"cu', false],
      ['{"answer":"cu', true],
    ])('rejects a truncated reply %s (jsonOutput %s)', async (text, jsonOutput) => {
      const { chatModel } = mockChatModel(finishedWith(text, 'length', 'length'), 'text', { jsonOutput });
      const error = await generateStructured({ chatModel, messages: history, schema, name: 'x' }).catch(e => e);
      expect(error).toBeInstanceOf(ResponseParseError);
      expect(error.message).toContain('truncated');
    });

    it.each<[MockResult['finishReason']['unified'], string | undefined, string, boolean]>([
      ['error', 'insufficient_system_resource', 'insufficient_system_resource', false],
      ['error', 'insufficient_system_resource', 'insufficient_system_resource', true],
      ['other', 'aborted', 'aborted', false],
      ['other', 'aborted', 'aborted', true],
      ['content-filter', 'content_filter', 'content_filter', true],
    ])('rejects a parseable reply that ended with %s (%s, jsonOutput %s)', async (unified, raw, reason, jsonOutput) => {
      const { chatModel } = mockChatModel(finishedWith('{"answer":"partial"}', unified, raw), 'text', { jsonOutput });
      const error = await generateStructured({ chatModel, messages: history, schema, name: 'x' }).catch(e => e);
      expect(error).toBeInstanceOf(ResponseParseError);
      expect(error.message).toContain(`finish reason ${reason}`);
    });

    it('rejects a reply that is not JSON and did not stop normally under JSON Output', async () => {
      const { chatModel } = mockChatModel(finishedWith('```json\n{"answer":"x"}\n```', 'other', 'aborted'), 'text', {
        jsonOutput: true,
      });
      const error = await generateStructured({ chatModel, messages: history, schema, name: 'x' }).catch(e => e);
      expect(error).toBeInstanceOf(ResponseParseError);
      expect(error.message).toContain('finish reason other');
    });

    it('accepts a reply whose provider reported no finish reason', async () => {
      const { chatModel } = mockChatModel(finishedWith('{"answer":"ok"}', 'other'), 'text');
      const { output } = await generateStructured({ chatModel, messages: history, schema, name: 'x' });
      expect(output).toEqual({ answer: 'ok' });
    });

    it.each([false, true])('rejects an empty reply (jsonOutput %s)', async jsonOutput => {
      const { chatModel } = mockChatModel(textResult('  '), 'text', { jsonOutput });
      const error = await generateStructured({ chatModel, messages: history, schema, name: 'x' }).catch(e => e);
      expect(error).toBeInstanceOf(ResponseParseError);
      expect(error.message).toContain('empty');
    });

    describe('with JSON Output', () => {
      it('requests JSON without a schema and validates the reply locally', async () => {
        const { chatModel, model } = mockChatModel(textResult('{"answer":"json"}'), 'text', { jsonOutput: true });
        const { output } = await generateStructured({ chatModel, messages: history, schema, name: 'x' });

        expect(output).toEqual({ answer: 'json' });
        const call = model.doGenerateCalls[0];
        expect(call.responseFormat).toEqual({ type: 'json' });
        expect(call.tools ?? []).toHaveLength(0);
      });

      it('recovers JSON wrapped in code fences', async () => {
        const { chatModel } = mockChatModel(textResult('```json\n{"answer":"fenced"}\n```'), 'text', {
          jsonOutput: true,
        });
        const { output } = await generateStructured({ chatModel, messages: history, schema, name: 'x' });
        expect(output).toEqual({ answer: 'fenced' });
      });

      it('throws ResponseParseError for valid JSON that fails the schema', async () => {
        const { chatModel } = mockChatModel(textResult('{"answer":42}'), 'text', { jsonOutput: true });
        await expect(generateStructured({ chatModel, messages: history, schema, name: 'x' })).rejects.toBeInstanceOf(
          ResponseParseError,
        );
      });

      it('throws ResponseParseError for text that is not JSON', async () => {
        const { chatModel } = mockChatModel(textResult('no json here'), 'text', { jsonOutput: true });
        await expect(generateStructured({ chatModel, messages: history, schema, name: 'x' })).rejects.toBeInstanceOf(
          ResponseParseError,
        );
      });
    });
  });

  it('rejects an already-aborted signal with an abort error', async () => {
    const { chatModel } = mockChatModel(textResult('{"answer":"ok"}'));
    const controller = new AbortController();
    controller.abort();
    const error = await generateStructured({
      chatModel,
      messages: history,
      schema,
      name: 'x',
      abortSignal: controller.signal,
    }).catch(e => e);
    expect(isAbortedError(error)).toBe(true);
  });
});

describe('generatePlainText', () => {
  it('returns the generated text', async () => {
    const { chatModel } = mockChatModel(textResult('hello world'));
    expect(await generatePlainText({ chatModel, messages: [userMessage('hi')] })).toBe('hello world');
  });
});
