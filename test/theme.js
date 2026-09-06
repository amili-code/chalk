import test from 'ava';
import chalk, {Chalk, chalkStderr} from '../source/index.js';

chalk.level = 3;
chalkStderr.level = 3;

// Helper: build a themed chalk at level 3 so styled output is emitted regardless of TTY detection.
const themedAt3 = theme => new Chalk({level: 3, theme});

test('string theme entry resolves to a single built-in style', t => {
	const themed = themedAt3({success: 'green'});
	t.is(themed.success('ok'), '\u{1B}[32mok\u{1B}[39m');
});

test('array theme entry composes styles in the given order', t => {
	const themed = themedAt3({error: ['red', 'bold']});
	t.is(themed.error('bad'), '\u{1B}[31m\u{1B}[1mbad\u{1B}[22m\u{1B}[39m');
});

test('theme styles chain with built-in modifiers in both directions', t => {
	const themed = themedAt3({error: ['red', 'bold']});

	// Theme style first, then a built-in modifier.
	t.is(
		themed.error.underline('!'),
		'\u{1B}[31m\u{1B}[1m\u{1B}[4m!\u{1B}[24m\u{1B}[22m\u{1B}[39m',
	);

	// Built-in modifier first, then the theme style. Must produce the same escaped string.
	t.is(
		themed.underline.error('?'),
		'\u{1B}[4m\u{1B}[31m\u{1B}[1m?\u{1B}[22m\u{1B}[39m\u{1B}[24m',
	);
});

test('theme getters read through long chains', t => {
	const themed = themedAt3({success: 'green'});
	const chain = themed.bold.italic.success;
	t.is(chain('ok'), '\u{1B}[1m\u{1B}[3m\u{1B}[32mok\u{1B}[39m\u{1B}[23m\u{1B}[22m');
});

test('theme respects the instance level', t => {
	const themed = new Chalk({level: 0, theme: {success: 'green'}});
	t.is(themed.success('ok'), 'ok');
});

test('theme getters honor runtime level changes', t => {
	const themed = new Chalk({level: 2, theme: {success: 'green'}});
	t.is(themed.success('ok'), '\u{1B}[32mok\u{1B}[39m');

	themed.level = 0;
	t.is(themed.success('ok'), 'ok');

	themed.level = 3;
	t.is(themed.success('ok'), '\u{1B}[32mok\u{1B}[39m');
});

test('theme keys shadow built-in styles of the same name', t => {
	const themed = themedAt3({red: 'green'});
	t.is(themed.red('ok'), '\u{1B}[32mok\u{1B}[39m');
});

test('themed instance is isolated from the default chalk', t => {
	const themed = themedAt3({success: 'green', error: 'red'});

	// Default chalk is unchanged.
	t.is(chalk.red('x'), '\u{1B}[31mx\u{1B}[39m');
	t.is(chalk.success, undefined);

	// Themed instance only sees its own mapping.
	t.is(themed.red('x'), '\u{1B}[31mx\u{1B}[39m'); // `red` not shadowed here
	t.is(themed.success('ok'), '\u{1B}[32mok\u{1B}[39m');
});

test('two themed instances do not leak into each other', t => {
	const a = themedAt3({success: 'green', warning: 'yellow'});
	const b = themedAt3({success: 'red'});

	t.is(a.success('ok'), '\u{1B}[32mok\u{1B}[39m');
	t.is(b.success('ok'), '\u{1B}[31mok\u{1B}[39m');

	// `warning` is defined on `a` only.
	const aWarning = a.warning;
	t.is(aWarning('!'), '\u{1B}[33m!\u{1B}[39m'); // Yellow

	// `b` doesn't have `warning`, so accessing it returns `undefined`.
	t.is(b.warning, undefined);
});

test('themed instance does not gain theme styles from a sibling themed instance', t => {
	const a = themedAt3({warning: 'yellow'});
	const b = themedAt3({error: 'red'});

	t.is(a.warning('!'), '\u{1B}[33m!\u{1B}[39m');
	t.is(b.warning, undefined);
	t.is(b.error('!'), '\u{1B}[31m!\u{1B}[39m');
	t.is(a.error, undefined);
});

test('theme name collides with a built-in color on a different instance does not affect the themed instance', t => {
	const themed = themedAt3({green: 'red'});
	const other = new Chalk({level: 3});
	t.is(themed.green('ok'), '\u{1B}[31mok\u{1B}[39m');
	t.is(other.green('ok'), '\u{1B}[32mok\u{1B}[39m');
});

test('chalkStderr is constructed without affecting the ability to build themed instances', t => {
	// Exercise the module-level `chalkStderr` path that shares the same factory.
	t.is(chalkStderr.red('x'), '\u{1B}[31mx\u{1B}[39m');
});

test('theme option accepts an empty object without changing behaviour', t => {
	const themed = themedAt3({});
	t.is(themed.red('x'), '\u{1B}[31mx\u{1B}[39m');
});

test('a non-string value throws', t => {
	t.throws(() => {
		new Chalk({theme: {success: 123}}); // eslint-disable-line no-new
	}, {instanceOf: TypeError, message: /string or an array of strings/v});
});

test('an unknown style name throws', t => {
	t.throws(() => {
		new Chalk({theme: {success: 'notacolor'}}); // eslint-disable-line no-new
	}, {instanceOf: TypeError, message: /Unknown theme style: "notacolor"/v});
});

test('an array containing an unknown style name throws', t => {
	t.throws(() => {
		new Chalk({theme: {error: ['red', 'notamodifier']}}); // eslint-disable-line no-new
	}, {instanceOf: TypeError, message: /Unknown theme style: "notamodifier"/v});
});

test('a non-object theme option throws', t => {
	for (const value of [null, 'green', 123, ['green'], true]) {
		t.throws(() => {
			new Chalk({theme: value}); // eslint-disable-line no-new
		}, {instanceOf: TypeError, message: /must be a plain object/v}, `theme: ${String(value)}`);
	}
});

test('a nested array throws', t => {
	t.throws(() => {
		new Chalk({theme: {error: [['red']]}}); // eslint-disable-line no-new
	}, {instanceOf: TypeError, message: /string or an array of strings/v});
});

test('cached theme builders keep working after subsequent calls', t => {
	const themed = themedAt3({success: 'green'});
	const {success} = themed;
	t.is(success('ok'), '\u{1B}[32mok\u{1B}[39m');
	t.is(success('done'), '\u{1B}[32mdone\u{1B}[39m');
});

test('theme styles work inside template literals and chain with built-ins', t => {
	const themed = themedAt3({success: 'green', error: 'red'});
	t.is(
		`${themed.success('ok')} ${themed.error('bad')}`,
		'\u{1B}[32mok\u{1B}[39m \u{1B}[31mbad\u{1B}[39m',
	);
});

test('`chalk.theme` returns the theme definition on a themed instance', t => {
	const definition = {success: 'green', error: ['red', 'bold']};
	const themed = new Chalk({theme: definition});
	t.deepEqual(themed.theme, definition);
});

test('`chalk.theme` is `undefined` for an unthemed instance', t => {
	const plain = new Chalk();
	t.is(plain.theme, undefined);

	// And for the module-level default.
	t.is(chalk.theme, undefined);
});

test('`chalk.theme` is accessible through the chain (builders walk back via GENERATOR)', t => {
	const definition = {error: 'red'};
	const themed = new Chalk({theme: definition});

	t.deepEqual(themed.theme, definition);
	t.deepEqual(themed.error.theme, definition);
	t.deepEqual(themed.bold.error.theme, definition);
	t.deepEqual(themed.error.italic.bold.theme, definition);
});

test('two themed instances expose independent theme definitions', t => {
	const a = new Chalk({theme: {info: 'cyan'}});
	const b = new Chalk({theme: {info: 'magenta'}});

	t.deepEqual(a.theme, {info: 'cyan'});
	t.deepEqual(b.theme, {info: 'magenta'});
	t.not(a.theme, b.theme);
});

test('`chalk.theme` is non-writable on the chalk root', t => {
	const themed = new Chalk({theme: {success: 'green'}});
	t.throws(() => {
		themed.theme = {error: 'red'};
	}, {instanceOf: TypeError});
});

test('`chalk.theme` returns the same object that was passed to the constructor', t => {
	const definition = {success: 'green'};
	const themed = new Chalk({theme: definition});
	t.is(themed.theme, definition);
});
