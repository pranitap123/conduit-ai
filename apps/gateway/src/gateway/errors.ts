/** Client-facing error shape. Deliberately never echoes upstream error bodies,
 *  which can contain the provider account's own identifiers. */
export interface ApiError {
  error: { type: string; message: string; requestId: string };
}

export function apiError(type: string, message: string, requestId: string): ApiError {
  return { error: { type, message, requestId } };
}
