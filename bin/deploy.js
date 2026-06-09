/* eslint-env node */
/* eslint-disable no-console */

const fs = require( 'fs' );
const { Mwn } = require( 'mwn' );
const { execSync } = require( 'child_process' );

// JSON file with your username and bot password. Set up a bot password at [[Special:BotPasswords]]
const credentials = require( '../credentials.json' );

// Relative paths to built source files.
const JS_SOURCE = '../dist/catsuggest.js';
const CSS_SOURCE = '../catsuggest.css';
// On-wiki script page names
const JS_PAGE = 'MediaWiki:Gadget-catsuggest.js';
const CSS_PAGE = 'MediaWiki:Gadget-catsuggest.css';

/* eslint-disable-next-line new-cap */
const bot = new Mwn( {
	apiUrl: 'https://az.wikipedia.org/w/api.php',
	username: credentials.username,
	password: credentials.password
} );

// Version info for edit summary.
const sha = execSync( 'git rev-parse --short HEAD' ).toString();
const summary = process.argv[ 2 ] || execSync( 'git log -1 --pretty=%B' ).toString().trim();
const version = require( '../package.json' ).version;

bot.login().then( () => {
	const outjs = fs.readFileSync( __dirname + '/' + JS_SOURCE ).toString();
	const outcss = fs.readFileSync( __dirname + '/' + CSS_SOURCE ).toString();

	bot.save( JS_PAGE, outjs, `{ sha.trim() }: ${ summary }` ).then( () => {
		console.log( `Successfully saved dist/catsuggest.js to ${ JS_PAGE }` );
	} );

	bot.save( CSS_PAGE, outcss, `${ sha.trim() }: ${ summary }` ).then( () => {
		console.log( `Successfully saved catsuggest.css to ${ CSS_PAGE }` );
	} );
} );
