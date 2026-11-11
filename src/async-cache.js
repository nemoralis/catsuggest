/**
 * Small promise cache for expensive read-only loads (local members trees,
 * parent categories). A rejected promise must not stay cached: otherwise one
 * transient API failure poisons the cache until the page is reloaded.
 *
 * @return {Object} Cache with get(), has(), invalidate() and clear()
 */
function createAsyncCache() {
	const entries = new Map();

	/**
	 * Return the cached promise for `key`, or start `factory` and cache it.
	 * Concurrent callers share one in-flight promise.
	 *
	 * @param {string} key
	 * @param {Function} factory - Returns a promise or a plain value
	 * @return {Promise}
	 */
	function get(key, factory) {
		const existing = entries.get(key);
		if (existing) {
			return existing.promise;
		}

		let promise;
		try {
			promise = Promise.resolve(factory());
		} catch (err) {
			promise = Promise.reject(err);
		}

		const entry = { promise };
		entries.set(key, entry);

		// Remove only this attempt. If the key was invalidated and repopulated
		// while the old promise was pending, deleting by key would evict the
		// newer entry.
		promise.catch(() => {
			if (entries.get(key) === entry) {
				entries.delete(key);
			}
		});

		return promise;
	}

	/**
	 * @param {string} key
	 * @return {boolean}
	 */
	function has(key) {
		return entries.has(key);
	}

	/**
	 * @param {string} key
	 * @return {void}
	 */
	function invalidate(key) {
		entries.delete(key);
	}

	/**
	 * @return {void}
	 */
	function clear() {
		entries.clear();
	}

	return { get, has, invalidate, clear };
}

module.exports = { createAsyncCache };
