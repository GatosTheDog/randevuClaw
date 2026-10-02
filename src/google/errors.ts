// Safe description of Google API errors.
//
// googleapis/gaxios errors carry the full request (config.data holds the client
// secret, auth code and refresh token; headers hold bearer tokens) and are NOT
// covered by the pino redact list. Never log a raw Google error: log only the
// result of describeGoogleError.

const MAX_MESSAGE_LENGTH = 200;

export interface GoogleErrorDescription {
  message: string;
  code?: string | number;
  status?: number;
  reason?: string;
}

function truncate(value: string): string {
  return value.length > MAX_MESSAGE_LENGTH ? value.slice(0, MAX_MESSAGE_LENGTH) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function describeGoogleError(err: unknown): GoogleErrorDescription {
  if (!(err instanceof Error) && !isRecord(err)) {
    return { message: truncate(String(err)) };
  }

  const record = err as unknown as Record<string, unknown>;
  const description: GoogleErrorDescription = {
    message: truncate(err instanceof Error ? err.message : typeof record.message === 'string' ? record.message : '[non-error object]'),
  };

  if (typeof record.code === 'string' || typeof record.code === 'number') {
    description.code = record.code;
  }

  const response = record.response;
  if (isRecord(response)) {
    if (typeof response.status === 'number') description.status = response.status;
    const data = response.data;
    if (isRecord(data) && typeof data.error === 'string') {
      description.reason = truncate(data.error);
    }
  }

  return description;
}

export function isGoogleAuthRevokedError(err: unknown): boolean {
  if (!(err instanceof Error) && !isRecord(err)) return false;
  const described = describeGoogleError(err);
  return described.reason === 'invalid_grant' || described.message.includes('invalid_grant');
}

export function isGoogleNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error) && !isRecord(err)) return false;
  const described = describeGoogleError(err);
  const gone = (n: unknown) => n === 404 || n === 410;
  return gone(described.code) || gone(described.status);
}
