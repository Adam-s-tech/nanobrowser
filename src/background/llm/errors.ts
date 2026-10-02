import { APICallError, LoadAPIKeyError, RetryError } from 'ai';

/**
 * Return the last underlying error of a `RetryError`, or the error itself.
 */
export function unwrapError(error: unknown): unknown {
  if (RetryError.isInstance(error) && error.lastError !== undefined) {
    return error.lastError;
  }
  return error;
}

/**
 * HTTP status code of a failed provider API call, if the error came from one.
 */
export function getApiCallStatusCode(error: unknown): number | undefined {
  const unwrapped = unwrapError(error);
  return APICallError.isInstance(unwrapped) ? unwrapped.statusCode : undefined;
}

/**
 * Response body of a failed provider API call, if the error came from one.
 */
export function getApiCallResponseBody(error: unknown): string | undefined {
  const unwrapped = unwrapError(error);
  return APICallError.isInstance(unwrapped) ? unwrapped.responseBody : undefined;
}

/**
 * Status code, error data and response body of a failed provider API call, for logging.
 * OpenRouter reports upstream failures in a 200 response, so only `data` holds the upstream provider and its error.
 */
export function getApiCallErrorDetails(
  error: unknown,
): { statusCode?: number; data?: unknown; responseBody?: string } | undefined {
  const unwrapped = unwrapError(error);
  if (!APICallError.isInstance(unwrapped)) {
    return undefined;
  }
  return { statusCode: unwrapped.statusCode, data: unwrapped.data, responseBody: unwrapped.responseBody };
}

export function isMissingApiKeyError(error: unknown): boolean {
  return LoadAPIKeyError.isInstance(unwrapError(error));
}
