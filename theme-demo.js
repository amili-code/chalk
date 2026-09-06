// End-to-end smoke test for the new `theme` option.
// Run with:  node theme-demo.js
//
// Tip: pipe to `less -R` or run in a real terminal to see ANSI colors.
// All themed instances pass `level: 3` explicitly so the output stays colored
// even when piped.

import chalk, {Chalk} from './source/index.js';

// ─── 1. Build a themed logger the way an app would ─────────────────────────────
const log = new Chalk({
	level: 3,
	theme: {
		success: 'green',
		error: ['red', 'bold'],
		warning: 'yellow',
		info: 'cyan',
		debug: 'gray',
	},
});

// ─── 2. Print a fake startup banner ─────────────────────────────────────────────
console.log('\n=== Theme feature E2E demo ===\n');

console.log(log.info('App starting up...'));
console.log(log.debug('Loading configuration from ./config.json'));
console.log(log.success('Connected to database'));
console.log(log.warning('Cache size approaching limit (80%)'));
console.log(log.error.underline('Failed to connect to upstream service!'));
console.log(log.info('Retrying in 5 seconds...'));
console.log(log.success('Connection restored'));

// ─── 2b. Inspect the theme from the chalk instance itself ─────────────────────
console.log('\n--- inspecting chalk.theme ---');
console.log('log.theme:', JSON.stringify(log.theme));
console.log('log.bold.theme:', JSON.stringify(log.bold.theme));
console.log('default chalk.theme:', chalk.theme);

// ─── 3. Verify the default chalk export is untouched ───────────────────────────
console.log('\n--- default chalk is unchanged ---');
console.log('default chalk.red("x") =', JSON.stringify(chalk.red('x')));
console.log('default chalk.bold.blue =', JSON.stringify(chalk.bold.blue('y')));
console.log('default chalk has no "success":', chalk.success === undefined);

// ─── 4. Confirm symmetric chaining (theme.X.builtin === builtin.X.theme) ───────
console.log('\n--- symmetric chaining ---');
const a = log.error.underline('A');
const b = log.underline.error('A');
console.log('log.error.underline("A") =', JSON.stringify(a));
console.log('log.underline.error("A") =', JSON.stringify(b));
console.log('identical:', a === b);

// ─── 5. Theme isolation: two instances don't leak into each other ──────────────
console.log('\n--- theme isolation ---');
const dark = new Chalk({level: 3, theme: {info: 'magenta', error: 'red'}});
const light = new Chalk({level: 3, theme: {info: 'blue', error: 'red'}});
console.log('dark.info:', JSON.stringify(dark.info('hello')));
console.log('light.info:', JSON.stringify(light.info('hello')));
console.log('dark.warning is undefined:', dark.warning === undefined);
console.log('light.error has its own styling:', light.error('x'));

// ─── 6. Level behavior (runtime changes) ───────────────────────────────────────
console.log('\n--- runtime level changes ---');
const verbose = new Chalk({level: 3, theme: {success: 'green'}});
console.log('level=3 success:', JSON.stringify(verbose.success('ok')));
verbose.level = 0;
console.log('level=0 success:', JSON.stringify(verbose.success('ok')));
verbose.level = 2;
console.log('level=2 success:', JSON.stringify(verbose.success('ok')));

// ─── 7. Composition: arrays of styles nest correctly ──────────────────────────
console.log('\n--- array composition ---');
const strict = new Chalk({
	level: 3,
	theme: {
		critical: ['red', 'bold', 'underline'],
	},
});
console.log('critical:', JSON.stringify(strict.critical('system failure')));

// ─── 8. Validation: bad theme values throw ─────────────────────────────────────
console.log('\n--- validation (each line should be an error) ---');

const cases = [
	{label: 'theme is a string', value: 'green'},
	{label: 'theme is null', value: null},
	{label: 'theme is an array', value: ['green']},
	{label: 'value is a number', value: {success: 123}},
	{label: 'value is an unknown style', value: {success: 'notacolor'}},
	{label: 'array contains unknown style', value: {error: ['red', 'bam']}},
	{label: 'nested array', value: {error: [['red']]}},
];

for (const {label, value} of cases) {
	try {
		new Chalk({theme: value}); // eslint-disable-line no-new
		console.log(`  ✘ ${label}: did NOT throw`);
	} catch (error) {
		console.log(`  ✔ ${label}: ${error.message}`);
	}
}

// ─── 9. Template literal usage (the original example from the issue) ───────────
console.log('\n--- template literal style ---');
console.log(`
CPU: ${log.error('90%')}
RAM: ${log.success('40%')}
DISK: ${log.warning('70%')}
INFO: ${log.info('all systems nominal')}
`);

// ─── 10. Sanity check: legacy single-string usage still works ───────────────────
console.log('--- legacy usage (default chalk) still works ---');
console.log(chalk.blue('Hello') + ' World' + chalk.red('!'));
console.log(chalk.blue.bgRed.bold('Hello world!'));
