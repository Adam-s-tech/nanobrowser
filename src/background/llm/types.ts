import type {
  FlexibleSchema,
  JSONSchema7,
  LanguageModel,
  ModelMessage,
  generateText,
  SystemModelMessage,
  UserModelMessage,
  AssistantModelMessage,
  ToolModelMessage,
} from 'ai';

/** Provider-specific options keyed by provider name, as accepted by `generateText` */
export type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]['providerOptions']>;

/**
 * How structured output is requested from a model.
 * - `native`: `Output.object`, mapped by the provider to its JSON-schema response format; switches to `tool`
 *   when the server rejects response formats ("structured output is unavailable")
 * - `tool`: a single forced tool call whose input is the output; models that reject forced tool use
 *   (newer Claude models) get the tool with automatic choice plus a prompt instruction instead
 * - `text`: plain text generation followed by manual JSON extraction
 */
export type StructuredMode = 'native' | 'tool' | 'text';

/** Call settings. Temperature and top P are never sent, so sampling is left to each model's defaults */
export interface ChatModelSettings {
  maxOutputTokens?: number;
  /** The AI SDK's provider-independent reasoning effort; unset leaves the model's default reasoning */
  reasoning?: Parameters<typeof generateText>[0]['reasoning'];
}

/**
 * A configured model plus everything needed to call it.
 * Built by `createChatModel` and consumed by `generateStructured` / `generatePlainText`.
 */
export interface ChatModel {
  /** Provider id, e.g. 'openai' or a custom id such as 'azure_openai_2' */
  provider: string;
  /** Model name as configured (the deployment name for Azure) */
  modelName: string;
  model: LanguageModel;
  settings: ChatModelSettings;
  providerOptions?: ProviderOptions;
  structuredMode: StructuredMode;
  /** In text mode, request the provider's JSON mode (DeepSeek JSON Output); the output is still validated locally */
  jsonOutput?: boolean;
  /** In tool mode, offer the tool with automatic choice: Claude rejects a forced tool choice while thinking */
  autoToolChoice?: boolean;
}

export type {
  FlexibleSchema,
  JSONSchema7,
  ModelMessage,
  SystemModelMessage,
  UserModelMessage,
  AssistantModelMessage,
  ToolModelMessage,
};
