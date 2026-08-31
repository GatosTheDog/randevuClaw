import { isTransientConnectionError, withConnectionRetry } from '../src/database/db';

describe('isTransientConnectionError', () => {
  it('returns true for a direct "Connection terminated" message', () => {
    expect(isTransientConnectionError(new Error('Connection terminated unexpectedly'))).toBe(true);
  });

  it('returns true for the exact production message shape', () => {
    expect(
      isTransientConnectionError(
        new Error('Connection terminated due to connection timeout: Connection terminated unexpectedly')
      )
    ).toBe(true);
  });

  it('returns true when the substring is only present on a chained cause', () => {
    const err = new Error('outer wrapper');
    // lib target predates the ES2022 Error(message, { cause }) constructor
    // overload; assign .cause directly (Node itself supports it at runtime).
    (err as Error & { cause?: unknown }).cause = new Error('Connection terminated unexpectedly');
    expect(isTransientConnectionError(err)).toBe(true);
  });

  it('returns false for an unrelated error', () => {
    expect(isTransientConnectionError(new Error('validation failed: missing field'))).toBe(false);
  });

  it('returns false for a plain non-Error thrown value', () => {
    expect(isTransientConnectionError('some string error')).toBe(false);
    expect(isTransientConnectionError({})).toBe(false);
  });

  it('returns false for undefined/null input', () => {
    expect(isTransientConnectionError(undefined)).toBe(false);
    expect(isTransientConnectionError(null)).toBe(false);
  });
});

describe('withConnectionRetry', () => {
  it('rejects after maxRetries when fn always rejects with a transient error, calling fn exactly 3 times', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('Connection terminated unexpectedly'));

    await expect(withConnectionRetry(fn, 2, [0, 0])).rejects.toThrow('Connection terminated unexpectedly');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('resolves after a single transient failure followed by success, calling fn exactly 2 times', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('Connection terminated unexpectedly'))
      .mockResolvedValueOnce('recovered-value');

    await expect(withConnectionRetry(fn, 2, [0, 0])).resolves.toBe('recovered-value');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rejects immediately with a non-transient error, never retrying (fn called exactly 1 time)', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('business rule violated'));

    await expect(withConnectionRetry(fn, 2, [0, 0])).rejects.toThrow('business rule violated');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resolves on the first call with zero delay/retry overhead when fn always resolves', async () => {
    const fn = jest.fn().mockResolvedValue('ok');

    await expect(withConnectionRetry(fn, 2, [0, 0])).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rejects after exactly 1 call when maxRetries is 0 (no retries at all)', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('Connection terminated unexpectedly'));

    await expect(withConnectionRetry(fn, 0, [0, 0])).rejects.toThrow('Connection terminated unexpectedly');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
