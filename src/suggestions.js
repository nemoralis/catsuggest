const {
	CATEGORY_PREFIX,
	CURRENT_WIKI,
	CACHE_KEY_FOREIGN_PREFIX,
	CACHE_KEY_MEMBERS_FOREIGN_PREFIX,
	CACHE_TTL_FOREIGN,
	EXCLUDED_TITLE_KEYWORDS,
	EXCLUDED_KEYWORD_ALLOW_PATTERNS,
	EXCLUDED_TITLES,
	REMOVAL_EXCLUDED_KEYWORDS,
	isSameCategoryIgnoringPlural,
	MEMBER_SUGGESTION_NAMESPACES,
	TEMPLATE_NAMESPACE,
	TEMPLATE_CATEGORY_KEYWORD,
	isNonTopicalTemplateCategory,
	ANCESTOR_CHECK_DEPTH,
	FETCH_CONCURRENCY,
	MAX_ANCESTOR_NODES_PER_LEVEL,
	log,
} = require('./constants.js');
const { fetchFullQuery, getApiBatchSize } = require('./api.js');
const { fetchPageContent, extractCategoryTitles } = require('./edit.js');
/**
 * Deduplicate redirect-provenance pairs ({lang, name}) into a stable array.
 * Multiple sites can resolve the same target, and one target can be reached
 * via several redirects within a single site.
 *
 * @param {Array<{lang: string, name: string}>} [pairs]
 * @return {Array<{lang: string, name: string}>}
 */
function collectRedirectNames(pairs) {
	const result = [];
	const seen = new Set();
	(pairs || []).forEach(({ lang, name }) => {
		const key = lang + '\u0000' + name;
		if (!seen.has(key)) {
			seen.add(key);
			result.push({ lang, name });
		}
	});
	return result;
}
/**
 * @param {Set|Array} container
 * @return {boolean} True when the container has at least one entry
 */
function hasEntries(container) {
	return container instanceof Set ? container.size > 0 : container.length > 0;
}

/**
 * Whether a category title is excluded from suggestions and removals:
 * it contains an excluded keyword (drafts, maintenance, derived categories
 * like birth-year or membership categories) unless allowlisted by pattern.
 *
 * In template contexts (template pages and topical template categories), the
 * generic "şablonlar" keyword is skipped for topical template categories (e.g.
 * "Kateqoriya:Riyazi formatlama şablonları"), since those are useful there.
 * Structural and tracking template categories remain excluded.
 *
 * @param {string} title
 * @param {{allowTemplateCategories?: boolean}} [options]
 * @return {boolean}
 */
function isExcludedTitle(title, { allowTemplateCategories = false } = {}) {
	const isNonTopical = allowTemplateCategories && isNonTopicalTemplateCategory(title);
	const hasExcludedKeyword = EXCLUDED_TITLE_KEYWORDS.some((kw) => {
		if (!title.includes(kw)) {
			return false;
		}
		// The generic keyword is too broad in template contexts: topical
		// categories like "... şablonları" are useful there. Structural and
		// tracking categories are still caught by isNonTopical above.
		return !(allowTemplateCategories && kw === TEMPLATE_CATEGORY_KEYWORD);
	});
	return (
		(isNonTopical || hasExcludedKeyword) &&
		!EXCLUDED_KEYWORD_ALLOW_PATTERNS.some((pattern) => pattern.test(title))
	);
}

/**
 * Parent category titles for an API page, excluding a self-parent edge.
 * MediaWiki permits a category to list itself; keeping that edge would make
 * every graph traversal treat the category as its own ancestor.
 *
 * @param {Object} page - API page object with title and optional categories
 * @return {string[]}
 */
function getParentTitles(page) {
	return (page.categories || []).map((c) => c.title).filter((title) => title !== page.title);
}

/**
 * Walk up the local category graph level by level.
 *
 * Traversal state is tracked separately from `parentMap`: a title that is
 * already in the map (for example a prefetched suggestion) must still have its
 * own parents examined. Checking `parentMap.has()` instead would silently stop
 * the walk at that node and let an ancestor slip through as a suggestion.
 *
 * @param {string[]} startTitles - Categories whose ancestors should be collected
 * @param {Map<string, string[]>} parentMap - Parent lists, possibly prefilled
 * @param {Object} [options]
 * @param {Function} [options.fetchParents] - Async callback receiving the titles
 *     of a level that still needs fetching
 * @param {number} [options.maxDepth] - Maximum number of hops to walk
 * @param {number} [options.maxNodesPerLevel] - Safety cap for dense graphs
 * @param {Function} [options.logger] - Diagnostic logger
 * @return {Promise<{ancestors: Set<string>, traversed: Set<string>, depth: number, truncated: boolean}>}
 */
async function walkAncestors(startTitles, parentMap, options = {}) {
	const maxDepth = options.maxDepth === undefined ? ANCESTOR_CHECK_DEPTH : options.maxDepth;
	const maxNodesPerLevel =
		options.maxNodesPerLevel === undefined
			? MAX_ANCESTOR_NODES_PER_LEVEL
			: options.maxNodesPerLevel;
	const fetchParents = options.fetchParents || (async () => {});
	const logger = options.logger || log;

	const ancestors = new Set();
	const traversed = new Set();
	let currentLevel = [...new Set(startTitles)];
	let depth = 0;
	let truncated = false;

	for (let level = 0; level < maxDepth && currentLevel.length > 0; level++) {
		logger('Ancestor walk depth', level, '| checking', currentLevel.length, 'nodes');
		let truncatedThisLevel = false;

		const toFetch = currentLevel.filter((title) => !traversed.has(title));
		if (toFetch.length > 0) {
			await fetchParents(toFetch);
		}

		const nextLevel = [];
		const nextLevelSeen = new Set();
		for (const title of currentLevel) {
			traversed.add(title);
			const parents = parentMap.get(title) || [];
			for (const parent of parents) {
				if (parent === title) {
					continue;
				}
				ancestors.add(parent);
				if (traversed.has(parent) || nextLevelSeen.has(parent)) {
					continue;
				}
				if (nextLevel.length < maxNodesPerLevel) {
					nextLevelSeen.add(parent);
					nextLevel.push(parent);
				} else {
					truncated = true;
					truncatedThisLevel = true;
				}
			}
		}

		if (truncatedThisLevel) {
			logger('Ancestor walk truncated at depth', level, '| limit', maxNodesPerLevel);
		}

		if (nextLevel.length === 0) {
			break;
		}
		currentLevel = nextLevel;
		depth = level + 1;
	}

	return { ancestors, traversed, depth, truncated };
}

/**
 * Whether a resolved suggestion is the category page currently being edited.
 *
 * @param {string} title - Resolved suggestion title
 * @param {string} currentCategoryTitle - Current category title, or empty for non-category pages
 * @return {boolean}
 */
function isCurrentCategoryTitle(title, currentCategoryTitle) {
	if (!currentCategoryTitle) {
		return false;
	}
	return title.replace(/_/g, ' ') === currentCategoryTitle.replace(/_/g, ' ');
}

/**
 * Fetch parent categories for unique titles in API-sized batches, running a limited
 * number of batches concurrently. Duplicate titles are removed before batching so a
 * shared parent is never requested once per child.
 *
 * @param {Object} api - API object with get(), and optionally post()
 * @param {string[]} titles
 * @param {boolean} [includeEditability] - Also test whether the current user can edit each page
 * @return {Promise<Object[]>} Query results, one per batch
 */
async function fetchCategoriesForTitles(api, titles, includeEditability = false) {
	const uniqueTitles = [...new Set(titles)];
	if (uniqueTitles.length === 0) {
		return [];
	}

	const batchSize = await getApiBatchSize(api);
	const maxTitlesPerWave = batchSize * FETCH_CONCURRENCY;
	const results = [];

	for (let i = 0; i < uniqueTitles.length; i += maxTitlesPerWave) {
		const waveEnd = Math.min(i + maxTitlesPerWave, uniqueTitles.length);
		const batchPromises = [];
		for (let j = i; j < waveEnd; j += batchSize) {
			const batch = uniqueTitles.slice(j, Math.min(j + batchSize, waveEnd));
			const params = {
				action: 'query',
				titles: batch.join('|'),
				prop: includeEditability ? 'categories|info' : 'categories',
				cllimit: 'max',
			};
			if (includeEditability) {
				params.intestactions = 'edit';
				params.intestactionsdetail = 'quick';
			}
			batchPromises.push(fetchFullQuery(api, params));
		}
		results.push(...(await Promise.all(batchPromises)));
	}

	return results;
}

/**
 * Follow azwiki-side redirect chains reported by the API (`query.redirects`,
 * `from → to`, from the `redirects: true` title lookups) to find the canonical
 * title for a candidate that arrived via a foreign langlink.
 *
 * @param {string} title - Candidate title (possibly a redirect)
 * @param {Map<string, string>} redirectMap - Redirect resolution map (from → to)
 * @return {string} Resolved title (or `title` when not a redirect)
 */
function resolveRedirectTitle(title, redirectMap) {
	const visited = new Set();
	let current = title;
	while (redirectMap.has(current) && !visited.has(current)) {
		visited.add(current);
		current = redirectMap.get(current);
	}
	return current;
}
/**
 * Fetch parent categories of a page from a foreign wiki via langlinks.
 * Results are cached in mw.storage and added to globalCatToSites map.
 * Titles reached by following a redirect (targets in the API's `query.redirects`)
 * are additionally recorded in redirectResolvedCatToSites so the UI can flag them,
 * and the foreign title(s) that produced each suggestion in foreignNamesByTitle so
 * the UI can explain the provenance (e.g. in a chip tooltip).
 *
 * @param {Object} foreignApi
 * @param {Object} siteData
 * @param {string} lang
 * @param {Map} globalCatToSites
 * @param {string} qid
 * @param {Map} [redirectResolvedCatToSites] - Titles reached via foreign-wiki redirect resolution (lang→set)
 * @param {Map} [foreignNamesByTitle] - Foreign title(s) per azwiki title (array of {lang, name})
 * @return {Promise|undefined}
 */
function fetchParentCatsSuggestions(
	foreignApi,
	siteData,
	lang,
	globalCatToSites,
	qid,
	redirectResolvedCatToSites = new Map(),
	foreignNamesByTitle = new Map()
) {
	const cacheKey = CACHE_KEY_FOREIGN_PREFIX + qid + '-' + siteData.site;
	const cached = mw.storage.get(cacheKey);
	if (cached) {
		try {
			const cachedItems = JSON.parse(cached);
			if (Array.isArray(cachedItems)) {
				log('[parentCats]', siteData.site, '→ cache hit:', cachedItems);
				cachedItems.forEach((entry) => {
					const catTitle = typeof entry === 'string' ? entry : entry.t;
					if (!globalCatToSites.has(catTitle)) {
						globalCatToSites.set(catTitle, new Set());
					}
					globalCatToSites.get(catTitle).add(lang);
					if (entry && entry.r) {
						if (!redirectResolvedCatToSites.has(catTitle)) {
							redirectResolvedCatToSites.set(catTitle, new Set());
						}
						redirectResolvedCatToSites.get(catTitle).add(lang);
					}
					if (entry && Array.isArray(entry.n)) {
						if (!foreignNamesByTitle.has(catTitle)) {
							foreignNamesByTitle.set(catTitle, []);
						}
						entry.n.forEach((name) => {
							foreignNamesByTitle.get(catTitle).push({ lang, name });
						});
					}
				});
				return;
			}
			mw.storage.remove(cacheKey);
		} catch (_err) {
			mw.log.warn('Foreign cache error:', _err);
			mw.storage.remove(cacheKey);
		}
	}

	log('[parentCats]', siteData.site, '→ fetching from API...');
	return fetchFullQuery(foreignApi, {
		action: 'query',
		generator: 'categories',
		titles: siteData.title,
		gcllimit: 'max',
		gclshow: '!hidden',
		prop: 'langlinks',
		lllang: CURRENT_WIKI.replace('wiki', ''),
		lllimit: 'max',
	}).then((catResp) => {
		const pages = catResp.pages || {};
		// A page whose title is a redirect-resolution target only appeared because
		// the API followed a redirect (e.g. a song redirect resolving to the article
		// it lives inside). Translating it via langlinks would use the unrelated
		// target's az title, so flag it for the suggestion list.
		const resolvedTargets = new Set((catResp.redirects || []).map((r) => r.to));
		const resolvedTargetToNames = new Map();
		(catResp.redirects || []).forEach((r) => {
			if (!resolvedTargetToNames.has(r.to)) {
				resolvedTargetToNames.set(r.to, []);
			}
			resolvedTargetToNames.get(r.to).push(r.from);
		});
		const azwikiCatsForCache = [];
		Object.values(pages).forEach((p) => {
			if (p.langlinks && p.langlinks.length > 0) {
				const azwikiTitle = p.langlinks[0]['*'];
				const isRedirectResolved = resolvedTargets.has(p.title);
				const foreignNames = isRedirectResolved
					? resolvedTargetToNames.get(p.title) || []
					: [p.title];
				azwikiCatsForCache.push({
					t: azwikiTitle,
					r: isRedirectResolved,
					n: foreignNames,
				});
				if (!globalCatToSites.has(azwikiTitle)) {
					globalCatToSites.set(azwikiTitle, new Set());
				}
				globalCatToSites.get(azwikiTitle).add(lang);
				if (isRedirectResolved) {
					if (!redirectResolvedCatToSites.has(azwikiTitle)) {
						redirectResolvedCatToSites.set(azwikiTitle, new Set());
					}
					redirectResolvedCatToSites.get(azwikiTitle).add(lang);
				}
				if (!foreignNamesByTitle.has(azwikiTitle)) {
					foreignNamesByTitle.set(azwikiTitle, []);
				}
				foreignNames.forEach((name) => {
					foreignNamesByTitle.get(azwikiTitle).push({ lang, name });
				});
			}
		});
		if (azwikiCatsForCache.length > 0) {
			log('[parentCats]', siteData.site, '→ API result:', azwikiCatsForCache);
			mw.storage.set(cacheKey, JSON.stringify(azwikiCatsForCache), CACHE_TTL_FOREIGN);
		}
	});
}

/**
 * Fetch category members (pages + subcats) of a page from a foreign wiki via langlinks.
 * Results are cached in mw.storage and added to globalCatToSites map.
 * Titles reached by following a redirect (targets in the API's `query.redirects`)
 * are additionally recorded in redirectResolvedCatToSites so the UI can flag them,
 * and the foreign title(s) that produced each suggestion in foreignNamesByTitle so
 * the UI can explain the provenance (e.g. in a chip tooltip).
 *
 * @param {Object} foreignApi
 * @param {Object} siteData
 * @param {string} lang
 * @param {Map} globalCatToSites
 * @param {string} qid
 * @param {Map} [redirectResolvedCatToSites]
 * @param {Map} [foreignNamesByTitle] - Foreign title(s) per azwiki title (array of {lang, name})
 * @return {Promise|undefined}
 */
function fetchMembersSuggestions(
	foreignApi,
	siteData,
	lang,
	globalCatToSites,
	qid,
	redirectResolvedCatToSites = new Map(),
	foreignNamesByTitle = new Map()
) {
	const cacheKey = CACHE_KEY_MEMBERS_FOREIGN_PREFIX + qid + '-' + siteData.site;
	const cached = mw.storage.get(cacheKey);
	if (cached) {
		try {
			const cachedItems = JSON.parse(cached);
			if (Array.isArray(cachedItems)) {
				log('[members]', siteData.site, '→ cache hit:', cachedItems);
				cachedItems.forEach((entry) => {
					const catTitle = typeof entry === 'string' ? entry : entry.t;
					if (!globalCatToSites.has(catTitle)) {
						globalCatToSites.set(catTitle, new Set());
					}
					globalCatToSites.get(catTitle).add(lang);
					if (entry && entry.r) {
						if (!redirectResolvedCatToSites.has(catTitle)) {
							redirectResolvedCatToSites.set(catTitle, new Set());
						}
						redirectResolvedCatToSites.get(catTitle).add(lang);
					}
					if (entry && Array.isArray(entry.n)) {
						if (!foreignNamesByTitle.has(catTitle)) {
							foreignNamesByTitle.set(catTitle, []);
						}
						entry.n.forEach((name) => {
							foreignNamesByTitle.get(catTitle).push({ lang, name });
						});
					}
				});
				return;
			}
			mw.storage.remove(cacheKey);
		} catch (_err) {
			mw.log.warn('Members foreign cache error:', _err);
			mw.storage.remove(cacheKey);
		}
	}

	log('[members]', siteData.site, '→ fetching from API...');
	// See fetchParentCatsSuggestions: flag members reached via redirect resolution
	// so the UI can indicate their provenance instead of silently using the
	// unrelated target's langlink.
	return fetchFullQuery(foreignApi, {
		action: 'query',
		generator: 'categorymembers',
		gcmtitle: siteData.title,
		gcmlimit: 'max',
		gcmtype: 'page|subcat',
		prop: 'langlinks',
		lllang: CURRENT_WIKI.replace('wiki', ''),
		lllimit: 'max',
	}).then((memberResp) => {
		const pages = memberResp.pages || {};
		const resolvedTargets = new Set((memberResp.redirects || []).map((r) => r.to));
		const resolvedTargetToNames = new Map();
		(memberResp.redirects || []).forEach((r) => {
			if (!resolvedTargetToNames.has(r.to)) {
				resolvedTargetToNames.set(r.to, []);
			}
			resolvedTargetToNames.get(r.to).push(r.from);
		});
		const azwikiCatsForCache = [];
		Object.values(pages).forEach((p) => {
			if (p.langlinks && p.langlinks.length > 0) {
				const azwikiTitle = p.langlinks[0]['*'];
				const isRedirectResolved = resolvedTargets.has(p.title);
				const foreignNames = isRedirectResolved
					? resolvedTargetToNames.get(p.title) || []
					: [p.title];
				azwikiCatsForCache.push({
					t: azwikiTitle,
					r: isRedirectResolved,
					n: foreignNames,
				});
				if (!globalCatToSites.has(azwikiTitle)) {
					globalCatToSites.set(azwikiTitle, new Set());
				}
				globalCatToSites.get(azwikiTitle).add(lang);
				if (isRedirectResolved) {
					if (!redirectResolvedCatToSites.has(azwikiTitle)) {
						redirectResolvedCatToSites.set(azwikiTitle, new Set());
					}
					redirectResolvedCatToSites.get(azwikiTitle).add(lang);
				}
				if (!foreignNamesByTitle.has(azwikiTitle)) {
					foreignNamesByTitle.set(azwikiTitle, []);
				}
				foreignNames.forEach((name) => {
					foreignNamesByTitle.get(azwikiTitle).push({ lang, name });
				});
			}
		});
		if (azwikiCatsForCache.length > 0) {
			mw.storage.set(cacheKey, JSON.stringify(azwikiCatsForCache), CACHE_TTL_FOREIGN);
		}
	});
}

/**
 * @param {Array<{title: string, sources: string[]}>} rawResults - Candidate suggestions from foreign wikis
 * @param {string[]} currentCats - Categories already on the page
 * @param {{ get: Function }} api - MediaWiki API object
 * @param {string} currentPageTitle - Title of the current page (no prefix)
 * @param {Set<string>} templateAddedCats - Categories added via templates (excluded from removals)
 * @param {Map} [redirectResolvedCatToSites] - Titles reached via foreign-wiki redirect resolution
 * @param {Map} [foreignNamesByTitle] - Foreign title(s) per azwiki title (array of {lang, name})
 * @param {string} [currentCategoryTitle] - Current category title when editing a category page
 * @param {{allowTemplateCategories?: boolean}} [options] - Page context options
 * @return {Promise<{suggestions: Array, parentMap: Map}>}
 */
async function buildParentCatsSuggestions(
	rawResults,
	currentCats,
	api,
	currentPageTitle,
	templateAddedCats = new Set(),
	redirectResolvedCatToSites = new Map(),
	foreignNamesByTitle = new Map(),
	currentCategoryTitle = '',
	options = {}
) {
	const allowTemplateCategories = options.allowTemplateCategories === true;
	const currentCatsSet = new Set(currentCats);
	const suggestionTitles = rawResults.map((r) => r.title);

	const parentMap = new Map();

	const azwikiRedirectMap = new Map();

	const fetchParentsForTitles = async (titles) => {
		const toFetch = [...new Set(titles)].filter((t) => !parentMap.has(t));
		if (toFetch.length === 0) {
			return;
		}

		const queryResults = await fetchCategoriesForTitles(api, toFetch);
		queryResults.forEach((res) => {
			(res.redirects || []).forEach((r) => {
				azwikiRedirectMap.set(r.from, r.to);
			});
			const pages = res.pages || {};
			Object.values(pages).forEach((p) => {
				parentMap.set(p.title, getParentTitles(p));
			});
		});

		toFetch.forEach((t) => {
			if (!parentMap.has(t)) {
				parentMap.set(t, []);
			}
		});
	};

	log(
		'buildParentCatsSuggestions | raw candidates:',
		rawResults.map((r) => r.title),
		'| current cats:',
		currentCats
	);

	await fetchParentsForTitles(suggestionTitles);

	const { ancestors: allAncestors } = await walkAncestors(currentCats, parentMap, {
		fetchParents: fetchParentsForTitles,
	});

	log('Ancestors of current cats:', Array.from(allAncestors));

	// Returns true if `currentPageTitle` is an ancestor of `title` — meaning
	// the suggestion is a subcategory (descendant) of the current page.
	// Adding a child as a parent would create a cycle.
	const isDescendantOfCurrentPage = (title) => {
		if (!currentPageTitle) {
			return false;
		}
		const normalizedCurrent = currentPageTitle.replace(/_/g, ' ');
		// Mark nodes as visited when they are queued, not when they are dequeued.
		// Otherwise a node shared by many branches can be queued thousands of times.
		const visited = new Set([title]);
		const queue = [title];
		let qi = 0;
		while (qi < queue.length) {
			const node = queue[qi];
			qi++;
			const parents = parentMap.get(node) || [];
			for (const p of parents) {
				if (p === normalizedCurrent || p.replace(/_/g, ' ') === normalizedCurrent) {
					return true;
				}
				if (!visited.has(p)) {
					visited.add(p);
					queue.push(p);
				}
			}
		}
		return false;
	};

	const seenTitles = new Set();
	let suggestions = [];
	rawResults.forEach((r) => {
		const resolvedTitle = resolveRedirectTitle(r.title, azwikiRedirectMap);
		if (EXCLUDED_TITLES.has(resolvedTitle)) {
			return;
		}
		if (!r.isWikidataDerived && isExcludedTitle(resolvedTitle, { allowTemplateCategories })) {
			return;
		}
		if (isCurrentCategoryTitle(resolvedTitle, currentCategoryTitle)) {
			log('Filtered out current category:', resolvedTitle);
			return;
		}
		const alreadyOnPage = currentCatsSet.has(resolvedTitle);
		const isAncestor = allAncestors.has(resolvedTitle);
		const isDescendant = isDescendantOfCurrentPage(resolvedTitle);
		if (alreadyOnPage || isAncestor || isDescendant || seenTitles.has(resolvedTitle)) {
			log(
				'Filtered out:',
				resolvedTitle,
				'| raw:',
				r.title,
				'| alreadyOnPage:',
				alreadyOnPage,
				'| isAncestor:',
				isAncestor,
				'| isDescendant:',
				isDescendant
			);
			return;
		}
		seenTitles.add(resolvedTitle);
		const azLang = CURRENT_WIKI.replace('wiki', '');
		const isAzwikiRedirect = resolvedTitle !== r.title;
		const baseSites = redirectResolvedCatToSites.get(r.title) || [];
		const foreignNames = foreignNamesByTitle.get(r.title) || [];
		suggestions.push({
			title: resolvedTitle,
			selected: !(isAzwikiRedirect || hasEntries(baseSites)),
			sources: r.sources,
			isWikidataDerived: r.isWikidataDerived === true,
			sortKey: '',
			azRedirectFrom: isAzwikiRedirect ? r.title : undefined,
			redirectSites: isAzwikiRedirect
				? Array.from(new Set([...baseSites, azLang]))
				: Array.from(baseSites),
			foreignNames: isAzwikiRedirect
				? collectRedirectNames([...foreignNames, { lang: azLang, name: r.title }])
				: collectRedirectNames(foreignNames),
			removals: [],
		});
	});

	// Filter out suggestions that are a (direct) parent of another suggestion
	const suggestionSet = new Set(suggestions.map((s) => s.title));
	const parentOfAnother = new Set();
	suggestions.forEach((s) => {
		const parents = parentMap.get(s.title) || [];
		parents.forEach((p) => {
			if (suggestionSet.has(p)) {
				parentOfAnother.add(p);
			}
		});
	});
	const filtered = suggestions.filter((s) => !parentOfAnother.has(s.title));
	log('Removed due to parent in suggestions:', Array.from(parentOfAnother));
	suggestions = filtered;

	log(
		'Final suggestions:',
		suggestions.map((s) => s.title)
	);

	const isRemovalExcluded = (title) => REMOVAL_EXCLUDED_KEYWORDS.some((kw) => title.includes(kw));

	const pageCategoryName = CATEGORY_PREFIX + currentPageTitle;
	suggestions.forEach((s) => {
		const parents = parentMap.get(s.title) || [];
		parents.forEach((p) => {
			if (
				currentCatsSet.has(p) &&
				!templateAddedCats.has(p) &&
				!isSameCategoryIgnoringPlural(p, pageCategoryName) &&
				!isRemovalExcluded(p) &&
				!isExcludedTitle(p, { allowTemplateCategories })
			) {
				s.removals.push({ title: p, selected: false });
			}
		});
	});
	log(
		'Removals:',
		suggestions
			.filter((s) => s.removals.length > 0)
			.map((s) => `${s.title} → ${s.removals.map((r) => r.title).join(', ')}`)
	);

	return { suggestions, parentMap };
}

/**
 * Detect categories on the page that are redundant because they have
 * descendant categories (direct or transitive) also on the page.
 * Only the highest-level redundant categories are returned.
 *
 * @param {string[]} currentCats - Categories on the page
 * @param {{ get: Function }} api - MediaWiki API object
 * @param {Set<string>} templateAddedCats - Categories added via templates (excluded)
 * @param {Map<string, string[]>} [sharedParentMap] - Pre-fetched parent map to reuse
 * @param {string} currentPageTitle - Current page title (no prefix)
 * @param {{allowTemplateCategories?: boolean}} [options] - Page context options
 * @return {Promise<Array<{title: string, selected: boolean, reasons: string[]}>>}
 */
async function buildExistingRemovals(
	currentCats,
	api,
	templateAddedCats = new Set(),
	sharedParentMap = null,
	currentPageTitle = '',
	options = {}
) {
	const allowTemplateCategories = options.allowTemplateCategories === true;
	const parentMap = sharedParentMap || new Map();

	// Draft, maintenance and other excluded categories (e.g. "Kateqoriya:Psixologiya
	// qaralamaları") must never be removed themselves nor justify removing another
	// category, so they are excluded from the redundancy analysis entirely.
	const uniqueCats = [...new Set(currentCats)];
	const analysisCats = uniqueCats.filter(
		(title) => !isExcludedTitle(title, { allowTemplateCategories })
	);
	const currentCatsSet = new Set(analysisCats);
	const toFetch = uniqueCats.filter((t) => !parentMap.has(t));
	const queryResults = await fetchCategoriesForTitles(api, toFetch);
	queryResults.forEach((res) => {
		const pages = res.pages || {};
		Object.values(pages).forEach((p) => {
			parentMap.set(p.title, getParentTitles(p));
		});
	});
	toFetch.forEach((t) => {
		if (!parentMap.has(t)) parentMap.set(t, []);
	});

	// Walk up the ancestor chain (up to ANCESTOR_CHECK_DEPTH) for each category to find
	// all on-page ancestors. This detects transitive parent-child relationships even when
	// intermediate categories are not on the page (e.g., grandparent without parent on page).
	//
	// Wiki category graphs are not always trees: cycles like
	// "Fəlsəfə → Abstraksiya → Anlayışlar → Bilik → Təfəkkür → Fəlsəfə" make two categories
	// mutual ancestors. A chain that loops through such a cycle is semantically unreliable,
	// so it is not used to justify a removal.
	//
	// Each per-category BFS result is stored once and reused: `ancestorSets` answers
	// "is X an ancestor of Y?" in O(1), and `onPageAncestors` records the BFS depth of
	// every on-page ancestor so removal trees can be built without re-walking the graph.
	const descendantMap = new Map();
	analysisCats.forEach((cat) => descendantMap.set(cat, new Set()));

	const ancestorSets = new Map();
	const onPageAncestors = new Map();
	const foundChains = new Map();

	analysisCats.forEach((cat) => {
		const visited = new Set([cat]);
		const pred = new Map();
		// Exclude the root category itself: a self-parent edge would create
		// pred[cat] = cat and make chain reconstruction loop forever.
		const directParents = [...new Set(parentMap.get(cat) || [])].filter((p) => p !== cat);
		const queue = directParents;
		directParents.forEach((p) => pred.set(p, cat));
		const depths = queue.map(() => 0);
		const onPage = new Map();
		const chains = [];
		let qi = 0;
		while (qi < queue.length) {
			const node = queue[qi];
			const nodeDepth = depths[qi];
			qi++;
			if (visited.has(node)) {
				continue;
			}
			visited.add(node);
			if (currentCatsSet.has(node) && node !== cat) {
				const chain = [node];
				const seen = new Set(chain);
				let cur = node;
				let predCycle = false;
				while (pred.has(cur)) {
					cur = pred.get(cur);
					if (seen.has(cur)) {
						predCycle = true;
						break;
					}
					seen.add(cur);
					chain.unshift(cur);
				}
				onPage.set(node, nodeDepth);
				if (predCycle) {
					log('Ignoring cyclic ancestor chain:', cat, '→', node);
				} else {
					chains.push({ node, chain });
				}
			}
			if (nodeDepth < ANCESTOR_CHECK_DEPTH) {
				const parents = parentMap.get(node) || [];
				parents.forEach((p) => {
					if (!visited.has(p) && !pred.has(p)) {
						pred.set(p, node);
						queue.push(p);
						depths.push(nodeDepth + 1);
					}
				});
			}
		}
		ancestorSets.set(cat, visited);
		onPageAncestors.set(cat, onPage);
		foundChains.set(cat, chains);
	});

	// A chain element (intermediate or the walk root itself) that is an ancestor of
	// the found node means the chain loops through a cycle in the category graph —
	// the two categories are mutual ancestors, so the relationship is unreliable.
	// Reject the whole chain (including the root: `slice(0, -1)`).
	analysisCats.forEach((cat) => {
		foundChains.get(cat).forEach(({ node, chain }) => {
			const cyclic = chain.slice(0, -1).some((p) => ancestorSets.get(node).has(p));
			if (!cyclic) {
				descendantMap.get(node).add(cat);
			}
		});
	});

	// Walk up from a node to find the closest on-page category (or the candidate
	// itself) that is part of the candidate's own subtree — handles missing
	// intermediate categories. Stopping at an on-page category outside the
	// candidate's descendant set would leave that node disconnected from the tree
	// (which is rooted at the candidate). Uses the BFS depths recorded during the
	// ancestor walk, so no additional graph traversal is required.
	const findTreeParent = (node, candidate, descendantSet) => {
		if (!onPageAncestors.has(node)) {
			return null;
		}
		let best = null;
		let bestDepth = Infinity;
		onPageAncestors.get(node).forEach((depth, title) => {
			if (title === candidate || descendantSet.has(title)) {
				// Two on-page categories can be mutual ancestors (a cycle). Attaching
				// one under the other would make the tree cyclic (A under B and B under
				// A), so skip any title whose own ancestor set contains `node`.
				if (ancestorSets.get(title).has(node)) {
					return;
				}
				if (depth < bestDepth) {
					bestDepth = depth;
					best = title;
				}
			}
		});
		return best;
	};

	// Build a tree using path-finding through parentMap.
	const buildDescendantTree = (ancestorTitle, descendantSet) => {
		const treeMap = new Map();
		treeMap.set(ancestorTitle, []);
		descendantSet.forEach((d) => {
			const parentInTree = findTreeParent(d, ancestorTitle, descendantSet);
			if (parentInTree && !treeMap.has(parentInTree)) {
				treeMap.set(parentInTree, []);
			}
			if (parentInTree) {
				treeMap.get(parentInTree).push(d);
			}
		});
		const toTree = (title) => ({
			title,
			children: (treeMap.get(title) || []).sort().map(toTree),
		});
		return toTree(ancestorTitle).children;
	};

	const isRemovalExcluded = (title) => REMOVAL_EXCLUDED_KEYWORDS.some((kw) => title.includes(kw));

	const candidateMap = new Map();
	const pageCategoryName = currentPageTitle ? CATEGORY_PREFIX + currentPageTitle : '';
	analysisCats.forEach((cat) => {
		if (templateAddedCats.has(cat)) {
			return;
		}
		if (pageCategoryName && isSameCategoryIgnoringPlural(cat, pageCategoryName)) {
			return;
		}
		if (isRemovalExcluded(cat)) {
			return;
		}
		const descendants = descendantMap.get(cat);
		if (descendants && descendants.size > 0) {
			candidateMap.set(cat, {
				title: cat,
				selected: false,
				tree: buildDescendantTree(cat, descendants),
			});
		}
	});

	// Build the valid removal set in a single pass: sort candidates by descendant
	// count ascending (leaves first) and iterate once. This replaces the O(N²)
	// convergence loop — a candidate qualifies if at least one of its transitive
	// descendants will survive on the page (i.e., is not itself in the removal set).
	const removalMap = new Map();
	const sortedCandidates = Array.from(candidateMap.entries()).sort(
		(a, b) =>
			(descendantMap.get(a[0]) || { size: 0 }).size -
			(descendantMap.get(b[0]) || { size: 0 }).size
	);
	for (const [title, entry] of sortedCandidates) {
		const descendants = descendantMap.get(title);
		const hasSurvivingDescendant = descendants
			? [...descendants].some((d) => !removalMap.has(d))
			: false;
		if (hasSurvivingDescendant) {
			removalMap.set(title, entry);
		}
	}

	log(
		'Existing removals:',
		Array.from(removalMap.values()).map(
			(r) => `${r.title} ← ${r.tree.map((t) => t.title).join(', ')}`
		)
	);

	return Array.from(removalMap.values());
}

/**
 * @param {Array<{title: string, sources: string[]}>} rawResults - Candidate suggestions from foreign wikis
 * @param {{ members: Set<string>, subcats: Set<string> }} localData - Current page members/subcats
 * @param {{ get: Function }} api - MediaWiki API object
 * @param {Set<string>} currentPageCats - Categories the current page belongs to (to filter out parents)
 * @param {Map} [redirectResolvedCatToSites] - Titles reached via foreign-wiki redirect resolution
 * @param {Map} [foreignNamesByTitle] - Foreign title(s) per azwiki title (array of {lang, name})
 * @param {string} [currentCategoryTitle] - Current category title when editing a category page
 * @param {{isTemplateCategoryPage?: boolean}} [options] - Page context options
 * @return {Promise<Array<{title: string, selected: boolean, sources: string[], redirectSites: string[], foreignNames: Array, isCategory: boolean}>>}
 */
async function buildMembersSuggestions(
	rawResults,
	localData,
	api,
	currentPageCats = new Set(),
	redirectResolvedCatToSites = new Map(),
	foreignNamesByTitle = new Map(),
	currentCategoryTitle = '',
	options = {}
) {
	const isTemplateCategoryPage = options.isTemplateCategoryPage === true;
	const { members: currentMembersSet, subcats: currentSubcatsSet } = localData;
	const suggestionTitles = rawResults.map((r) => r.title);
	const allPagesCats = new Map();
	const editableByTitle = new Map();

	const catFetchResults = await fetchCategoriesForTitles(api, suggestionTitles, true);
	const azwikiRedirectMap = new Map();
	catFetchResults.forEach((res) => {
		(res.redirects || []).forEach((r) => {
			azwikiRedirectMap.set(r.from, r.to);
		});
		const pages = res.pages || {};
		Object.values(pages).forEach((p) => {
			if (p.categories) {
				allPagesCats.set(
					p.title,
					p.categories.map((c) => c.title)
				);
			}
			if (p.actions && Array.isArray(p.actions.edit)) {
				editableByTitle.set(p.title, p.actions.edit.length === 0);
			}
		});
	});

	// Template members are written to /doc when it exists, so the editability of
	// that page decides whether the suggestion can actually be applied.
	const docStatesByTemplate = new Map();
	if (isTemplateCategoryPage) {
		const templateTitles = rawResults
			.filter((r) => new mw.Title(r.title).getNamespaceId() === TEMPLATE_NAMESPACE)
			.map((r) => r.title);
		if (templateTitles.length > 0) {
			const docResults = await fetchCategoriesForTitles(
				api,
				templateTitles.map((title) => title + '/doc'),
				true
			);
			docResults.forEach((res) => {
				const redirects = new Map((res.redirects || []).map((r) => [r.from, r.to]));
				Object.values(res.pages || {}).forEach((p) => {
					const templateTitle = templateTitles.find((title) => {
						let docTitle = title + '/doc';
						const visited = new Set();
						while (redirects.has(docTitle) && !visited.has(docTitle)) {
							visited.add(docTitle);
							docTitle = redirects.get(docTitle);
						}
						return docTitle === p.title;
					});
					if (!templateTitle) {
						return;
					}
					docStatesByTemplate.set(templateTitle, {
						exists: p.missing === undefined,
						editable: Array.isArray(p.actions && p.actions.edit)
							? p.actions.edit.length === 0
							: false,
					});
				});
			});
		}
	}

	const seenTitles = new Set();
	const suggestions = [];
	rawResults.forEach((item) => {
		const resolvedTitle = resolveRedirectTitle(item.title, azwikiRedirectMap);
		if (EXCLUDED_TITLES.has(resolvedTitle)) {
			return;
		}
		const ns = new mw.Title(item.title).getNamespaceId();
		if (
			!MEMBER_SUGGESTION_NAMESPACES.includes(ns) &&
			!(isTemplateCategoryPage && ns === TEMPLATE_NAMESPACE)
		) {
			return;
		}
		if (isExcludedTitle(resolvedTitle)) {
			return;
		}
		if (isCurrentCategoryTitle(resolvedTitle, currentCategoryTitle)) {
			log('Filtered out current category:', resolvedTitle);
			return;
		}
		if (currentMembersSet.has(resolvedTitle) || seenTitles.has(resolvedTitle)) {
			return;
		}
		if (currentPageCats.has(resolvedTitle)) {
			log('Filtered out parent of current page:', item.title);
			return;
		}
		let canEdit = editableByTitle.get(resolvedTitle);
		if (ns === TEMPLATE_NAMESPACE && isTemplateCategoryPage) {
			const docState = docStatesByTemplate.get(item.title);
			if (docState && docState.exists) {
				canEdit = docState.editable;
			}
		}
		if (canEdit === false) {
			log('Filtered out uneditable page:', resolvedTitle);
			return;
		}
		seenTitles.add(resolvedTitle);
		const itemCats = allPagesCats.get(resolvedTitle) || [];
		if (itemCats.some((c) => currentSubcatsSet.has(c))) {
			return;
		}
		const azLang = CURRENT_WIKI.replace('wiki', '');
		const isAzwikiRedirect = resolvedTitle !== item.title;
		const baseSites = redirectResolvedCatToSites.get(item.title) || [];
		const foreignNames = foreignNamesByTitle.get(item.title) || [];
		suggestions.push({
			title: resolvedTitle,
			selected: !(isAzwikiRedirect || hasEntries(baseSites)),
			sources: item.sources,
			azRedirectFrom: isAzwikiRedirect ? item.title : undefined,
			redirectSites: isAzwikiRedirect
				? Array.from(new Set([...baseSites, azLang]))
				: Array.from(baseSites),
			foreignNames: isAzwikiRedirect
				? collectRedirectNames([...foreignNames, { lang: azLang, name: item.title }])
				: collectRedirectNames(foreignNames),
			isCategory: resolvedTitle.startsWith(CATEGORY_PREFIX),
		});
	});

	return suggestions;
}

/**
 * Compare wikitext [[Category:...]] links against API-reported categories
 * to determine which ones were added by templates (present in API but not in raw wikitext).
 *
 * @param {{ get: Function }} api - MediaWiki API object
 * @param {string} pageTitle - Current page title
 * @param {string[]} currentCats - Categories reported by the API/wgCategories
 * @return {Promise<Set<string>>}
 */
async function detectTemplateAddedCategories(api, pageTitle, currentCats) {
	let content;
	try {
		content = await fetchPageContent(api, pageTitle);
	} catch (e) {
		return new Set();
	}

	const directCats = extractCategoryTitles(content);

	// Template-added = currentCats (from API/wgCategories) minus directCats (from wikitext)
	const templateAdded = new Set();
	for (const c of currentCats) {
		if (!directCats.has(c)) {
			templateAdded.add(c);
		}
	}

	log('Template-added categories:', Array.from(templateAdded));

	return templateAdded;
}

module.exports = {
	fetchParentCatsSuggestions,
	fetchMembersSuggestions,
	walkAncestors,
	buildParentCatsSuggestions,
	buildExistingRemovals,
	buildMembersSuggestions,
	detectTemplateAddedCategories,
};
