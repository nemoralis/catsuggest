/* eslint-env node */
/* eslint-disable no-console */

const { Mwn } = require('mwn');
const constants = require('../src/constants.js');
const { fetchFullQuery, getApiBatchSize } = require('../src/api.js');

const { ANCESTOR_CHECK_DEPTH, CATEGORY_PREFIX } = constants;

const bot = new Mwn({
	apiUrl: 'https://az.wikipedia.org/w/api.php',
});

// mwn's request() is mw.Api-compatible for our purposes; fetchFullQuery needs a `.get()`.
const api = {
	get: (params) => bot.request(params),
};

// title -> array of direct parent category titles (fetched lazily, cached across calls).
const parentMap = new Map();

async function fetchParents(titles) {
	const toFetch = titles.filter((t) => !parentMap.has(t));
	if (toFetch.length > 0) {
		const batchSize = await getApiBatchSize(api);
		for (let i = 0; i < toFetch.length; i += batchSize) {
			const batch = toFetch.slice(i, i + batchSize);
			const res = await fetchFullQuery(api, {
				action: 'query',
				titles: batch.join('|'),
				prop: 'categories',
				cllimit: 'max',
			});
			const pages = res.pages || {};
			Object.values(pages).forEach((p) => {
				const cats = p.categories ? p.categories.map((c) => c.title) : [];
				parentMap.set(p.title, cats);
			});
		}
	}
	toFetch.forEach((t) => {
		if (!parentMap.has(t)) {
			parentMap.set(t, []);
		}
	});
}

function normalizeCategory(name) {
	return name.startsWith(CATEGORY_PREFIX) ? name : CATEGORY_PREFIX + name;
}

async function getPageCategories(pageTitle) {
	const res = await fetchFullQuery(api, {
		action: 'query',
		titles: pageTitle,
		prop: 'categories',
		cllimit: 'max',
	});
	const pages = res.pages || {};
	const first = Object.values(pages)[0];
	if (!first || first.missing !== undefined) {
		return null;
	}
	return first.categories ? first.categories.map((c) => c.title) : [];
}

// Walk up from `root` through its ancestors up to `maxDepth` (level-by-level, batched).
// Returns all on-page ancestors found, each with the shortest path root -> ... -> ancestor.
async function findOnPageAncestors(root, onPageSet, maxDepth) {
	await fetchParents([root]);
	const visited = new Set([root]);
	const pred = new Map();
	let level = [root];
	const found = [];
	for (let depth = 1; depth <= maxDepth; depth++) {
		const next = [];
		for (const t of level) {
			for (const p of parentMap.get(t) || []) {
				if (visited.has(p)) {
					continue;
				}
				visited.add(p);
				pred.set(p, t);
				if (onPageSet.has(p)) {
					found.push({ title: p, depth });
				}
				next.push(p);
			}
		}
		if (next.length === 0) {
			break;
		}
		await fetchParents(next);
		level = next;
	}
	return found.map(({ title, depth }) => {
		const path = [title];
		let cur = title;
		while (pred.has(cur)) {
			cur = pred.get(cur);
			path.unshift(cur);
		}
		return { title, depth, path };
	});
}

async function pageMode(pageTitle) {
	const pageCats = await getPageCategories(pageTitle);
	if (pageCats === null) {
		console.error(`Page not found: ${pageTitle}`);
		process.exit(1);
	}
	const onPageSet = new Set(pageCats);

	console.log(`Page: ${pageTitle}`);
	console.log(`On-page categories (${pageCats.length}):`);
	pageCats.forEach((c) => console.log(`  ${c}`));
	console.log('');

	for (const cat of pageCats) {
		const hits = await findOnPageAncestors(cat, onPageSet, ANCESTOR_CHECK_DEPTH);
		if (hits.length === 0) {
			console.log(`${cat}\n  no on-page ancestors within depth ${ANCESTOR_CHECK_DEPTH}`);
			continue;
		}
		console.log(`${cat} -> removal candidate(s):`);
		hits.forEach((h) => {
			console.log(`  ${h.title}  (on page, depth ${h.depth})`);
			console.log(`    ${h.path.join(' -> ')}`);
		});
	}
}

async function pathMode(a, b) {
	const catA = normalizeCategory(a);
	const catB = normalizeCategory(b);
	const ancestorsOfA = new Set();
	const ancestorsOfB = new Set();

	const walk = async (root, target, maxDepth) => {
		await fetchParents([root]);
		const visited = new Set([root]);
		const pred = new Map();
		let level = [root];
		for (let depth = 1; depth <= maxDepth; depth++) {
			const next = [];
			for (const t of level) {
				for (const p of parentMap.get(t) || []) {
					if (visited.has(p)) {
						continue;
					}
					visited.add(p);
					pred.set(p, t);
					if (p === target) {
						return { found: true, depth, pred, root };
					}
					next.push(p);
				}
			}
			if (next.length === 0) {
				break;
			}
			await fetchParents(next);
			level = next;
		}
		return { found: false, ancestors: visited, pred, root };
	};

	const reconstruct = (pred, target, root) => {
		const path = [target];
		let cur = target;
		while (pred.has(cur)) {
			cur = pred.get(cur);
			path.unshift(cur);
		}
		return path;
	};

	const resAB = await walk(catA, catB, ANCESTOR_CHECK_DEPTH);
	if (resAB.found) {
		console.log(`${catB} is an ancestor of ${catA} (depth ${resAB.depth}):`);
		console.log(`  ${reconstruct(resAB.pred, catB, catA).join(' -> ')}`);
		return;
	}
	resAB.ancestors.forEach((t) => ancestorsOfA.add(t));

	const resBA = await walk(catB, catA, ANCESTOR_CHECK_DEPTH);
	if (resBA.found) {
		console.log(`${catA} is an ancestor of ${catB} (depth ${resBA.depth}):`);
		console.log(`  ${reconstruct(resBA.pred, catA, catB).join(' -> ')}`);
		return;
	}
	resBA.ancestors.forEach((t) => ancestorsOfB.add(t));

	const shared = [...ancestorsOfA].filter((t) => ancestorsOfB.has(t));
	if (shared.length === 0) {
		console.log(`${catA} and ${catB} are NOT connected within depth ${ANCESTOR_CHECK_DEPTH}.`);
		return;
	}
	shared.sort((x, y) => x.length - y.length);
	const common = shared[0];
	console.log(`${catA} and ${catB} are not ancestor/descendant but share ancestor ${common}:`);
	console.log(`  from ${catA}: ${reconstruct(resAB.pred, common, catA).join(' -> ')}`);
	console.log(`  from ${catB}: ${reconstruct(resBA.pred, common, catB).join(' -> ')}`);
}

async function main() {
	const args = process.argv.slice(2);
	const pathIdx = args.indexOf('--path');
	if (pathIdx !== -1) {
		const pair = (args[pathIdx + 1] || '').split('|').map((s) => s.trim());
		if (pair.length < 2) {
			console.error('Usage: node bin/cattree.js --path "CategoryA|CategoryB"');
			process.exit(1);
		}
		await pathMode(pair[0], pair[1]);
	} else if (args.length > 0) {
		await pageMode(args[0]);
	} else {
		console.error(
			'Usage:\n  node bin/cattree.js "Page title"\n  node bin/cattree.js --path "CategoryA|CategoryB"'
		);
		process.exit(1);
	}
}

main().catch((e) => {
	console.error('Error:', e && e.message ? e.message : String(e));
	process.exit(1);
});
