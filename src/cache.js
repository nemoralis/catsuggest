const {
	CACHE_KEY_QID_AZWIKI,
	CACHE_TTL_QID_AZWIKI,
	CACHE_KEY_PROCESSED_PAGES,
	CACHE_TTL_PROCESSED_PAGES,
	MAX_PROCESSED_PAGES,
	CACHE_KEY_SITE_METADATA,
	CACHE_TTL_LANGUAGES,
	EXCLUDED_TITLE_KEYWORDS,
	EXCLUDED_KEYWORD_ALLOW_PATTERNS,
} = require('./constants.js');

const qidAzwikiCache = new Map();
let qidCacheLoaded = false;

function loadQidCache() {
	if (qidCacheLoaded) {
		return;
	}
	qidCacheLoaded = true;
	const raw = mw.storage.get(CACHE_KEY_QID_AZWIKI);
	if (!raw) {
		return;
	}
	try {
		const entries = JSON.parse(raw);
		if (Array.isArray(entries)) {
			entries.forEach(([qid, title]) => qidAzwikiCache.set(qid, title));
		}
	} catch (_err) {
		mw.log.warn('Save QID cache error:', _err);
		mw.storage.remove(CACHE_KEY_QID_AZWIKI);
	}
}

function saveQidCache() {
	const entries = Array.from(qidAzwikiCache.entries());
	mw.storage.set(CACHE_KEY_QID_AZWIKI, JSON.stringify(entries), CACHE_TTL_QID_AZWIKI);
}

function getQidCache() {
	return qidAzwikiCache;
}

function isPageProcessed(pageId) {
	if (!pageId) {
		return false;
	}
	const raw = mw.storage.get(CACHE_KEY_PROCESSED_PAGES);
	if (!raw) {
		return false;
	}
	try {
		const arr = JSON.parse(raw);
		return Array.isArray(arr) && arr.includes(pageId);
	} catch (_err) {
		mw.log.debug('Is page processed error:', _err);
		return false;
	}
}

function markPageAsProcessed(pageId) {
	if (!pageId) {
		return;
	}
	let arr = [];
	const raw = mw.storage.get(CACHE_KEY_PROCESSED_PAGES);
	if (raw) {
		try {
			arr = JSON.parse(raw);
			if (!Array.isArray(arr)) {
				arr = [];
			}
		} catch (_err) {
			mw.log.warn('Processed pages parse error:', _err);
			arr = [];
		}
	}
	if (!arr.includes(pageId)) {
		arr.push(pageId);
		if (arr.length > MAX_PROCESSED_PAGES) {
			arr = arr.slice(-MAX_PROCESSED_PAGES);
		}
		mw.storage.set(CACHE_KEY_PROCESSED_PAGES, JSON.stringify(arr), CACHE_TTL_PROCESSED_PAGES);
	}
}

async function loadSiteMetadata(api) {
	const cached = mw.storage.get(CACHE_KEY_SITE_METADATA);
	if (cached) {
		try {
			const parsed = JSON.parse(cached);
			if (parsed.langMap && parsed.interwikiMap) {
				return parsed;
			}
		} catch (_err) {
			mw.log.warn('Site metadata parse error:', _err);
			mw.storage.remove(CACHE_KEY_SITE_METADATA);
		}
	}

	const resp = await api.get({
		action: 'query',
		meta: 'siteinfo',
		siprop: 'languages|interwikimap',
		sifilteriw: 'local',
		format: 'json',
	});

	const langMap = {};
	if (resp.query && resp.query.languages) {
		resp.query.languages.forEach((l) => {
			langMap[l.code] = l['*'];
		});
	}

	const interwikiMap = {};
	if (resp.query && resp.query.interwikimap) {
		resp.query.interwikimap.forEach((iw) => {
			if (iw.url) {
				interwikiMap[iw.prefix] = iw.url;
			}
		});
	}

	const result = { langMap, interwikiMap };
	mw.storage.set(CACHE_KEY_SITE_METADATA, JSON.stringify(result), CACHE_TTL_LANGUAGES);
	return result;
}

function isCatPageExcluded(pageName) {
	return (
		EXCLUDED_TITLE_KEYWORDS.some((kw) => pageName.replace(/_/g, ' ').includes(kw)) &&
		!EXCLUDED_KEYWORD_ALLOW_PATTERNS.some((pattern) =>
			pattern.test(pageName.replace(/_/g, ' '))
		)
	);
}

module.exports = {
	qidAzwikiCache,
	loadQidCache,
	saveQidCache,
	getQidCache,
	isPageProcessed,
	markPageAsProcessed,
	loadSiteMetadata,
	isCatPageExcluded,
};
