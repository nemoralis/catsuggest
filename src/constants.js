const cfg = require('./catsuggest-config.json');

const ALLOWED_NAMESPACES = [0, 4, 10, 12, 14, 100];
// Templates can be edited by the gadget, but they are not offered as members
// of a category (that behavior is intentionally unchanged for now).
const MEMBER_SUGGESTION_NAMESPACES = [0, 4, 12, 14, 100];
const TEMPLATE_NAMESPACE = 10;
const CATEGORY_NAMESPACE = 14;
const CURRENT_WIKI = 'azwiki';
const CATEGORY_PREFIX = 'Kateqoriya:';
const BATCH_SIZE_API = 50;
const BATCH_SIZE_API_MAX = 500;
const FETCH_CONCURRENCY = 5;
const EDIT_DELAY_MS = 300;
const MAXLAG_SECONDS = 5;
const SLEEP_BETWEEN_BATCHES_MS = 300;
const DEBOUNCE_MS = 150;
const DEPTH2_BATCH_SIZE = 15;
const MAX_DEPTH2_SUBCATS = 50;
const MAX_DEPTH1_SUBCATS = 100;
const CONFIRM_BATCH_THRESHOLD = 5;
const ANCESTOR_CHECK_DEPTH = 4;
// Safety valve for dense/cyclic category graphs; normal pages stay well below this.
const MAX_ANCESTOR_NODES_PER_LEVEL = 1000;
/* global __CATSUGGEST_DEV__ */
// esbuild replaces the flag with a boolean in browser builds. The typeof guard
// keeps Node diagnostics scripts (which don't define it) working.
const DEBUG = typeof __CATSUGGEST_DEV__ === 'boolean' ? __CATSUGGEST_DEV__ : false;
const CACHE_TTL_LANGUAGES = 31536000;
const CACHE_TTL_TREE = 600;
const CACHE_TTL_FOREIGN = 60;
const CACHE_TTL_PROCESSED_PAGES = 86400;
const CACHE_KEY_PROCESSED_PAGES = 'catsuggest-processed-pages';
const CACHE_KEY_SITE_METADATA = 'catsuggest-site-metadata';
const CACHE_KEY_TREE_PREFIX = 'catsuggest-tree-';
const CACHE_KEY_FOREIGN_PREFIX = 'catsuggest-cache-2-';
const CACHE_KEY_MEMBERS_FOREIGN_PREFIX = 'catsuggest-members-cache-2-';
const CACHE_KEY_USER_LANGS_LEGACY = 'catsuggest-user-langs';
const CACHE_KEY_USER_LANGS_MEMBERS = 'catsuggest-user-langs-members';
const CACHE_KEY_USER_LANGS_PARENTCATS = 'catsuggest-user-langs-parentcats';
const MAX_PROCESSED_PAGES = 500;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 5000;
const USER_AGENT = 'Gadget-CatSuggest/2.0 (https://w.wiki/Qf9x)';

const EXCLUDED_SITES = new Set(cfg.excludedSites);
const EXCLUDED_TITLE_KEYWORDS = cfg.excludedTitleKeywords;
const EXCLUDED_KEYWORD_ALLOW_PATTERNS = cfg.excludedKeywordAllowPatterns.map(
	(p) => new RegExp(p, 'i')
);
const EXCLUDED_TITLES = new Set(cfg.excludedTitles);
const REMOVAL_EXCLUDED_KEYWORDS = cfg.removalExcludedKeywords || [];
const LARGE_WIKI_SITES = new Set(cfg.largeWikiSites);

const log = DEBUG ? (...args) => console.log('[catsuggest]', ...args) : () => {}; // eslint-disable-line no-console

function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function debounce(fn, delay) {
	let timer = null;
	return function () {
		const context = this;
		const args = arguments;
		if (timer) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			fn.apply(context, args);
		}, delay);
	};
}

const AZ_PLURAL_SUFFIXES = ['lar', 'lər'];
const TEMPLATE_CATEGORY_KEYWORD = 'şablonlar';

/**
 * Whether a category about templates is structural/maintenance rather than a
 * topical category that makes sense to add to a template page.
 *
 * @param {string} title
 * @return {boolean}
 */
function isNonTopicalTemplateCategory(title) {
	const normalized = title.replace(/_/g, ' ').trim();
	return (
		normalized === 'Kateqoriya:Şablonlar' ||
		normalized.startsWith('Kateqoriya:Şablonlar:') ||
		normalized.startsWith('Kateqoriya:Vikipediya') ||
		normalized.includes('istifadə edən')
	);
}

/**
 * Whether a category is a topical template category (e.g.
 * "Kateqoriya:Riyazi formatlama şablonları") rather than a project or tracking
 * category that merely mentions templates.
 *
 * @param {string} title
 * @return {boolean}
 */
function isTopicalTemplateCategory(title) {
	const normalized = title.replace(/_/g, ' ').trim();
	return (
		normalized.toLowerCase().includes(TEMPLATE_CATEGORY_KEYWORD) &&
		!isNonTopicalTemplateCategory(normalized)
	);
}

/**
 * Check whether two category titles are the same category, treating singular/plural
 * forms as equivalent (e.g. "Kateqoriya:Oyuncaq" vs "Kateqoriya:Oyuncaqlar").
 *
 * @param {string} a
 * @param {string} b
 * @return {boolean}
 */
function isSameCategoryIgnoringPlural(a, b) {
	if (a === b) {
		return true;
	}
	return AZ_PLURAL_SUFFIXES.some((suffix) => a === b + suffix || b === a + suffix);
}

/**
 * Return the cache key used to remember the user's selected languages for a mode.
 *
 * @param {string} mode 'members' or 'parentCats'
 * @return {string}
 */
function getUserLangsKey(mode) {
	return mode === 'members' ? CACHE_KEY_USER_LANGS_MEMBERS : CACHE_KEY_USER_LANGS_PARENTCATS;
}

module.exports = {
	ALLOWED_NAMESPACES,
	MEMBER_SUGGESTION_NAMESPACES,
	TEMPLATE_NAMESPACE,
	CATEGORY_NAMESPACE,
	CURRENT_WIKI,
	CATEGORY_PREFIX,
	BATCH_SIZE_API,
	BATCH_SIZE_API_MAX,
	FETCH_CONCURRENCY,
	EDIT_DELAY_MS,
	MAXLAG_SECONDS,
	SLEEP_BETWEEN_BATCHES_MS,
	DEBOUNCE_MS,
	DEPTH2_BATCH_SIZE,
	MAX_DEPTH2_SUBCATS,
	MAX_DEPTH1_SUBCATS,
	CONFIRM_BATCH_THRESHOLD,
	ANCESTOR_CHECK_DEPTH,
	MAX_ANCESTOR_NODES_PER_LEVEL,
	DEBUG,
	CACHE_TTL_LANGUAGES,
	CACHE_TTL_TREE,
	CACHE_TTL_FOREIGN,
	CACHE_TTL_PROCESSED_PAGES,
	CACHE_KEY_PROCESSED_PAGES,
	CACHE_KEY_SITE_METADATA,
	CACHE_KEY_TREE_PREFIX,
	CACHE_KEY_FOREIGN_PREFIX,
	CACHE_KEY_MEMBERS_FOREIGN_PREFIX,
	CACHE_KEY_USER_LANGS_LEGACY,
	CACHE_KEY_USER_LANGS_MEMBERS,
	CACHE_KEY_USER_LANGS_PARENTCATS,
	MAX_PROCESSED_PAGES,
	MAX_RETRIES,
	RETRY_BASE_DELAY_MS,
	USER_AGENT,
	EXCLUDED_SITES,
	EXCLUDED_TITLE_KEYWORDS,
	EXCLUDED_KEYWORD_ALLOW_PATTERNS,
	EXCLUDED_TITLES,
	REMOVAL_EXCLUDED_KEYWORDS,
	TEMPLATE_CATEGORY_KEYWORD,
	isNonTopicalTemplateCategory,
	isTopicalTemplateCategory,
	isSameCategoryIgnoringPlural,
	getUserLangsKey,
	LARGE_WIKI_SITES,
	log,
	escapeRegex,
	debounce,
};
