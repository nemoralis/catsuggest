const {
	MAX_RETRIES,
	RETRY_BASE_DELAY_MS,
	USER_AGENT
} = require( './constants.js' );

function sleep( ms ) {
	return new Promise( ( resolve ) => {
		setTimeout( resolve, ms );
	} );
}

async function retryApiCall( fn, retries ) {
	const attempts = retries || MAX_RETRIES;

	function normalizeError( e ) {
		if ( e instanceof Error ) {
			return e;
		}
		const wrapped = new Error( String( e ) );
		wrapped.code = e;
		wrapped.isApiError = true;
		return wrapped;
	}

	const RETRYABLE_CODES = new Set( [ 'http', 'maxlag', 'ratelimited' ] );
	function isRetryable( e ) {
		const s = String( e.isApiError ? e.code : e.message || e ).toLowerCase();
		return (
			RETRYABLE_CODES.has( s ) ||
			s.includes( 'timeout' ) ||
			s.includes( 'network' ) ||
			s.includes( '429' ) ||
			s.includes( '503' ) ||
			s.includes( 'rate' ) ||
			s.includes( 'internal_api_error' )
		);
	}

	function getRetryDelay( e, attempt ) {
		const base = RETRY_BASE_DELAY_MS * Math.pow( 2, attempt );
		const header =
			e.result &&
			e.result.xhr &&
			e.result.xhr.getResponseHeader &&
			e.result.xhr.getResponseHeader( 'Retry-After' );
		if ( header ) {
			const seconds = parseInt( header, 10 );
			if ( !isNaN( seconds ) && seconds > 0 ) {
				return Math.max( base, seconds * 1000 );
			}
		}
		return base;
	}

	let lastError;
	for ( let i = 0; i < attempts; i++ ) {
		try {
			return await Promise.resolve( fn() ).catch( ( code, errResult ) => {
				const error = new Error( String( code ) );
				Object.assign( error, { code, result: errResult, isApiError: true } );
				throw error;
			} );
		} catch ( e ) {
			lastError = normalizeError( e );
			const isLastAttempt = i === attempts - 1;
			if ( !isRetryable( lastError ) || isLastAttempt ) {
				throw lastError;
			}
			await sleep( getRetryDelay( lastError, i ) );
		}
	}
	throw lastError;
}

function getErrorMessage( e ) {
	if ( !e ) {
		return 'Naməlum xəta';
	}
	if ( typeof e === 'string' ) {
		return e;
	}
	if ( e.isApiError ) {
		let msg = e.code || 'api-error';
		if ( e.code === 'http' && e.result && e.result.xhr ) {
			const xhr = e.result.xhr;
			if ( xhr.status && xhr.statusText ) {
				msg += ` (${ xhr.status }: ${ xhr.statusText })`;
			} else if ( xhr.statusText ) {
				msg += ` (${ xhr.statusText })`;
			}
		} else if ( e.result && e.result.error && e.result.error.info ) {
			msg += `: ${ e.result.error.info }`;
		}
		return msg;
	}
	return e.message || String( e );
}

async function fetchFullQuery( apiInstance, params ) {
	const result = {};
	let continueToken;
	do {
		const reqParams = Object.assign( {}, params, { format: 'json' } );
		if ( continueToken ) {
			Object.assign( reqParams, continueToken );
		}
		const resp = await retryApiCall( () => apiInstance.get( reqParams ) );
		if ( resp.query ) {
			for ( const key in resp.query ) {
				if ( Array.isArray( resp.query[ key ] ) ) {
					result[ key ] = ( result[ key ] || [] ).concat( resp.query[ key ] );
				} else if ( typeof resp.query[ key ] === 'object' ) {
					result[ key ] = result[ key ] || {};
					for ( const subKey in resp.query[ key ] ) {
						if ( !result[ key ][ subKey ] ) {
							result[ key ][ subKey ] = resp.query[ key ][ subKey ];
						} else {
							const existing = result[ key ][ subKey ];
							const incoming = resp.query[ key ][ subKey ];
							if ( incoming.categories ) {
								existing.categories = ( existing.categories || [] ).concat(
									incoming.categories
								);
							}
						}
					}
				}
			}
		}
		continueToken = resp.continue || undefined;
	} while ( continueToken );
	return result;
}

function createLocalApi() {
	return new mw.Api( { userAgent: USER_AGENT } );
}

function createWikidataApi() {
	return new mw.ForeignApi(
		'https://www.wikidata.org/w/api.php',
		{ userAgent: USER_AGENT }
	);
}

function createForeignApi( apiHost ) {
	return new mw.ForeignApi(
		`https://${ apiHost }/w/api.php`,
		{ userAgent: USER_AGENT }
	);
}

module.exports = {
	sleep,
	retryApiCall,
	getErrorMessage,
	fetchFullQuery,
	createLocalApi,
	createWikidataApi,
	createForeignApi
};
