const {
	BATCH_SIZE_API,
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
	ALLOWED_NAMESPACES,
	ANCESTOR_CHECK_DEPTH,
	log,
} = require('./constants.js');
const { fetchFullQuery } = require('./api.js');
const { fetchPageContent } = require('./edit.js');
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
 * Follow azwiki-side redirect chains reported by the API (`query.redirects`,
 * `from → to`, from the `redirects: true` title lookups) to find the canonical
 * title for a candidate that arrived via a foreign langlink.
 *
 * @param {string} title - Candidate title (possibly a redirect)
 * @param {Map<string, string>} redirectMap - Redirect resolution map (from → to)
 * @return {string} Resolved title (or `title` when not a redirect)
 */
function hasEntries(container) {
	return container instanceof Set ? container.size > 0 : container.length > 0;
}

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
 * and the redirect's original page name in redirectResolvedCatToNames so the UI
 * can explain the provenance (e.g. in a chip tooltip).
 *
 * @param {Object} foreignApi
 * @param {Object} siteData
 * @param {string} lang
 * @param {Map} globalCatToSites
 * @param {string} qid
 * @param {Map} [redirectResolvedCatToSites]
 * @param {Map} [redirectResolvedCatToNames] - Redirect name per title (array of {lang, name})
 * @return {Promise|undefined}
 */
function fetchParentCatsSuggestions(
	foreignApi,
	siteData,
	lang,
	globalCatToSites,
	qid,
	redirectResolvedCatToSites = new Map(),
	redirectResolvedCatToNames = new Map()
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
						if (!redirectResolvedCatToNames.has(catTitle)) {
							redirectResolvedCatToNames.set(catTitle, []);
						}
						entry.n.forEach((name) => {
							redirectResolvedCatToNames.get(catTitle).push({ lang, name });
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
				const redirectNames = isRedirectResolved
					? resolvedTargetToNames.get(p.title) || []
					: [];
				azwikiCatsForCache.push({
					t: azwikiTitle,
					r: isRedirectResolved,
					n: redirectNames,
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
					if (!redirectResolvedCatToNames.has(azwikiTitle)) {
						redirectResolvedCatToNames.set(azwikiTitle, []);
					}
					redirectNames.forEach((name) => {
						redirectResolvedCatToNames.get(azwikiTitle).push({ lang, name });
					});
				}
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
 * and the redirect's original page name in redirectResolvedCatToNames so the UI
 * can explain the provenance (e.g. in a chip tooltip).
 *
 * @param {Object} foreignApi
 * @param {Object} siteData
 * @param {string} lang
 * @param {Map} globalCatToSites
 * @param {string} qid
 * @param {Map} [redirectResolvedCatToSites]
 * @param {Map} [redirectResolvedCatToNames] - Redirect name per title (array of {lang, name})
 * @return {Promise|undefined}
 */
function fetchMembersSuggestions(
	foreignApi,
	siteData,
	lang,
	globalCatToSites,
	qid,
	redirectResolvedCatToSites = new Map(),
	redirectResolvedCatToNames = new Map()
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
						if (!redirectResolvedCatToNames.has(catTitle)) {
							redirectResolvedCatToNames.set(catTitle, []);
						}
						entry.n.forEach((name) => {
							redirectResolvedCatToNames.get(catTitle).push({ lang, name });
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
				const redirectNames = isRedirectResolved
					? resolvedTargetToNames.get(p.title) || []
					: [];
				azwikiCatsForCache.push({
					t: azwikiTitle,
					r: isRedirectResolved,
					n: redirectNames,
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
					if (!redirectResolvedCatToNames.has(azwikiTitle)) {
						redirectResolvedCatToNames.set(azwikiTitle, []);
					}
					redirectNames.forEach((name) => {
						redirectResolvedCatToNames.get(azwikiTitle).push({ lang, name });
					});
				}
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
 * @param {Map} [redirectResolvedCatToNames] - Redirect name per title (array of {lang, name})
 * @return {Promise<{suggestions: Array, parentMap: Map}>}
 */
async function buildParentCatsSuggestions(
	rawResults,
	currentCats,
	api,
	currentPageTitle,
	templateAddedCats = new Set(),
	redirectResolvedCatToSites = new Map(),
	redirectResolvedCatToNames = new Map()
) {
	const currentCatsSet = new Set(currentCats);
	const suggestionTitles = rawResults.map((r) => r.title);

	const parentMap = new Map();

	const azwikiRedirectMap = new Map();

	const fetchParentsForTitles = async (titles) => {
		const toFetch = titles.filter((t) => !parentMap.has(t));
		if (toFetch.length === 0) {
			return;
		}

		const batchPromises = [];
		for (let i = 0; i < toFetch.length; i += BATCH_SIZE_API) {
			const batch = toFetch.slice(i, i + BATCH_SIZE_API);
			batchPromises.push(
				fetchFullQuery(api, {
					action: 'query',
					titles: batch.join('|'),
					prop: 'categories',
					cllimit: 'max',
				})
			);
		}

		const queryResults = await Promise.all(batchPromises);
		queryResults.forEach((res) => {
			(res.redirects || []).forEach((r) => {
				azwikiRedirectMap.set(r.from, r.to);
			});
			const pages = res.pages || {};
			Object.values(pages).forEach((p) => {
				const cats = p.categories ? p.categories.map((c) => c.title) : [];
				parentMap.set(p.title, cats);
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

	let currentLevel = currentCats.slice();
	const allAncestors = new Set();

	for (let depth = 0; depth < ANCESTOR_CHECK_DEPTH; depth++) {
		log('Ancestor walk depth', depth, '| checking', currentLevel.length, 'nodes');
		await fetchParentsForTitles(currentLevel);

		const nextLevel = [];
		currentLevel.forEach((title) => {
			const parents = parentMap.get(title) || [];
			parents.forEach((p) => {
				allAncestors.add(p);
				if (!parentMap.has(p)) {
					nextLevel.push(p);
				}
			});
		});

		if (nextLevel.length === 0) {
			break;
		}
		currentLevel = nextLevel;
	}

	log('Ancestors of current cats:', Array.from(allAncestors));

	// Returns true if `currentPageTitle` is an ancestor of `title` — meaning
	// the suggestion is a subcategory (descendant) of the current page.
	// Adding a child as a parent would create a cycle.
	const isDescendantOfCurrentPage = (title) => {
		if (!currentPageTitle) {
			return false;
		}
		const normalizedCurrent = currentPageTitle.replace(/_/g, ' ');
		const visited = new Set();
		const queue = [title];
		let qi = 0;
		while (qi < queue.length) {
			const node = queue[qi];
			qi++;
			if (visited.has(node)) {
				continue;
			}
			visited.add(node);
			const parents = parentMap.get(node) || [];
			for (const p of parents) {
				if (p === normalizedCurrent || p.replace(/_/g, ' ') === normalizedCurrent) {
					return true;
				}
				if (!visited.has(p)) {
					queue.push(p);
				}
			}
		}
		return false;
	};

	const seenTitles = new Set();
	let suggestions = [];
	rawResults.forEach((r) => {
		if (EXCLUDED_TITLES.has(r.title)) {
			return;
		}
		if (
			EXCLUDED_TITLE_KEYWORDS.some((kw) => r.title.includes(kw)) &&
			!EXCLUDED_KEYWORD_ALLOW_PATTERNS.some((pattern) => pattern.test(r.title))
		) {
			return;
		}
		const resolvedTitle = resolveRedirectTitle(r.title, azwikiRedirectMap);
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
		const baseNames = redirectResolvedCatToNames.get(r.title) || [];
		suggestions.push({
			title: resolvedTitle,
			selected: !(isAzwikiRedirect || hasEntries(baseSites) || hasEntries(baseNames)),
			sources: r.sources,
			azRedirectFrom: isAzwikiRedirect ? r.title : undefined,
			redirectSites: isAzwikiRedirect
				? Array.from(new Set([...baseSites, azLang]))
				: Array.from(baseSites),
			redirectNames: isAzwikiRedirect
				? collectRedirectNames([...baseNames, { lang: azLang, name: r.title }])
				: collectRedirectNames(baseNames),
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
				!isRemovalExcluded(p)
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
 * @return {Promise<Array<{title: string, selected: boolean, reasons: string[]}>>}
 */
async function buildExistingRemovals(
	currentCats,
	api,
	templateAddedCats = new Set(),
	sharedParentMap = null,
	currentPageTitle = ''
) {
	const currentCatsSet = new Set(currentCats);
	const parentMap = sharedParentMap || new Map();

	const toFetch = currentCats.filter((t) => !parentMap.has(t));
	const batchPromises = [];
	for (let i = 0; i < toFetch.length; i += BATCH_SIZE_API) {
		const batch = toFetch.slice(i, i + BATCH_SIZE_API);
		batchPromises.push(
			fetchFullQuery(api, {
				action: 'query',
				titles: batch.join('|'),
				prop: 'categories',
				cllimit: 'max',
			})
		);
	}
	const queryResults = await Promise.all(batchPromises);
	queryResults.forEach((res) => {
		const pages = res.pages || {};
		Object.values(pages).forEach((p) => {
			const cats = p.categories ? p.categories.map((c) => c.title) : [];
			parentMap.set(p.title, cats);
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
	currentCats.forEach((cat) => descendantMap.set(cat, new Set()));

	const ancestorSets = new Map();
	const onPageAncestors = new Map();
	const foundChains = new Map();

	currentCats.forEach((cat) => {
		const visited = new Set([cat]);
		const pred = new Map();
		const queue = [...(parentMap.get(cat) || [])];
		queue.forEach((p) => pred.set(p, cat));
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
				let cur = node;
				while (pred.has(cur)) {
					cur = pred.get(cur);
					chain.unshift(cur);
				}
				chains.push({ node, chain });
				onPage.set(node, nodeDepth);
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
	currentCats.forEach((cat) => {
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
	currentCats.forEach((cat) => {
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
 * @param {Map} [redirectResolvedCatToNames] - Redirect name per title (array of {lang, name})
 * @return {Promise<Array<{title: string, selected: boolean, sources: string[], redirectSites: string[], redirectNames: Array, isCategory: boolean}>>}
 */
async function buildMembersSuggestions(
	rawResults,
	localData,
	api,
	currentPageCats = new Set(),
	redirectResolvedCatToSites = new Map(),
	redirectResolvedCatToNames = new Map()
) {
	const { members: currentMembersSet, subcats: currentSubcatsSet } = localData;
	const suggestionTitles = rawResults.map((r) => r.title);
	const allPagesCats = new Map();

	const catFetchPromises = [];
	for (let i = 0; i < suggestionTitles.length; i += BATCH_SIZE_API) {
		const batch = suggestionTitles.slice(i, i + BATCH_SIZE_API);
		catFetchPromises.push(
			fetchFullQuery(api, {
				action: 'query',
				titles: batch.join('|'),
				prop: 'categories',
				cllimit: 'max',
			})
		);
	}

	const catFetchResults = await Promise.all(catFetchPromises);
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
		});
	});

	const seenTitles = new Set();
	const suggestions = [];
	rawResults.forEach((item) => {
		if (EXCLUDED_TITLES.has(item.title)) {
			return;
		}
		const ns = new mw.Title(item.title).getNamespaceId();
		if (!ALLOWED_NAMESPACES.includes(ns)) {
			return;
		}
		if (
			EXCLUDED_TITLE_KEYWORDS.some((kw) => item.title.includes(kw)) &&
			!EXCLUDED_KEYWORD_ALLOW_PATTERNS.some((pattern) => pattern.test(item.title))
		) {
			return;
		}
		const resolvedTitle = resolveRedirectTitle(item.title, azwikiRedirectMap);
		if (currentMembersSet.has(resolvedTitle) || seenTitles.has(resolvedTitle)) {
			return;
		}
		if (currentPageCats.has(resolvedTitle)) {
			log('Filtered out parent of current page:', item.title);
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
		const baseNames = redirectResolvedCatToNames.get(item.title) || [];
		suggestions.push({
			title: resolvedTitle,
			selected: !(isAzwikiRedirect || hasEntries(baseSites) || hasEntries(baseNames)),
			sources: item.sources,
			azRedirectFrom: isAzwikiRedirect ? item.title : undefined,
			redirectSites: isAzwikiRedirect
				? Array.from(new Set([...baseSites, azLang]))
				: Array.from(baseSites),
			redirectNames: isAzwikiRedirect
				? collectRedirectNames([...baseNames, { lang: azLang, name: item.title }])
				: collectRedirectNames(baseNames),
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

	// Parse direct [[Category:...]] / [[Kateqoriya:...]] from wikitext
	const directCats = new Set();
	const catRe = /\[\[\s*(?:Kateqoriya|Category)\s*:\s*([^\]|]+?)\s*(?:\|[^\]]*?)?\]\]/gi;
	let match;
	while ((match = catRe.exec(content)) !== null) {
		directCats.add(CATEGORY_PREFIX + match[1].trim());
	}

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
	buildParentCatsSuggestions,
	buildExistingRemovals,
	buildMembersSuggestions,
	detectTemplateAddedCategories,
};
