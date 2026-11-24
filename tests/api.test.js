import { beforeEach, describe, it, expect, vi } from 'vitest';

const { fetchFullQuery, getApiBatchSize, resetApiBatchSizeCache, settleAll, retryApiCall } = await import(
	'../src/api.js'
);

describe('settleAll', () => {
	it('reports fulfilled and rejected outcomes without rejecting', async () => {
		const error = new Error('site down');
		const results = await settleAll([
			Promise.resolve('ok'),
			Promise.reject(error),
		]);

		expect(results[0]).toEqual({ status: 'fulfilled', value: 'ok' });
		expect(results[1]).toEqual({ status: 'rejected', reason: error });
	});
});

describe('retryApiCall', () => {
	function jqueryReject(code, result) {
		return {
			fail() {},
			then(_onFulfilled, onRejected) {
				return Promise.resolve().then(() => onRejected(code, result));
			},
		};
	}

	it('keeps the API result from a MediaWiki promise rejection', async () => {
		const api = {
			get: vi.fn().mockReturnValueOnce(
				jqueryReject('ratelimited', {
					error: { info: 'Too many requests' },
					xhr: { status: 429, statusText: 'Too Many Requests' },
				})
			),
		};

		await expect(retryApiCall(() => api.get({}), 1)).rejects.toMatchObject({
			code: 'ratelimited',
			result: { error: { info: 'Too many requests' } },
			isApiError: true,
		});
	});

	it('waits for the Retry-After header before retrying', async () => {
		vi.useFakeTimers();
		try {
			const response = { query: { ok: true } };
			const api = {
				get: vi
					.fn()
					.mockReturnValueOnce(
						jqueryReject('ratelimited', {
							xhr: { getResponseHeader: () => '30' },
						})
					)
					.mockResolvedValueOnce(response),
			};
			const call = retryApiCall(() => api.get({}), 2);

			await vi.advanceTimersByTimeAsync(29999);
			expect(api.get).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1);
			await expect(call).resolves.toEqual(response);
			expect(api.get).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('fetchFullQuery', () => {
	it('merges langlinks returned in continuation batches', async () => {
		const api = {
			get: vi
				.fn()
				.mockResolvedValueOnce({
					continue: { llcontinue: '20|az', continue: '||' },
					query: {
						pages: {
							1: {
								pageid: 1,
								title: 'Category:2002 births',
								langlinks: [
									{ lang: 'az', '*': 'Kateqoriya:2002-ci ildə doğulanlar' },
								],
							},
							2: { pageid: 2, title: 'Category:2026 FIFA World Cup players' },
						},
					},
				})
				.mockResolvedValueOnce({
					query: {
						pages: {
							2: {
								pageid: 2,
								title: 'Category:2026 FIFA World Cup players',
								langlinks: [
									{
										lang: 'az',
										'*': 'Kateqoriya:2026 FİFA Dünya Kuboku oyunçuları',
									},
								],
							},
						},
					},
				}),
		};

		const result = await fetchFullQuery(api, {
			action: 'query',
			generator: 'categories',
			prop: 'langlinks',
			lllang: 'az',
		});

		expect(api.get).toHaveBeenCalledTimes(2);
		expect(result.pages['2'].langlinks).toEqual([
			{ lang: 'az', '*': 'Kateqoriya:2026 FİFA Dünya Kuboku oyunçuları' },
		]);
		expect(result.pages['1'].langlinks).toEqual([
			{ lang: 'az', '*': 'Kateqoriya:2002-ci ildə doğulanlar' },
		]);
	});

	it('does not duplicate langlinks when a page reappears in a continuation batch', async () => {
		const api = {
			get: vi
				.fn()
				.mockResolvedValueOnce({
					continue: { llcontinue: '2|en', continue: '||' },
					query: {
						pages: {
							1: {
								pageid: 1,
								title: 'Category:Example',
								langlinks: [{ lang: 'en', '*': 'Category:Example' }],
							},
						},
					},
				})
				.mockResolvedValueOnce({
					query: {
						pages: {
							1: {
								pageid: 1,
								title: 'Category:Example',
								langlinks: [{ lang: 'en', '*': 'Category:Example' }],
							},
						},
					},
				}),
		};

		const result = await fetchFullQuery(api, {
			action: 'query',
			generator: 'categories',
			prop: 'langlinks',
		});

		expect(result.pages['1'].langlinks).toEqual([{ lang: 'en', '*': 'Category:Example' }]);
	});

	it('keeps appending categories that span multiple batches', async () => {
		const api = {
			get: vi
				.fn()
				.mockResolvedValueOnce({
					continue: { clcontinue: '1|Category:B', continue: '||' },
					query: {
						pages: {
							1: {
								pageid: 1,
								title: 'Page',
								categories: [{ title: 'Category:A' }],
							},
						},
					},
				})
				.mockResolvedValueOnce({
					query: {
						pages: {
							1: {
								pageid: 1,
								title: 'Page',
								categories: [{ title: 'Category:B' }],
							},
						},
					},
				}),
		};

		const result = await fetchFullQuery(api, {
			action: 'query',
			prop: 'categories',
		});

		expect(result.pages['1'].categories.map((c) => c.title)).toEqual([
			'Category:A',
			'Category:B',
		]);
	});

	it('uses a read-only POST for oversized queries when post is available', async () => {
		const api = {
			get: vi.fn(),
			post: vi.fn().mockResolvedValue({
				query: {
					pages: {
						1: { pageid: 1, title: 'Page' },
					},
				},
			}),
		};

		const result = await fetchFullQuery(api, {
			action: 'query',
			titles: 'x'.repeat(8000),
			prop: 'categories',
		});

		expect(api.get).not.toHaveBeenCalled();
		expect(api.post).toHaveBeenCalledTimes(1);
		const [params, ajaxOptions] = api.post.mock.calls[0];
		expect(params.titles).toHaveLength(8000);
		expect(ajaxOptions.headers['Promise-Non-Write-API-Action']).toBe('true');
		expect(result.pages['1'].title).toBe('Page');
	});

	it('keeps using GET for small queries when post is available', async () => {
		const api = {
			get: vi.fn().mockResolvedValue({
				query: {
					pages: {
						1: { pageid: 1, title: 'Page' },
					},
				},
			}),
			post: vi.fn(),
		};

		await fetchFullQuery(api, {
			action: 'query',
			titles: 'Kateqoriya:A',
			prop: 'categories',
		});

		expect(api.get).toHaveBeenCalledTimes(1);
		expect(api.post).not.toHaveBeenCalled();
	});
});

describe('getApiBatchSize', () => {
	beforeEach(() => {
		resetApiBatchSizeCache();
	});

	it('returns 500 when the user has the apihighlimits right and memoizes the result', async () => {
		const api = {
			get: vi.fn(async () => ({
				query: { userinfo: { rights: ['read', 'edit', 'apihighlimits'] } },
			})),
		};

		expect(await getApiBatchSize(api)).toBe(500);
		expect(await getApiBatchSize(api)).toBe(500);
		expect(api.get).toHaveBeenCalledTimes(1);
	});

	it('returns 50 when the user lacks the apihighlimits right', async () => {
		const api = {
			get: vi.fn(async () => ({
				query: { userinfo: { rights: ['read', 'edit'] } },
			})),
		};

		expect(await getApiBatchSize(api)).toBe(50);
	});

	it('returns 50 when the query does not expose userinfo rights', async () => {
		const api = {
			get: vi.fn(async () => ({ query: { pages: {} } })),
		};

		expect(await getApiBatchSize(api)).toBe(50);
	});

	it('falls back to 50 on an API error', async () => {
		const api = {
			get: vi.fn(async () => {
				throw new Error('ExampleError');
			}),
		};

		expect(await getApiBatchSize(api)).toBe(50);
	});

	it('re-detects after resetApiBatchSizeCache() clears the memo', async () => {
		const api = {
			get: vi.fn(async () => ({
				query: { userinfo: { rights: ['apihighlimits'] } },
			})),
		};

		await getApiBatchSize(api);
		await getApiBatchSize(api);
		expect(api.get).toHaveBeenCalledTimes(1);

		resetApiBatchSizeCache();
		await getApiBatchSize(api);
		expect(api.get).toHaveBeenCalledTimes(2);
	});
});
