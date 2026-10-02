import type {
  AssistantModelMessage,
  FilePart,
  ModelMessage,
  SystemModelMessage,
  TextPart,
  ToolCallPart,
  ToolModelMessage,
  UserModelMessage,
} from 'ai';

/** Name of the tool call used to record agent outputs in the message history */
export const AGENT_OUTPUT_TOOL_NAME = 'AgentOutput';

export function systemMessage(content: string): SystemModelMessage {
  return { role: 'system', content };
}

export function userMessage(content: string | UserModelMessage['content']): UserModelMessage {
  return { role: 'user', content };
}

export function assistantMessage(content: string): AssistantModelMessage {
  return { role: 'assistant', content };
}

export function textPart(text: string): TextPart {
  return { type: 'text', text };
}

/**
 * A base64 image (no data-URL prefix) as a file part
 */
export function imagePart(base64: string, mediaType = 'image/jpeg'): FilePart {
  return { type: 'file', mediaType, data: base64 };
}

/**
 * An assistant message holding one tool call, with an optional text part before it
 */
export function toolCallMessage(args: {
  toolCallId: string;
  input: unknown;
  toolName?: string;
  text?: string;
}): AssistantModelMessage {
  const toolCall: ToolCallPart = {
    type: 'tool-call',
    toolCallId: args.toolCallId,
    toolName: args.toolName ?? AGENT_OUTPUT_TOOL_NAME,
    input: args.input,
  };
  return { role: 'assistant', content: args.text ? [textPart(args.text), toolCall] : [toolCall] };
}

export function toolResultMessage(args: { toolCallId: string; content: string; toolName?: string }): ToolModelMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: args.toolCallId,
        toolName: args.toolName ?? AGENT_OUTPUT_TOOL_NAME,
        output: { type: 'text', value: args.content },
      },
    ],
  };
}

export function isImagePart(part: unknown): part is FilePart {
  if (typeof part !== 'object' || part === null) return false;
  const p = part as { type?: unknown; mediaType?: unknown };
  return p.type === 'file' && typeof p.mediaType === 'string' && p.mediaType.startsWith('image');
}

export function isTextPart(part: unknown): part is TextPart {
  return typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text';
}

/**
 * Concatenate the text of a message, ignoring non-text parts
 */
export function getMessageText(message: ModelMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  let text = '';
  for (const part of message.content) {
    if (isTextPart(part)) {
      text += part.text;
    }
  }
  return text;
}

/**
 * Get the tool-call parts of an assistant message
 */
export function getToolCalls(message: ModelMessage): ToolCallPart[] {
  if (message.role !== 'assistant' || typeof message.content === 'string') {
    return [];
  }
  return message.content.filter((part): part is ToolCallPart => part.type === 'tool-call');
}
