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

const { clearMembersCache, isCatPageExcluded } = await import('../src/cache.js');
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

describe('isCatPageExcluded', () => {
	it('allows members mode on topical template categories', () => {
		expect(isCatPageExcluded('Kateqoriya:Riyazi_formatlama_şablonları')).toBe(false);
		expect(isCatPageExcluded('Kateqoriya:Kimya şablonları')).toBe(false);
	});

	it('keeps tracking and project template categories excluded', () => {
		expect(isCatPageExcluded('Kateqoriya:Şablonlar:TemplateStyles istifadə edən şablonlar')).toBe(
			true
		);
		expect(isCatPageExcluded('Kateqoriya:Vikipediya şablonları')).toBe(true);
		// Only the capital-Ş form appears here, so keyword matching alone misses it.
		expect(isCatPageExcluded('Kateqoriya:Şablonlar:TemplateStyles istifadə edən')).toBe(true);
	});

	it('still excludes categories matching other keywords', () => {
		expect(isCatPageExcluded('Kateqoriya:Yaşayan insanlar')).toBe(true);
	});
});
