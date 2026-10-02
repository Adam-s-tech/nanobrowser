import { createLogger } from '@src/background/log';
import { repairJsonString } from '@src/background/utils';

const logger = createLogger('NavigatorOutput');

export interface NavigatorOutput {
  current_state?: Record<string, unknown>;
  action: Record<string, unknown>[];
  [key: string]: unknown;
}

export type NavigatorValidationResult = { success: true; value: NavigatorOutput } | { success: false; error: Error };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Fix the action field to be an array of objects: models sometimes return it as a (possibly malformed)
 * JSON string or as a single object, and arrays may contain null entries.
 * Throws `Invalid action output format` when a string can't be parsed even after repair.
 */
export function normalizeNavigatorOutput(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return raw;
  }

  let action = raw.action;
  if (typeof action === 'string') {
    logger.warning('Unexpected action format', action);
    try {
      // First try to parse the action string directly
      action = JSON.parse(action);
    } catch {
      try {
        // If direct parsing fails, try to fix the JSON first
        const fixedAction = repairJsonString(action as string);
        logger.info('Fixed action string', fixedAction);
        action = JSON.parse(fixedAction);
      } catch {
        logger.error('Invalid action format even after repair attempt', action);
        throw new Error('Invalid action output format');
      }
    }
    if (typeof action !== 'object' || action === null) {
      logger.error('Action string did not parse into actions', raw.action);
      throw new Error('Invalid action output format');
    }
  }

  if (Array.isArray(action)) {
    // if the item is null, skip it
    const actions = action.filter(item => item !== null);
    if (actions.length === 0) {
      logger.warning('No valid actions found', action);
    }
    action = actions;
  } else if (action !== undefined && action !== null) {
    // if the action is neither an array nor a string, it should be an object
    action = [action];
  }

  return { ...raw, action };
}

/**
 * Validate a navigator reply: normalize it, then check only the envelope.
 * Action names and arguments are checked later when the actions run, so a bad action becomes
 * a soft action error the model sees on its next step instead of a failed step.
 */
export function validateNavigatorOutput(raw: unknown): NavigatorValidationResult {
  let value: unknown;
  try {
    value = normalizeNavigatorOutput(raw);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
  }

  if (!isRecord(value)) {
    return { success: false, error: new Error('Navigator output must be an object') };
  }
  if (value.current_state !== undefined && !isRecord(value.current_state)) {
    return { success: false, error: new Error('Navigator output current_state must be an object') };
  }
  if (!Array.isArray(value.action) || !value.action.every(isRecord)) {
    return { success: false, error: new Error('Navigator output action must be an array of objects') };
  }
  return { success: true, value: value as NavigatorOutput };
}
