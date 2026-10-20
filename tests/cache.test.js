import { beforeEach, describe, expect, it, vi } from 'vitest';

const remove = vi.fn();

global.mw = {
	storage: {
		get: vi.fn(() => null),
		set: vi.fn(),
		remove,
	},
	log: {
		warn: vi.fn(),
		debug: vi.fn(),
	},
};

const { clearMembersCache } = await import('../src/cache.js');
const { CACHE_KEY_TREE_PREFIX } = await import('../src/constants.js');

describe('clearMembersCache', () => {
	beforeEach(() => {
		remove.mockClear();
	});

	it('removes the cached member tree for the page', () => {
		clearMembersCache(123);

		expect(remove).toHaveBeenCalledWith(CACHE_KEY_TREE_PREFIX + '123');
	});

	it('does nothing without a page id', () => {
		clearMembersCache(0);

		expect(remove).not.toHaveBeenCalled();
	});
});
