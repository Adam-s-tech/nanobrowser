import {
  APICallError,
  asSchema,
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  RetryError,
  tool,
  ToolChoiceViolationError,
  type FinishReason,
  type FlexibleSchema,
  type ModelMessage,
} from 'ai';
import { createLogger } from '@src/background/log';
import { ResponseParseError } from '@src/background/agent/agents/errors';
import {
  convertInputMessages,
  extractJsonFromModelOutput,
  removeThinkTags,
} from '@src/background/agent/messages/utils';
import type { ChatModel } from './types';

export { jsonSchema, zodSchema } from 'ai';

const logger = createLogger('llm');

// The AI SDK default; LangChain retried 6 times
const MAX_RETRIES = 2;

/**
 * Move system messages out of the history into `instructions`.
 * AI SDK v7 rejects system messages inside `messages`, but the agents keep the system prompt as `messages[0]`.
 */
export function splitInstructions(messages: ModelMessage[]): {
  instructions?: string;
  messages: ModelMessage[];
} {
  const systemTexts: string[] = [];
  const rest: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      systemTexts.push(message.content);
    } else {
      rest.push(message);
    }
  }
  return {
    instructions: systemTexts.length > 0 ? systemTexts.join('\n\n') : undefined,
    messages: rest,
  };
}

function buildCallArgs(chatModel: ChatModel, messages: ModelMessage[], abortSignal?: AbortSignal) {
  const { instructions, messages: rest } = splitInstructions(messages);
  return {
    model: chatModel.model,
    instructions,
    messages: rest,
    ...chatModel.settings,
    providerOptions: chatModel.providerOptions,
    maxRetries: MAX_RETRIES,
    abortSignal,
  };
}

/**
 * Whether a text reply finished normally. `other` counts as normal only without a raw reason, i.e. when the
 * provider reported none; an unrecognized raw reason (e.g. DeepSeek's undocumented ones) means it was interrupted.
 */
function finishedNormally(finishReason: FinishReason | undefined, rawFinishReason: string | undefined): boolean {
  return (
    finishReason === undefined || finishReason === 'stop' || (finishReason === 'other' && rawFinishReason === undefined)
  );
}

/**
 * In tool mode, reject a text reply that didn't finish normally, even if part of it parses, so incomplete actions
 * never run (as in text mode)
 */
function assertTextReplyFinished(
  label: string,
  toolName: string,
  finished: boolean,
  finishReason: FinishReason | undefined,
  rawFinishReason: string | undefined,
  text: string,
): void {
  if (finished) return;
  logger.warning(`[${label}] interrupted reply without the ${toolName} tool call`, {
    finishReason,
    rawFinishReason,
    text: text.slice(0, 500),
  });
  throw new ResponseParseError(
    `Could not parse response from ${label}: the reply ended with finish reason ${rawFinishReason ?? finishReason}`,
  );
}

/**
 * Validate a parsed value against `schema`; returns undefined when it doesn't validate
 */
async function validateOutput<T>(value: unknown, schema: FlexibleSchema<T>): Promise<T | undefined> {
  const validate = asSchema(schema).validate;
  if (!validate) return value as T;
  const result = await validate(value);
  if (result.success) return result.value;
  logger.warning('output validation failed', result.error);
  return undefined;
}

/**
 * Extract JSON from free-form model text (think tags, code fences, Llama tool-call tags) and validate it.
 * Returns undefined when the text can't be parsed or doesn't validate.
 */
export async function manuallyParse<T>(text: string | undefined, schema: FlexibleSchema<T>): Promise<T | undefined> {
  if (!text) return undefined;
  // The raw text first, so think tags inside string values stay intact
  let lastError: unknown;
  for (const candidate of new Set([text, removeThinkTags(text)])) {
    try {
      const output = await validateOutput(extractJsonFromModelOutput(candidate), schema);
      if (output !== undefined) return output;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) logger.warning('manuallyParse failed', lastError);
  return undefined;
}

/**
 * Whether the server rejected the JSON-schema response format, e.g. Ollama's MLX runner, which answers
 * 501 "structured output is unavailable" (retried by the SDK, so it may arrive wrapped in a RetryError)
 */
export function isStructuredOutputUnavailableError(error: unknown): boolean {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  return APICallError.isInstance(cause) && /structured output is unavailable/i.test(cause.message);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface GenerateStructuredArgs<T> {
  chatModel: ChatModel;
  messages: ModelMessage[];
  /** zod schema or `jsonSchema(...)` */
  schema: FlexibleSchema<T>;
  /** Name of the output, e.g. 'navigator_output' */
  name: string;
  /** Name of the tool in `tool` mode; defaults to `name` */
  toolName?: string;
  abortSignal?: AbortSignal;
}

/**
 * Generate an output matching `schema`, using the model's structured mode.
 * Throws `ResponseParseError` when no valid output can be recovered.
 */
export async function generateStructured<T>(args: GenerateStructuredArgs<T>): Promise<{ output: T; rawText?: string }> {
  const { chatModel, schema, name, toolName = name, abortSignal } = args;
  abortSignal?.throwIfAborted();
  // Earlier outputs are never replayed as tool calls, which providers validate (e.g. Claude's thinking blocks and
  // Gemini 3's thought signatures); the history is sent as text instead
  const messages = convertInputMessages(args.messages, toolName);
  const label = `${chatModel.provider}/${chatModel.modelName}`;
  logger.debug(`[${label}] structured call`, { mode: chatModel.structuredMode, name, messageCount: messages.length });

  switch (chatModel.structuredMode) {
    case 'native': {
      try {
        const result = await generateText({
          ...buildCallArgs(chatModel, messages, abortSignal),
          output: Output.object({ schema, name }),
        });
        try {
          return { output: result.output, rawText: result.text };
        } catch (error) {
          if (!NoOutputGeneratedError.isInstance(error)) throw error;
          const parsed = await manuallyParse(result.text, schema);
          if (parsed !== undefined) return { output: parsed, rawText: result.text };
          throw new ResponseParseError(`Could not parse response from ${label}: no output generated`, error);
        }
      } catch (error) {
        if (isStructuredOutputUnavailableError(error)) {
          // The chat model lives for the whole task, so later calls go straight to tool mode
          logger.warning(`[${label}] structured output is unavailable, falling back to tool mode`);
          chatModel.structuredMode = 'tool';
          return generateStructured(args);
        }
        if (!NoObjectGeneratedError.isInstance(error)) throw error;
        // e.g. JSON wrapped in code fences or <think> tags
        const parsed = await manuallyParse(error.text, schema);
        if (parsed !== undefined) {
          logger.debug(`[${label}] recovered output by manual parsing`);
          return { output: parsed, rawText: error.text };
        }
        const cause = error.cause ?? error;
        throw new ResponseParseError(`Could not parse response from ${label}: ${describeError(cause)}`, error);
      }
    }

    case 'tool': {
      const callArgs = buildCallArgs(chatModel, messages, abortSignal);
      // Models that reject forced tool use only get automatic tool choice, so ask for the tool call explicitly
      const toolInstruction = `Return your response by calling the ${toolName} tool, with the JSON described above as its input.`;
      let result;
      try {
        result = await generateText({
          ...callArgs,
          instructions: callArgs.instructions ? `${callArgs.instructions}\n\n${toolInstruction}` : toolInstruction,
          tools: {
            [toolName]: tool({ description: 'Return your response by calling this tool.', inputSchema: schema }),
          },
          toolChoice: chatModel.autoToolChoice ? 'auto' : { type: 'tool', toolName },
        });
      } catch (error) {
        // The SDK rejects replies without the forced tool call; some models answer in text instead.
        // The error has no raw reason, so only a normal stop counts as finished
        if (!ToolChoiceViolationError.isInstance(error)) throw error;
        const text = error.content.map(part => (part.type === 'text' ? part.text : '')).join('');
        assertTextReplyFinished(label, toolName, error.finishReason === 'stop', error.finishReason, undefined, text);
        const parsed = await manuallyParse(text, schema);
        if (parsed !== undefined) return { output: parsed, rawText: text };
        logger.warning(`[${label}] reply without the ${toolName} tool call`, {
          finishReason: error.finishReason,
          toolCalls: error.content.flatMap(part => (part.type === 'tool-call' ? [part.toolName] : [])),
          text: text.slice(0, 500),
        });
        throw new ResponseParseError(`Could not parse response from ${label}: no ${toolName} tool call`, error);
      }
      const call = result.toolCalls.find(c => c.toolName === toolName);
      if (!call) {
        // With automatic tool choice, the model may answer in text instead
        if (chatModel.autoToolChoice) {
          assertTextReplyFinished(
            label,
            toolName,
            finishedNormally(result.finishReason, result.rawFinishReason),
            result.finishReason,
            result.rawFinishReason,
            result.text,
          );
          const parsed = await manuallyParse(result.text, schema);
          if (parsed !== undefined) return { output: parsed, rawText: result.text };
        }
        throw new ResponseParseError(`Could not parse response from ${label}: no ${toolName} tool call`);
      }
      if (call.invalid) {
        throw new ResponseParseError(
          `Could not parse response from ${label}: invalid ${toolName} tool call: ${describeError(call.error)}`,
          call.error,
        );
      }
      return { output: call.input as T, rawText: result.text };
    }

    case 'text': {
      const callArgs = buildCallArgs(chatModel, messages, abortSignal);
      let text: string;
      let finishReason: FinishReason | undefined;
      let rawFinishReason: string | undefined;
      let finished: boolean;
      let reasoningLength = 0;
      try {
        // JSON Output only guarantees syntactically valid JSON, so the text is still parsed and validated below
        const result = chatModel.jsonOutput
          ? await generateText({ ...callArgs, output: Output.json() })
          : await generateText(callArgs);
        text = result.text;
        finishReason = result.finishReason;
        rawFinishReason = result.rawFinishReason;
        finished = finishedNormally(finishReason, rawFinishReason);
        reasoningLength = result.reasoningText?.length ?? 0;
      } catch (error) {
        // JSON Output throws on a reply that isn't valid JSON, e.g. an empty or truncated one
        if (!NoObjectGeneratedError.isInstance(error)) throw error;
        text = error.text ?? '';
        finishReason = error.finishReason;
        // The error has no raw reason, so only a normal stop counts as finished
        finished = finishReason === 'stop';
      }
      const details = { finishReason, rawFinishReason, reasoningLength, text: text.slice(0, 1000) };
      // A reply that didn't finish normally is rejected even if part of it parses, so incomplete actions never run
      if (finishReason === 'length') {
        logger.warning(`[${label}] truncated reply`, details);
        throw new ResponseParseError(`Could not parse response from ${label}: the reply was truncated`);
      }
      if (!finished) {
        logger.warning(`[${label}] interrupted reply`, details);
        throw new ResponseParseError(
          `Could not parse response from ${label}: the reply ended with finish reason ${rawFinishReason ?? finishReason}`,
        );
      }
      if (!text.trim()) {
        logger.warning(`[${label}] empty reply`, details);
        throw new ResponseParseError(`Could not parse response from ${label}: the reply was empty`);
      }
      const parsed = await manuallyParse(text, schema);
      if (parsed === undefined) {
        logger.warning(`[${label}] reply without parseable JSON`, details);
        throw new ResponseParseError(`Could not parse response from ${label}`);
      }
      return { output: parsed, rawText: text };
    }
  }
}

/**
 * Generate plain text, e.g. for speech-to-text.
 */
export async function generatePlainText(args: {
  chatModel: ChatModel;
  messages: ModelMessage[];
  abortSignal?: AbortSignal;
}): Promise<string> {
  args.abortSignal?.throwIfAborted();
  const result = await generateText(buildCallArgs(args.chatModel, args.messages, args.abortSignal));
  return result.text;
}
