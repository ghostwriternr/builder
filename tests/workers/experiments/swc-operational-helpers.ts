export interface TimedResult<T> {
  durationMs: number;
  result: T;
}

export async function timed<T>(operation: () => T | Promise<T>): Promise<TimedResult<T>> {
  const started = performance.now();
  const result = await operation();
  return { durationMs: Math.round(performance.now() - started), result };
}
