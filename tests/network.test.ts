import { describe, expect, it } from 'vitest';
import { beginTrace, endTrace, startNetworkObserver } from '../entrypoints/app/network';

// The manifest does not request webRequest, so the fake browser has none: the trace must say
// "not observed" (cookies undefined) rather than "no Set-Cookie was sent" (an empty list).
describe('network trace without webRequest', () => {
  it('reports Set-Cookie as unobservable, not as empty', async () => {
    expect(await startNetworkObserver()).toBe(false);
    const trace = await endTrace(beginTrace('GET', 'https://api.example.com/'));
    expect(trace.cookies).toBeUndefined();
    expect(trace.hops).toEqual([]);
    expect(trace.errorCode).toBeUndefined();
  });
});
