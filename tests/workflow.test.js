import { describe, it, expect } from 'vitest';

const {
	createWorkflowState,
	workflowReducer,
	isRequestCurrent,
	getWorkflowStatus,
	isWorkflowLoading,
	getBatchOutcome,
} = await import('../src/workflow.js');

const memberRequest = { requestId: 1, mode: 'members' };

function reduce(state, action) {
	return workflowReducer(state, action);
}

describe('workflowReducer', () => {
	it('starts idle with no error', () => {
		const state = createWorkflowState();

		expect(getWorkflowStatus(state)).toBe('idle');
		expect(isWorkflowLoading(state)).toBe(false);
		expect(state.error).toBeNull();
	});

	it('moves through initialization and clears the request on completion', () => {
		let state = reduce(createWorkflowState(), {
			type: 'INIT_START',
			requestId: 7,
			mode: 'members',
		});
		expect(getWorkflowStatus(state)).toBe('loading');
		expect(isWorkflowLoading(state)).toBe(true);
		expect(isRequestCurrent(state, { requestId: 7, mode: 'members' })).toBe(true);

		state = reduce(state, {
			type: 'INIT_COMPLETE',
			requestId: 7,
			mode: 'members',
			error: null,
		});
		expect(getWorkflowStatus(state)).toBe('idle');
		expect(isWorkflowLoading(state)).toBe(false);
		expect(isRequestCurrent(state, { requestId: 7, mode: 'members' })).toBe(false);
	});

	it('moves a fetch through results and exposes the legacy status', () => {
		let state = reduce(createWorkflowState(), {
			type: 'FETCH_START',
			requestId: 1,
			mode: 'members',
		});
		expect(getWorkflowStatus(state)).toBe('loading');

		state = reduce(state, {
			type: 'FETCH_COMPLETE',
			requestId: 1,
			mode: 'members',
			error: null,
		});
		expect(getWorkflowStatus(state)).toBe('results');
		expect(isWorkflowLoading(state)).toBe(false);
	});

	it('ignores a response from an older request generation', () => {
		const state = reduce(createWorkflowState(), {
			type: 'FETCH_START',
			requestId: 2,
			mode: 'members',
		});

		const stale = reduce(state, {
			type: 'FETCH_COMPLETE',
			requestId: 1,
			mode: 'members',
			error: null,
		});
		expect(stale).toBe(state);
	});

	it('ignores a response for a different mode', () => {
		const state = reduce(createWorkflowState(), {
			type: 'FETCH_START',
			requestId: 3,
			mode: 'members',
		});

		const wrongMode = reduce(state, {
			type: 'FETCH_COMPLETE',
			requestId: 3,
			mode: 'parentCats',
			error: null,
		});
		expect(wrongMode).toBe(state);
	});

	it('returns to idle with an error when a fetch fails', () => {
		let state = reduce(createWorkflowState(), {
			type: 'FETCH_START',
			requestId: 4,
			mode: 'parentCats',
		});
		state = reduce(state, {
			type: 'FETCH_FAIL',
			requestId: 4,
			mode: 'parentCats',
			error: 'boom',
		});

		expect(getWorkflowStatus(state)).toBe('idle');
		expect(state.error).toBe('boom');
	});

	it('invalidates the active request when cancelled', () => {
		const state = reduce(createWorkflowState(), {
			type: 'FETCH_START',
			requestId: 5,
			mode: 'members',
		});

		const cancelled = reduce(state, { type: 'CANCEL', requestId: 5 });
		expect(getWorkflowStatus(cancelled)).toBe('idle');
		expect(isRequestCurrent(cancelled, { requestId: 5, mode: 'members' })).toBe(false);
	});

	it('does not cancel a newer request by id', () => {
		const state = reduce(createWorkflowState(), {
			type: 'FETCH_START',
			requestId: 6,
			mode: 'members',
		});

		const unchanged = reduce(state, { type: 'CANCEL', requestId: 5 });
		expect(unchanged).toBe(state);
	});

	it('resets all workflow fields', () => {
		let state = reduce(createWorkflowState(), {
			type: 'FETCH_START',
			requestId: 8,
			mode: 'members',
		});
		state = reduce(state, {
			type: 'APPLY_FAIL',
			error: 'edit failed',
		});
		state = reduce(state, { type: 'RESET' });

		expect(getWorkflowStatus(state)).toBe('idle');
		expect(state.requestId).toBeNull();
		expect(state.requestMode).toBeNull();
		expect(state.error).toBeNull();
	});

	it('maps applying to editing and success to success', () => {
		let state = reduce(createWorkflowState(), { type: 'APPLY_START' });
		expect(getWorkflowStatus(state)).toBe('editing');
		expect(isWorkflowLoading(state)).toBe(true);

		state = reduce(state, { type: 'APPLY_COMPLETE' });
		expect(getWorkflowStatus(state)).toBe('success');
		expect(isWorkflowLoading(state)).toBe(false);

		state = reduce(createWorkflowState(), { type: 'APPLY_START' });
		state = reduce(state, { type: 'APPLY_FAIL', error: 'nope' });
		expect(getWorkflowStatus(state)).toBe('results');
		expect(state.error).toBe('nope');
	});
});

describe('getBatchOutcome', () => {
	it('marks the page processed when every edit succeeds', () => {
		expect(
			getBatchOutcome({ total: 3, succeeded: 3, failed: 0, aborted: false })
		).toEqual({
			phase: 'success',
			markProcessed: true,
			aborted: false,
			error: null,
		});
	});

	it('keeps partial success visible without treating it as an abort', () => {
		expect(
			getBatchOutcome({ total: 3, succeeded: 2, failed: 1, aborted: false })
		).toEqual({
			phase: 'success',
			markProcessed: true,
			aborted: false,
			error: null,
		});
	});

	it('reports an early stop that saved some pages', () => {
		expect(
			getBatchOutcome({ total: 5, succeeded: 2, failed: 1, aborted: true })
		).toEqual({
			phase: 'success',
			markProcessed: true,
			aborted: true,
			error: null,
		});
	});

	it('returns to results when an early stop saved nothing', () => {
		expect(
			getBatchOutcome({ total: 5, succeeded: 0, failed: 0, aborted: true })
		).toEqual({
			phase: 'results',
			markProcessed: false,
			aborted: true,
			error: 'Redaktə dayandırıldı. Heç bir səhifə redaktə edilmədi.',
		});
	});

	it('returns to results when every edit failed', () => {
		expect(
			getBatchOutcome({ total: 2, succeeded: 0, failed: 2, aborted: false })
		).toEqual({
			phase: 'results',
			markProcessed: false,
			aborted: false,
			error: 'Bütün redaktələr uğursuz oldu.',
		});
	});

	it('ignores a stop request that arrived after the last edit started', () => {
		expect(
			getBatchOutcome({ total: 2, succeeded: 2, failed: 0, aborted: true })
		).toEqual({
			phase: 'success',
			markProcessed: true,
			aborted: false,
			error: null,
		});
	});
});
