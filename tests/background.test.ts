import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

// Formerly-Pro features (unlimited history, multiple environments, collections)
// must work for everyone now, with no payment/tier state involved at all.
describe('background message handlers — free for everyone', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  async function loadBackground() {
    const background = await import('../entrypoints/background');
    background.default.main();
  }

  async function send(message: any) {
    const [result] = await fakeBrowser.runtime.onMessage.trigger(message, {} as any, () => {});
    return result;
  }

  it('addHistory keeps more than the old free-tier cap of 50 entries', async () => {
    await loadBackground();

    for (let i = 0; i < 60; i++) {
      await send({ action: 'addHistory', entry: { id: `h${i}`, timestamp: i } });
    }

    const history = await send({ action: 'getHistory' });
    expect(history.length).toBe(60);
  });

  it('addHistory respects the user-configured maxHistory setting, not a hard-coded limit', async () => {
    await loadBackground();
    await fakeBrowser.storage.local.set({ maxHistory: 5 });

    for (let i = 0; i < 8; i++) {
      await send({ action: 'addHistory', entry: { id: `h${i}`, timestamp: i } });
    }

    const history = await send({ action: 'getHistory' });
    expect(history.length).toBe(5);
  });

  it('saveEnvironments accepts more than the old free-tier cap of 1 environment', async () => {
    await loadBackground();

    const environments = Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}`,
      name: `env-${i}`,
      variables: [],
    }));

    const result = await send({ action: 'saveEnvironments', environments });
    expect((result as any)?.error).toBeUndefined();

    const stored = await send({ action: 'getEnvironments' });
    expect(stored).toHaveLength(5);
  });

  it('saveCollections succeeds without any payment/pro state in storage', async () => {
    await loadBackground();

    const collections = [{ id: 'c1', name: 'My Collection', requests: [] }];
    const result = await send({ action: 'saveCollections', collections });
    expect((result as any)?.error).toBeUndefined();

    const stored = await send({ action: 'getCollections' });
    expect(stored).toEqual(collections);
  });

  it('getSettings never returns a proUnlocked/payment flag', async () => {
    await loadBackground();

    const settings = await send({ action: 'getSettings' });
    expect(settings).not.toHaveProperty('proUnlocked');
  });
});
