/**
 * Pure workflow state for the suggestion dialog.
 *
 * The UI used to track three related facts independently (`status`, `loading`
 * and the modal booleans). That made invalid combinations possible, for
 * example an aborted fetch leaving `status` on "loading", or a stale response
 * overwriting the results of a newer request. This reducer keeps the lifecycle
 * in one place and exposes selectors for the legacy template values.
 */

const WORKFLOW_PHASES = Object.freeze({
	IDLE: 'idle',
	INITIALIZING: 'initializing',
	FETCHING: 'fetching',
	RESULTS: 'results',
	APPLYING: 'applying',
	SUCCESS: 'success',
});

const WORKFLOW_ACTIONS = Object.freeze({
	INIT_START: 'INIT_START',
	INIT_COMPLETE: 'INIT_COMPLETE',
	FETCH_START: 'FETCH_START',
	FETCH_COMPLETE: 'FETCH_COMPLETE',
	FETCH_FAIL: 'FETCH_FAIL',
	CANCEL: 'CANCEL',
	RESET: 'RESET',
	APPLY_START: 'APPLY_START',
	APPLY_COMPLETE: 'APPLY_COMPLETE',
	APPLY_FAIL: 'APPLY_FAIL',
	SET_ERROR: 'SET_ERROR',
});

/**
 * @param {Object} [overrides]
 * @return {{phase: string, requestId: number|null, requestMode: string|null, error: string|null}}
 */
function createWorkflowState(overrides = {}) {
	return Object.assign(
		{
			phase: WORKFLOW_PHASES.IDLE,
			requestId: null,
			requestMode: null,
			error: null,
		},
		overrides
	);
}

/**
 * Whether an async result still belongs to the active operation. Both the
 * generation and the mode must match: switching tabs while a fetch is in
 * flight must not populate the newly selected tab.
 *
 * @param {Object} state
 * @param {{requestId: number, mode: string}|null} request
 * @return {boolean}
 */
function isRequestCurrent(state, request) {
	if (!request || request.requestId === null || request.requestId === undefined) {
		return false;
	}
	return state.requestId === request.requestId && state.requestMode === request.mode;
}

/**
 * @param {Object} state
 * @param {Object} action
 * @return {Object} Next state (the same object when a stale action is ignored)
 */
function workflowReducer(state, action) {
	switch (action.type) {
		case WORKFLOW_ACTIONS.INIT_START:
			return Object.assign({}, state, {
				phase: WORKFLOW_PHASES.INITIALIZING,
				requestId: action.requestId,
				requestMode: action.mode || null,
				error: null,
			});

		case WORKFLOW_ACTIONS.INIT_COMPLETE:
			if (!isRequestCurrent(state, action)) {
				return state;
			}
			return Object.assign({}, state, {
				phase: WORKFLOW_PHASES.IDLE,
				requestId: null,
				requestMode: null,
				error: action.error || null,
			});

		case WORKFLOW_ACTIONS.FETCH_START:
			return Object.assign({}, state, {
				phase: WORKFLOW_PHASES.FETCHING,
				requestId: action.requestId,
				requestMode: action.mode || null,
				error: null,
			});

		case WORKFLOW_ACTIONS.FETCH_COMPLETE:
			if (!isRequestCurrent(state, action)) {
				return state;
			}
			return Object.assign({}, state, {
				phase: WORKFLOW_PHASES.RESULTS,
				requestId: null,
				requestMode: null,
				error: action.error || null,
			});

		case WORKFLOW_ACTIONS.FETCH_FAIL:
			if (!isRequestCurrent(state, action)) {
				return state;
			}
			return Object.assign({}, state, {
				phase: WORKFLOW_PHASES.IDLE,
				requestId: null,
				requestMode: null,
				error: action.error || null,
			});

		case WORKFLOW_ACTIONS.CANCEL:
			if (
				action.requestId !== null &&
				action.requestId !== undefined &&
				state.requestId !== action.requestId
			) {
				return state;
			}
			return Object.assign({}, state, {
				phase: WORKFLOW_PHASES.IDLE,
				requestId: null,
				requestMode: null,
				error: null,
			});

		case WORKFLOW_ACTIONS.RESET:
			return createWorkflowState();

		case WORKFLOW_ACTIONS.APPLY_START:
			return Object.assign({}, state, {
				phase: WORKFLOW_PHASES.APPLYING,
				requestId: null,
				requestMode: null,
				error: null,
			});

		case WORKFLOW_ACTIONS.APPLY_COMPLETE:
			return Object.assign({}, state, {
				phase: WORKFLOW_PHASES.SUCCESS,
				requestId: null,
				requestMode: null,
				error: null,
			});

		case WORKFLOW_ACTIONS.APPLY_FAIL:
			return Object.assign({}, state, {
				phase: WORKFLOW_PHASES.RESULTS,
				requestId: null,
				requestMode: null,
				error: action.error || null,
			});

		case WORKFLOW_ACTIONS.SET_ERROR:
			return Object.assign({}, state, { error: action.error || null });

		default:
			return state;
	}
}

/**
 * Map the workflow phase onto the `status` values the template already uses.
 *
 * @param {Object} state
 * @return {string}
 */
function getWorkflowStatus(state) {
	switch (state.phase) {
		case WORKFLOW_PHASES.INITIALIZING:
		case WORKFLOW_PHASES.FETCHING:
			return 'loading';
		case WORKFLOW_PHASES.RESULTS:
			return 'results';
		case WORKFLOW_PHASES.APPLYING:
			return 'editing';
		case WORKFLOW_PHASES.SUCCESS:
			return 'success';
		default:
			return 'idle';
	}
}

/**
 * @param {Object} state
 * @return {boolean} Whether controls that mutate the request should be disabled
 */
function isWorkflowLoading(state) {
	return (
		state.phase === WORKFLOW_PHASES.INITIALIZING ||
		state.phase === WORKFLOW_PHASES.FETCHING ||
		state.phase === WORKFLOW_PHASES.APPLYING
	);
}

/**
 * Decide where a members batch edit should land. Keeping this pure makes the
 * interactions between partial success, failures and a stop request explicit
 * and testable.
 *
 * @param {Object} input
 * @param {number} input.total - Items scheduled for editing
 * @param {number} input.succeeded - Items edited successfully
 * @param {number} input.failed - Items that threw
 * @param {boolean} [input.aborted] - Whether a stop request arrived
 * @return {{phase: string, markProcessed: boolean, aborted: boolean, error: string|null}}
 */
function getBatchOutcome({ total, succeeded, failed, aborted = false }) {
	const attempted = succeeded + failed;
	const stoppedEarly = aborted && attempted < total;

	if (stoppedEarly && succeeded === 0) {
		return {
			phase: WORKFLOW_PHASES.RESULTS,
			markProcessed: false,
			aborted: true,
			error: 'Redaktə dayandırıldı. Heç bir səhifə redaktə edilmədi.',
		};
	}

	if (total > 0 && succeeded === 0 && failed === total) {
		return {
			phase: WORKFLOW_PHASES.RESULTS,
			markProcessed: false,
			aborted: false,
			error: 'Bütün redaktələr uğursuz oldu.',
		};
	}

	return {
		phase: WORKFLOW_PHASES.SUCCESS,
		markProcessed: succeeded > 0,
		// A stop request that arrived while the last edit was already in flight
		// has nothing left to skip, so it is not reported as an abort.
		aborted: stoppedEarly,
		error: null,
	};
}

module.exports = {
	WORKFLOW_PHASES,
	WORKFLOW_ACTIONS,
	createWorkflowState,
	isRequestCurrent,
	workflowReducer,
	getWorkflowStatus,
	isWorkflowLoading,
	getBatchOutcome,
};
