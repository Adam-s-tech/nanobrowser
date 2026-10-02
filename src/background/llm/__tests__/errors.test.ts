import { describe, expect, it } from 'vitest';
import { APICallError, LoadAPIKeyError, RetryError } from 'ai';
import {
  isAbortedError,
  isAuthenticationError,
  isBadRequestError,
  isForbiddenError,
} from '@src/background/agent/agents/errors';

function apiCallError(statusCode: number, responseBody = '{}') {
  return new APICallError({
    message: 'Request failed',
    url: 'https://api.example.com/v1/chat/completions',
    requestBodyValues: {},
    statusCode,
    responseBody,
    isRetryable: statusCode >= 500,
  });
}

function retryError(lastError: unknown) {
  return new RetryError({ message: 'Failed after 3 attempts', reason: 'maxRetriesExceeded', errors: [lastError] });
}

describe('error classification', () => {
  it.each([
    [401, isAuthenticationError],
    [403, isForbiddenError],
    [400, isBadRequestError],
  ])('maps APICallError %s', (status, check) => {
    expect(check(apiCallError(status))).toBe(true);
    expect(check(retryError(apiCallError(status)))).toBe(true);
  });

  it('does not map other status codes', () => {
    const error = apiCallError(500);
    expect(isAuthenticationError(error)).toBe(false);
    expect(isForbiddenError(error)).toBe(false);
    expect(isBadRequestError(error)).toBe(false);
  });

  it('treats a missing API key as an authentication error', () => {
    expect(isAuthenticationError(new LoadAPIKeyError({ message: 'OpenAI API key is missing.' }))).toBe(true);
  });

  it('detects an unsupported response_format in the response body', () => {
    const error = apiCallError(
      422,
      '{"error":{"message":"response_format of type json_schema is not supported with this model"}}',
    );
    expect(isBadRequestError(error)).toBe(true);
  });

  it('recognizes abort errors', () => {
    const controller = new AbortController();
    controller.abort();
    expect(isAbortedError(controller.signal.reason)).toBe(true);
  });
});
