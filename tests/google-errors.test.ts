import {
  describeGoogleError,
  isGoogleAuthRevokedError,
  isGoogleNotFoundError,
} from '../src/google/errors';

function gaxiosLikeError(overrides: Record<string, unknown> = {}): Error {
  const err = new Error('invalid_grant: Token has been expired or revoked.') as Error & Record<string, unknown>;
  err.config = {
    url: 'https://oauth2.googleapis.com/token',
    data: 'refresh_token=REFRESH_SECRET_X&client_secret=CLIENT_SECRET_X&code=AUTH_CODE_X',
    headers: { Authorization: 'Bearer ACCESS_SECRET_X' },
  };
  err.response = { status: 400, data: { error: 'invalid_grant', error_description: 'Bad Request' } };
  Object.assign(err, overrides);
  return err;
}

describe('describeGoogleError', () => {
  it('never leaks request secrets and exposes reason/status/message', () => {
    const result = describeGoogleError(gaxiosLikeError());
    const json = JSON.stringify(result);
    expect(json).not.toContain('REFRESH_SECRET_X');
    expect(json).not.toContain('CLIENT_SECRET_X');
    expect(json).not.toContain('AUTH_CODE_X');
    expect(json).not.toContain('ACCESS_SECRET_X');
    expect(result.reason).toBe('invalid_grant');
    expect(result.status).toBe(400);
    expect(result.message.length).toBeLessThanOrEqual(200);
  });

  it('truncates long messages to 200 characters', () => {
    const result = describeGoogleError(new Error('x'.repeat(500)));
    expect(result.message).toHaveLength(200);
  });

  it('handles non-Error values without throwing', () => {
    expect(typeof describeGoogleError('boom').message).toBe('string');
    expect(typeof describeGoogleError(undefined).message).toBe('string');
    expect(typeof describeGoogleError({ foo: 'bar' }).message).toBe('string');
    expect(typeof describeGoogleError(null).message).toBe('string');
  });
});

describe('isGoogleAuthRevokedError', () => {
  it('is true for response.data.error invalid_grant', () => {
    const err = Object.assign(new Error('nope'), { response: { status: 400, data: { error: 'invalid_grant' } } });
    expect(isGoogleAuthRevokedError(err)).toBe(true);
  });

  it('is true for a message containing invalid_grant', () => {
    expect(isGoogleAuthRevokedError(new Error('invalid_grant'))).toBe(true);
  });

  it('is false for a 500 error and for non-errors', () => {
    const err = Object.assign(new Error('server error'), { response: { status: 500, data: { error: 'backendError' } } });
    expect(isGoogleAuthRevokedError(err)).toBe(false);
    expect(isGoogleAuthRevokedError(undefined)).toBe(false);
    expect(isGoogleAuthRevokedError('text')).toBe(false);
  });
});

describe('isGoogleNotFoundError', () => {
  it('is true for numeric code 404 or 410', () => {
    expect(isGoogleNotFoundError(Object.assign(new Error('x'), { code: 404 }))).toBe(true);
    expect(isGoogleNotFoundError(Object.assign(new Error('x'), { code: 410 }))).toBe(true);
  });

  it('is true for response.status 404 or 410', () => {
    expect(isGoogleNotFoundError(Object.assign(new Error('x'), { response: { status: 404 } }))).toBe(true);
    expect(isGoogleNotFoundError(Object.assign(new Error('x'), { response: { status: 410 } }))).toBe(true);
  });

  it('is false for 403/500 and for non-errors', () => {
    expect(isGoogleNotFoundError(Object.assign(new Error('x'), { code: 403 }))).toBe(false);
    expect(isGoogleNotFoundError(Object.assign(new Error('x'), { response: { status: 500 } }))).toBe(false);
    expect(isGoogleNotFoundError(undefined)).toBe(false);
    expect(isGoogleNotFoundError('404')).toBe(false);
  });
});
