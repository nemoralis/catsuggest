/* eslint-env node */
/* eslint-disable no-console */

// Live read-only diagnostic for CatSuggest "members" mode (Məqalə və altkateqoriya təklifləri).
// Replicates the pipeline in src/App.vue's fetchSuggestions() + src/suggestions.js against
// real wikis, using the same src/ modules. No files are written and nothing is cached.
//
// Usage:
//   node bin/members.js "Kateqoriya:Azərbaycanın Milli Qəhrəmanları" [--langs en,ru,tr] [--qid Q...]

global.mw = {
	config: { get: () => null },
	storage: { get: () => null, set: () => {}, remove: () => {} },
	log: {
		warn: (...args) => console.warn('[catsuggest]', ...args),
		debug: () => {},
	},
	Title: class Title {
		constructor(title) {
			this.title = title;
		}
		getNamespaceId() {
			const prefix = this.title.split(':')[0].toLowerCase();
			const namespaces = {
				kateqoriya: 14,
				category: 14,
				şablon: 10,
				template: 10,
				vikipediya: 4,
				wikipedia: 4,
				kömək: 12,
				help: 12,
				portal: 100,
				fayl: 6,
				file: 6,
				istifadəçi: 2,
				user: 2,
				mediawiki: 8,
			};
			return namespaces[prefix] !== undefined ? namespaces[prefix] : 0;
		}
	},
};

const {
	ALLOWED_NAMESPACES,
	BATCH_SIZE_API,
	CATEGORY_PREFIX,
	EXCLUDED_SITES,
	EXCLUDED_TITLE_KEYWORDS,
	EXCLUDED_KEYWORD_ALLOW_PATTERNS,
	EXCLUDED_TITLES,
	FETCH_CONCURRENCY,
	LARGE_WIKI_SITES,
	MAX_DEPTH1_SUBCATS,
	MAX_DEPTH2_SUBCATS,
	DEPTH2_BATCH_SIZE,
	SLEEP_BETWEEN_BATCHES_MS,
	USER_AGENT,
} = require('../src/constants.js');
const { fetchFullQuery, sleep } = require('../src/api.js');
const { fetchMembersSuggestions, buildMembersSuggestions } = require('../src/suggestions.js');

const AZ_HOST = 'az.wikipedia.org';

function makeApi(host) {
	return {
		async get(params) {
			const url = 'https://' + host + '/w/api.php?' + new URLSearchParams(params);
			const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
			return resp.json();
		},
	};
}

async function fetchJson(host, params) {
	const url =
		'https://' +
		host +
		'/w/api.php?' +
		new URLSearchParams(Object.assign({ format: 'json' }, params));
	const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
	return resp.json();
}

function normalizeCategory(title) {
	return title.startsWith(CATEGORY_PREFIX) ? title : CATEGORY_PREFIX + title;
}

async function lookupQid(azApi, title) {
	const res = await fetchFullQuery(azApi, { action: 'query', titles: title, prop: 'pageprops' });
	const page = res.pages && Object.values(res.pages)[0];
	if (!page || page.missing !== undefined) {
		throw new Error('Page not found: ' + title);
	}
	if (!page.pageprops || !page.pageprops.wikibase_item) {
		throw new Error('Page is not connected to Wikidata: ' + title);
	}
	return page.pageprops.wikibase_item;
}

async function lookupAzTitle(qid) {
	const res = await fetchJson('www.wikidata.org', {
		action: 'wbgetentities',
		ids: qid,
		props: 'sitelinks',
		redirects: 'yes',
	});
	const entity = res.entities && res.entities[qid];
	if (entity && entity.sitelinks && entity.sitelinks.azwiki) {
		return entity.sitelinks.azwiki.title;
	}
	throw new Error('No azwiki sitelink for ' + qid);
}

async function fetchSitelinks(qid) {
	const res = await fetchJson('www.wikidata.org', {
		action: 'wbgetentities',
		ids: qid,
		props: 'sitelinks',
		redirects: 'yes',
	});
	const entity = res.entities && res.entities[qid];
	if (!entity || !entity.sitelinks) {
		throw new Error('No sitelinks for ' + qid);
	}
	const sites = [];
	const skipped = [];
	Object.entries(entity.sitelinks).forEach(([site, s]) => {
		if (!site.endsWith('wiki') || site === 'azwiki' || EXCLUDED_SITES.has(site)) {
			return;
		}
		const lang = site.replace(/wiki$/, '').replace(/_/g, '-');
		const apiHost = lang + '.wikipedia.org';
		if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.wikipedia\.org$/.test(apiHost)) {
			skipped.push(`${site} (host ${apiHost})`);
			return;
		}
		sites.push({ site, title: s.title, lang, apiHost });
	});
	return { sites, skipped };
}

async function fetchLocalTree(azApi, categoryTitle) {
	const memberSet = new Set();
	const subcatSet = new Set();
	const depth1 = [];
	const depth2 = [];
	const depth3 = [];

	const fetchCm = async (title) => {
		const resp = await fetchFullQuery(azApi, {
			action: 'query',
			list: 'categorymembers',
			cmtitle: title,
			cmtype: 'page|subcat',
			cmlimit: 'max',
		});
		return resp.categorymembers || [];
	};

	const level1 = await fetchCm(categoryTitle);
	level1.forEach((m) => {
		memberSet.add(m.title);
		if (m.ns === 14) {
			subcatSet.add(m.title);
			depth1.push(m.title);
		}
	});

	for (let i = 0; i < depth1.slice(0, MAX_DEPTH1_SUBCATS).length; i += DEPTH2_BATCH_SIZE) {
		const batch = depth1.slice(i, i + DEPTH2_BATCH_SIZE);
		const results = await Promise.all(batch.map((c) => fetchCm(c)));
		results.forEach((members) => {
			members.forEach((m) => {
				memberSet.add(m.title);
				if (m.ns === 14) {
					subcatSet.add(m.title);
					depth2.push(m.title);
				}
			});
		});
	}

	for (let i = 0; i < depth2.slice(0, MAX_DEPTH2_SUBCATS).length; i += DEPTH2_BATCH_SIZE) {
		const batch = depth2.slice(i, i + DEPTH2_BATCH_SIZE);
		const results = await Promise.all(batch.map((c) => fetchCm(c)));
		results.forEach((members) => {
			members.forEach((m) => {
				memberSet.add(m.title);
				if (m.ns === 14) {
					subcatSet.add(m.title);
					depth3.push(m.title);
				}
			});
		});
	}

	return { members: memberSet, subcats: subcatSet, depth1, depth2, depth3 };
}

async function fetchCurrentPageCats(azApi, title) {
	const res = await fetchFullQuery(azApi, {
		action: 'query',
		titles: title,
		prop: 'categories',
		cllimit: 'max',
	});
	const page = res.pages && Object.values(res.pages)[0];
	return page && page.categories ? page.categories.map((c) => c.title) : [];
}

async function fetchForeignMembers(sites, qid) {
	const globalCatToSites = new Map();
	const redirectResolvedCatToSites = new Map();
	const redirectResolvedCatToNames = new Map();

	for (let i = 0; i < sites.length; i += FETCH_CONCURRENCY) {
		const batch = sites.slice(i, i + FETCH_CONCURRENCY);
		await Promise.all(
			batch.map((siteData) =>
				fetchMembersSuggestions(
					makeApi(siteData.apiHost),
					siteData,
					siteData.lang,
					globalCatToSites,
					qid,
					redirectResolvedCatToSites,
					redirectResolvedCatToNames
				)
			)
		);
		if (i + FETCH_CONCURRENCY < sites.length) {
			await sleep(SLEEP_BETWEEN_BATCHES_MS);
		}
	}

	return { globalCatToSites, redirectResolvedCatToSites, redirectResolvedCatToNames };
}

async function classifyCandidates(azApi, candidates, localTree, currentPageCats) {
	const { members: memberSet, subcats: subcatSet } = localTree;
	const needCats = [];
	const reasons = new Map();

	candidates.forEach(({ title }) => {
		let reason;
		if (EXCLUDED_TITLES.has(title)) {
			reason = 'excluded title';
		} else {
			const ns = new mw.Title(title).getNamespaceId();
			if (!ALLOWED_NAMESPACES.includes(ns)) {
				reason = 'namespace ns' + ns;
			} else if (
				EXCLUDED_TITLE_KEYWORDS.some((kw) => title.includes(kw)) &&
				!EXCLUDED_KEYWORD_ALLOW_PATTERNS.some((pattern) => pattern.test(title))
			) {
				reason = 'excluded keyword';
			} else if (memberSet.has(title)) {
				reason = 'already a member';
			} else if (currentPageCats.has(title)) {
				reason = 'parent of current page';
			}
		}
		if (reason) {
			reasons.set(title, reason);
		} else {
			needCats.push(title);
		}
	});

	const allPagesCats = new Map();
	for (let i = 0; i < needCats.length; i += BATCH_SIZE_API) {
		const batch = needCats.slice(i, i + BATCH_SIZE_API);
		const res = await fetchFullQuery(azApi, {
			action: 'query',
			titles: batch.join('|'),
			prop: 'categories',
			cllimit: 'max',
		});
		const pages = res.pages || {};
		Object.values(pages).forEach((p) => {
			allPagesCats.set(p.title, p.categories ? p.categories.map((c) => c.title) : []);
		});
	}

	needCats.forEach((title) => {
		const cats = allPagesCats.get(title) || [];
		const inside = cats.filter((c) => subcatSet.has(c));
		reasons.set(
			title,
			inside.length > 0
				? 'inside existing subcat (' + inside.join(', ') + ')'
				: 'would be suggested'
		);
	});

	return reasons;
}

async function probeRedirects(azApi, titles) {
	const redirects = new Map();
	for (let i = 0; i < titles.length; i += BATCH_SIZE_API) {
		const batch = titles.slice(i, i + BATCH_SIZE_API);
		const res = await fetchFullQuery(azApi, {
			action: 'query',
			titles: batch.join('|'),
			prop: 'info',
		});
		(res.redirects || []).forEach((r) => redirects.set(r.from, r.to));
	}
	return redirects;
}

function printUsage() {
	console.error('Usage:\n  node bin/members.js "Category title" [--langs en,ru,tr] [--qid Q123]');
}

async function main() {
	const args = process.argv.slice(2);
	let titleArg = null;
	let langsArg = null;
	let qidArg = null;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === '--langs' || a === '--qid') {
			const value = args[++i];
			if (!value) {
				printUsage();
				process.exit(1);
			}
			if (a === '--langs') {
				langsArg = value;
			} else {
				qidArg = value;
			}
		} else if (!a.startsWith('--')) {
			titleArg = a;
		} else {
			printUsage();
			process.exit(1);
		}
	}
	if (!titleArg && !qidArg) {
		printUsage();
		process.exit(1);
	}

	const azApi = makeApi(AZ_HOST);

	let qid = qidArg;
	let categoryTitle = titleArg && normalizeCategory(titleArg);
	if (!qid && categoryTitle) {
		qid = await lookupQid(azApi, categoryTitle);
	}
	if (!categoryTitle && qid) {
		categoryTitle = await lookupAzTitle(qid);
	}

	console.log('=== CatSuggest members-mode diagnostic ===');
	console.log('Category:', categoryTitle, '| QID:', qid);
	console.log('');

	const { sites, skipped } = await fetchSitelinks(qid);
	console.log(
		'Wikidata sitelinks:',
		sites.length + skipped.length,
		'foreign | skipped:',
		skipped.length ? skipped.join('; ') : 'none'
	);
	sites.forEach((s) => console.log('  ' + s.site + ' => ' + s.title + ' (' + s.apiHost + ')'));

	const langs = langsArg
		? langsArg
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		: null;
	let selected;
	if (langs) {
		selected = sites.filter((s) => langs.includes(s.lang));
		const missing = langs.filter((l) => !selected.some((s) => s.lang === l));
		if (missing.length > 0) {
			console.log('  (note: no sitelink for lang(s): ' + missing.join(', ') + ')');
		}
	} else {
		selected = sites.filter((s) => LARGE_WIKI_SITES.has(s.site));
	}
	if (selected.length === 0) {
		console.log('\nNo languages selected (no large-wiki sitelinks).');
		return;
	}
	console.log(
		'\nSelected languages (' +
			(langs ? 'from --langs' : 'default large wikis') +
			'): ' +
			selected.map((s) => s.lang).join(', ')
	);
	console.log('');

	console.log('Fetching local category tree (depth 1-3)...');
	const localTree = await fetchLocalTree(azApi, categoryTitle);
	const treeSubcats = localTree.depth1.length + localTree.depth2.length + localTree.depth3.length;
	console.log(
		'  members (all depths):',
		localTree.members.size,
		'| subcats: depth1=' +
			localTree.depth1.length +
			' depth2=' +
			localTree.depth2.length +
			' depth3=' +
			localTree.depth3.length
	);
	if (localTree.depth1.length > 0) {
		console.log('  depth1 subcats: ' + localTree.depth1.join(', '));
	}
	console.log('');

	console.log(
		'Fetching foreign members (' +
			selected.length +
			' sites, concurrency ' +
			FETCH_CONCURRENCY +
			')...'
	);
	const { globalCatToSites, redirectResolvedCatToSites, redirectResolvedCatToNames } =
		await fetchForeignMembers(selected, qid);

	const candidates = Array.from(globalCatToSites.entries()).map(([title, sitesSet]) => ({
		title,
		sources: Array.from(sitesSet),
		redirectSites: Array.from(redirectResolvedCatToSites.get(title) || []),
	}));

	selected.forEach((s) => {
		const contributed = candidates.filter((c) => c.sources.includes(s.lang)).length;
		console.log('  ' + s.site + ': ' + contributed + ' unique az titles');
	});

	console.log('\nRaw candidates (unique az titles across selected sites):', candidates.length);
	const currentPageCats = await fetchCurrentPageCats(azApi, categoryTitle);

	const suggestions = await buildMembersSuggestions(
		candidates,
		{ members: localTree.members, subcats: localTree.subcats },
		azApi,
		new Set(currentPageCats),
		redirectResolvedCatToSites,
		redirectResolvedCatToNames
	);

	const currentPageCatsSet = new Set(currentPageCats);
	const reasons = await classifyCandidates(azApi, candidates, localTree, currentPageCatsSet);

	const countByReason = new Map();
	reasons.forEach((reason) => countByReason.set(reason, (countByReason.get(reason) || 0) + 1));

	console.log('');
	[...countByReason.keys()].sort().forEach((reason) => {
		console.log('  ' + countByReason.get(reason) + '  ' + reason);
	});
	console.log('');

	console.log('Filtered candidates:');
	candidates
		.filter((c) => reasons.get(c.title) !== 'would be suggested')
		.sort((a, b) => a.title.localeCompare(b.title))
		.forEach((c) =>
			console.log(
				'  - ' + c.title + ' [' + c.sources.join(', ') + '] (' + reasons.get(c.title) + ')'
			)
		);

	console.log('');
	console.log('Suggestions (' + suggestions.length + '):');
	suggestions
		.slice()
		.sort((a, b) => a.title.localeCompare(b.title))
		.forEach((s) => {
			const redirectFlag =
				s.redirectSites.length > 0
					? '  [foreign-redirect provenance: ' +
						s.redirectNames.map((p) => p.lang + ' -> ' + p.name).join('; ') +
						']'
					: '';
			console.log(
				'  * ' +
					s.title +
					(s.isCategory ? '  (kateqoriya)' : '') +
					'  sources: ' +
					s.sources.join(', ') +
					redirectFlag
			);
		});

	console.log('');
	console.log('azwiki redirect probe (all candidates):');
	const redirects = await probeRedirects(
		azApi,
		candidates.map((c) => c.title)
	);
	if (redirects.size === 0) {
		console.log('  none');
	} else {
		const suggestedSet = new Set(suggestions.map((s) => s.title));
		console.log('  azwiki redirects among candidates (the gadget resolves these):');
		[...redirects.entries()].sort().forEach(([from, to]) => {
			const inMembers = localTree.members.has(to);
			const suggested = suggestedSet.has(from);
			console.log(
				'  ' +
					from +
					' -> ' +
					to +
					'  [target already member: ' +
					(inMembers ? 'YES — dropped by resolve-and-dedupe' : 'no') +
					']' +
					(suggested ? '  (in suggestions — unresolved)' : '')
			);
		});
	}
}

main().catch((e) => {
	console.error('Error:', e && e.message ? e.message : String(e));
	process.exit(1);
});
