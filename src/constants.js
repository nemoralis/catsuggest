const ALLOWED_NAMESPACES = [0, 4, 12, 14, 100];
const CATEGORY_NAMESPACE = 14;
const CURRENT_WIKI = 'azwiki';
const CATEGORY_PREFIX = 'Kateqoriya:';
const BATCH_SIZE_API = 50;
const FETCH_CONCURRENCY = 5;
const EDIT_DELAY_MS = 300;
const MAXLAG_SECONDS = 5;
const SLEEP_BETWEEN_BATCHES_MS = 300;
const DEBOUNCE_MS = 150;
const DEPTH2_BATCH_SIZE = 15;
const MAX_DEPTH2_SUBCATS = 100;
const MAX_DEPTH1_SUBCATS = 200;
const CONFIRM_BATCH_THRESHOLD = 5;
const ANCESTOR_CHECK_DEPTH = 4;
const DEBUG = true;
const DEV_MODE = true;
const CACHE_TTL_LANGUAGES = 31536000;
const CACHE_TTL_TREE = 3600;
const CACHE_TTL_FOREIGN = 60;
const CACHE_TTL_QID_AZWIKI = 3600;
const CACHE_TTL_PROCESSED_PAGES = 86400;
const CACHE_KEY_PROCESSED_PAGES = 'catsuggest-processed-pages';
const CACHE_KEY_SITE_METADATA = 'catsuggest-site-metadata';
const CACHE_KEY_TREE_PREFIX = 'catsuggest-tree-';
const CACHE_KEY_FOREIGN_PREFIX = 'catsuggest-cache-';
const CACHE_KEY_MEMBERS_FOREIGN_PREFIX = 'catsuggest-members-cache-';
const CACHE_KEY_QID_AZWIKI = 'catsuggest-qid-azwiki';
const CACHE_KEY_USER_LANGS = 'catsuggest-user-langs';
const MAX_PROCESSED_PAGES = 500;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 5000;
const USER_AGENT = 'Gadget-CatSuggest/2.0 (https://w.wiki/Qf9x)';
const EXCLUDED_SITES = new Set([
	'commonswiki',
	'metawiki',
	'specieswiki',
	'wikidatawiki',
	'incubatorwiki',
	'foundationwiki',
	'testwiki',
	'test2wiki',
	'sourceswiki',
]);

const EXCLUDED_TITLE_KEYWORDS = [
	'doğulanlar',
	'vəfat edənlər',
	'ölənlər',
	'dəfn olunanlar',
	'təltif olunanlar',
	'təltif edilənlər',
	'laureatları',
	'kavalerləri',
	'layiq görülmüşlər',
	'üzvləri',
	'məzunları',
	'qaralamalar',
	'Yaşayan insanlar',
	'Əlifba sırasına görə',
	'Vikipediya:',
	'Danışan məqalələr',
	'şablonlar',
	'səhifələr',
];
const EXCLUDED_KEYWORD_ALLOW_PATTERNS = [
	/Komitəsinin üzvləri/i,
	/Komissiyasının üzvləri/i,
	/Bürosunun üzvləri/i,
	/Şurasının üzvləri/i,
	/Heyətinin üzvləri/i,
	/Parlamentinin üzvləri/i,
	/müxbir üzvləri/i,
	/həqiqi üzvləri/i,
	/fəxri üzvləri/i,
	/nəticəsində ölənlər/i,
];
const EXCLUDED_TITLES = new Set([
	'Kateqoriya:Kişi',
	'Kateqoriya:Kişilər',
	'Kateqoriya:Qadın',
	'Kateqoriya:Qadınlar',
	'Kateqoriya:İnsanlar',
	'Kateqoriya:SSRİ',
	'Kateqoriya:Tarix',
	'Kateqoriya:Diplomatiya',
	'Kateqoriya:Dilçilər',
	'Kateqoriya:Qaralama halında olan məqalələr',
	'Kateqoriya:İstinad xətası olan səhifələr',
	'Kateqoriya:Abunəlik tələb edən məzmuna keçidi olan səhifələr',
]);
const LARGE_WIKI_SITES = new Set([
	'enwiki',
	'ruwiki',
	'eswiki',
	'frwiki',
	'dewiki',
	'itwiki',
	'ukwiki',
	'trwiki',
	'arwiki',
	'svwiki',
	'nlwiki',
	'plwiki',
	'jawiki',
	'zhwiki',
]);

const log = DEBUG ? (...args) => console.log('[CatSuggest]', ...args) : () => {}; // eslint-disable-line no-console

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

function generateBatchId() {
	return Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
}

module.exports = {
	ALLOWED_NAMESPACES,
	CATEGORY_NAMESPACE,
	CURRENT_WIKI,
	CATEGORY_PREFIX,
	BATCH_SIZE_API,
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
	DEBUG,
	DEV_MODE,
	CACHE_TTL_LANGUAGES,
	CACHE_TTL_TREE,
	CACHE_TTL_FOREIGN,
	CACHE_TTL_QID_AZWIKI,
	CACHE_TTL_PROCESSED_PAGES,
	CACHE_KEY_PROCESSED_PAGES,
	CACHE_KEY_SITE_METADATA,
	CACHE_KEY_TREE_PREFIX,
	CACHE_KEY_FOREIGN_PREFIX,
	CACHE_KEY_MEMBERS_FOREIGN_PREFIX,
	CACHE_KEY_QID_AZWIKI,
	CACHE_KEY_USER_LANGS,
	MAX_PROCESSED_PAGES,
	MAX_RETRIES,
	RETRY_BASE_DELAY_MS,
	USER_AGENT,
	EXCLUDED_SITES,
	EXCLUDED_TITLE_KEYWORDS,
	EXCLUDED_KEYWORD_ALLOW_PATTERNS,
	EXCLUDED_TITLES,
	LARGE_WIKI_SITES,
	log,
	escapeRegex,
	debounce,
	generateBatchId,
};
