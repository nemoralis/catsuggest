/**
 * Starts a local server for development.
 * To use, run "node bin/server.js", then in your wiki common.js add:
 *   mw.loader.load( 'http://localhost:5500/dist/catsuggest.js' );
 */
/* global process */

const http = require( 'http' );
const fs = require( 'fs' );
const path = require( 'path' );

const server = http.createServer( ( request, response ) => {
	const filePath = path.join( __dirname, '..', request.url.replace( /^\//, '' ) );
	let contentType;
	if ( request.url.endsWith( '.js' ) ) {
		contentType = 'text/javascript';
	} else if ( request.url.endsWith( '.css' ) ) {
		contentType = 'text/css';
	} else {
		contentType = 'text/plain';
	}
	fs.readFile( filePath, ( error, content ) => {
		if ( error ) {
			response.end( `Oops, something went wrong: ${ error.code }\n` );
		} else {
			response.writeHead( 200, { 'Content-Type': contentType } );
			response.end( content, 'utf-8' );
		}
	} );
} );

const hostname = '127.0.0.1';
const port = isNaN( Number( process.argv[ 2 ] ) ) ? 5500 : Number( process.argv[ 2 ] );

server.listen( port, hostname, () => {
	// eslint-disable-next-line no-console
	console.log( `Server running at http://${ hostname }:${ port }/` );
} );
