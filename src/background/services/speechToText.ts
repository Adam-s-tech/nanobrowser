import { createLogger } from '../log';
import { type ProviderConfig, speechToTextModelStore } from '@extension/storage';
import { t } from '@extension/i18n';
import type { ChatModel } from '../llm/types';
import { generatePlainText } from '../llm/generate';
import { createSpeechToTextModel } from '../llm/providers';
import { textPart, userMessage } from '../llm/messages';

const logger = createLogger('SpeechToText');

export class SpeechToTextService {
  private llm: ChatModel;

  private constructor(llm: ChatModel) {
    this.llm = llm;
  }

  static async create(providers: Record<string, ProviderConfig>): Promise<SpeechToTextService> {
    try {
      const config = await speechToTextModelStore.getSpeechToTextModel();

      if (!config?.provider || !config?.modelName) {
        throw new Error(t('chat_stt_model_notFound'));
      }

      const provider = providers[config.provider];
      logger.info('Found provider for speech-to-text:', provider ? 'yes' : 'no', provider?.type);

      if (!provider || provider.type !== 'gemini') {
        throw new Error(t('chat_stt_model_notFound'));
      }

      const llm = createSpeechToTextModel(config.provider, provider.apiKey, config.modelName);
      logger.info(`Speech-to-text service created with model: ${config.modelName}`);
      return new SpeechToTextService(llm);
    } catch (error) {
      logger.error('Failed to create speech-to-text service:', error);
      throw error;
    }
  }

  async transcribeAudio(base64Audio: string): Promise<string> {
    try {
      logger.info('Starting audio transcription...');

      // Create transcription message with audio data
      const transcriptionMessage = userMessage([
        textPart(
          'Transcribe this audio. Return only the transcribed text without any additional formatting or explanations.',
        ),
        { type: 'file', mediaType: 'audio/webm', data: base64Audio },
      ]);

      // Get transcription from Gemini
      const transcriptionResponse = await generatePlainText({ chatModel: this.llm, messages: [transcriptionMessage] });

      const transcribedText = transcriptionResponse.trim();
      logger.info('Audio transcription completed:', transcribedText);

      return transcribedText;
    } catch (error) {
      logger.error('Failed to transcribe audio:', error);
      throw new Error(`Speech transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
