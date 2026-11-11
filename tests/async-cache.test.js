import { describe, it, expect, vi } from 'vitest';

const { createAsyncCache } = await import('../src/async-cache.js');

describe('createAsyncCache', () => {
	it('shares one in-flight promise between concurrent callers', async () => {
		const cache = createAsyncCache();
		const factory = vi.fn(() => Promise.resolve('value'));

		const first = cache.get('key', factory);
		const second = cache.get('key', factory);

		expect(factory).toHaveBeenCalledTimes(1);
		expect(first).toBe(second);
		await expect(first).resolves.toBe('value');
		expect(cache.has('key')).toBe(true);
	});

	it('does not cache a rejected promise', async () => {
		const cache = createAsyncCache();
		const factory = vi
			.fn()
			.mockRejectedValueOnce(new Error('temporary'))
			.mockResolvedValueOnce('recovered');

		await expect(cache.get('key', factory)).rejects.toThrow('temporary');
		expect(cache.has('key')).toBe(false);

		await expect(cache.get('key', factory)).resolves.toBe('recovered');
		expect(factory).toHaveBeenCalledTimes(2);
	});

	it('turns a synchronous factory throw into a retryable rejection', async () => {
		const cache = createAsyncCache();
		const factory = vi
			.fn()
			.mockImplementationOnce(() => {
				throw new Error('sync');
			})
			.mockResolvedValueOnce('ok');

		await expect(cache.get('key', factory)).rejects.toThrow('sync');
		expect(cache.has('key')).toBe(false);
		await expect(cache.get('key', factory)).resolves.toBe('ok');
	});

	it('invalidates a key and starts a fresh load', async () => {
		const cache = createAsyncCache();
		const factory = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new');

		await expect(cache.get('key', factory)).resolves.toBe('old');
		cache.invalidate('key');
		expect(cache.has('key')).toBe(false);
		await expect(cache.get('key', factory)).resolves.toBe('new');
		expect(factory).toHaveBeenCalledTimes(2);
	});

	it('does not delete a newer entry when an invalidated load rejects', async () => {
		const cache = createAsyncCache();
		let rejectOld;
		const oldPromise = cache.get(
			'key',
			() =>
				new Promise((_resolve, reject) => {
					rejectOld = reject;
				})
		);
		const oldExpectation = expect(oldPromise).rejects.toThrow('old failure');

		cache.invalidate('key');
		await expect(cache.get('key', () => Promise.resolve('new'))).resolves.toBe('new');

		rejectOld(new Error('old failure'));
		await oldExpectation;

		// The rejected old load must not evict the value cached by the newer load.
		await expect(cache.get('key', () => Promise.resolve('unused'))).resolves.toBe('new');
	});

	it('clears every cached promise', async () => {
		const cache = createAsyncCache();
		await cache.get('a', () => Promise.resolve(1));
		await cache.get('b', () => Promise.resolve(2));

		cache.clear();
		expect(cache.has('a')).toBe(false);
		expect(cache.has('b')).toBe(false);
	});
});
