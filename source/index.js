import {
	stringReplaceAll,
	stringEncaseCRLFWithFirstIndex,
} from './utilities.js';
import ansiStyles from '#ansi-styles';
import supportsColor from '#supports-color';

const {stdout: stdoutColor, stderr: stderrColor} = supportsColor;

const GENERATOR = Symbol('GENERATOR');
const STYLER = Symbol('STYLER');
const IS_EMPTY = Symbol('IS_EMPTY');
const LEVEL = Symbol('LEVEL');
// Per-instance prototype that carries `theme` getters. Held on the chalk function under this symbol so `createBuilder` can find it via `[GENERATOR]` without leaking across instances.
const PROTO = Symbol('PROTO');

const styles = Object.create(null);

const assertValidLevel = level => {
	if (!Number.isSafeInteger(level) || level < 0 || level > 3) {
		throw new Error('The `level` should be an integer from 0 to 3');
	}
};

// The level is stored under a symbol so the hot path can read it as a plain property, while `level` itself is an accessor that rejects values the rest of the code could not handle.
const levelDescriptor = {
	enumerable: true,
	get() {
		return this[LEVEL];
	},
	set(level) {
		assertValidLevel(level);
		this[LEVEL] = level;
	},
};

const applyOptions = (object, options = {}) => {
	if (options.level !== undefined) {
		assertValidLevel(options.level);
	}

	// Detect level if not set manually. Written under the symbol rather than through `level`, as the prototype carrying that accessor is not installed until after this runs.
	const colorLevel = stdoutColor ? stdoutColor.level : 0;
	object[LEVEL] = options.level === undefined ? colorLevel : options.level;

	// Theme shape is checked here so a malformed option throws before any prototype wiring happens. Per-entry validation (unknown style names, etc.) is delegated to `resolveThemeStyle` and surfaces from `createThemedProto`.
	if (options.theme !== undefined && (options.theme === null || typeof options.theme !== 'object' || Array.isArray(options.theme))) {
		throw new TypeError('The `theme` option must be a plain object');
	}
};

export class Chalk {
	constructor(options) {
		// eslint-disable-next-line no-constructor-return
		return chalkFactory(options);
	}
}

const chalkFactory = (options = {}) => {
	const chalk = (...strings) => strings.join(' ');
	applyOptions(chalk, options);

	if (options.theme === undefined) {
		Object.setPrototypeOf(chalk, createChalk.prototype);
		return chalk;
	}

	// Build a per-instance prototype that carries the theme getters, then wire both the chalk function and any future builders to it via the shared module-level `proto`.
	const themedProto = createThemedProto(options.theme);
	chalk[PROTO] = themedProto;
	Object.setPrototypeOf(chalk, themedProto);
	// Install `level` and `theme` together. `level` uses the same direct-read descriptor the non-themed path installs via `createChalk.prototype`, so the inherited `proto` getter (which dereferences `[GENERATOR]` and would throw here) is never reached. `theme` is non-writable so a stray `themed.theme = …` throws instead of silently shadowing the real styles.
	Object.defineProperties(chalk, {
		level: levelDescriptor,
		theme: {
			value: options.theme,
			enumerable: true,
			writable: false,
			configurable: false,
		},
	});

	return chalk;
};

function createChalk(options) {
	return chalkFactory(options);
}

// eslint-disable-next-line unicorn/no-top-level-side-effects -- The prototype chain must be set up at module load.
Object.setPrototypeOf(createChalk.prototype, Function.prototype);

for (const [styleName, style] of Object.entries(ansiStyles)) {
	styles[styleName] = {
		get() {
			const builder = createBuilder(this, createStyler(style.open, style.close, this[STYLER]), this[IS_EMPTY]);
			Object.defineProperty(this, styleName, {value: builder});
			return builder;
		},
	};
}

styles.visible = {
	get() {
		const builder = createBuilder(this, this[STYLER], true);
		Object.defineProperty(this, 'visible', {value: builder});
		return builder;
	},
};

// Resolve a color model to one converter per `level`, so that a call only has to look up the converter for the current level instead of re-deciding the model and level every time.
const createModelConverters = (model, type) => {
	const style = ansiStyles[type];

	if (model === 'rgb') {
		const ansi = (red, green, blue) => style.ansi(ansiStyles.rgbToAnsi(red, green, blue));
		const ansi256 = (red, green, blue) => style.ansi256(ansiStyles.rgbToAnsi256(red, green, blue));
		return [ansi, ansi, ansi256, style.ansi16m];
	}

	if (model === 'hex') {
		const ansi = hex => style.ansi(ansiStyles.hexToAnsi(hex));
		const ansi256 = hex => style.ansi256(ansiStyles.hexToAnsi256(hex));
		return [ansi, ansi, ansi256, hex => style.ansi16m(...ansiStyles.hexToRgb(hex))];
	}

	// `ansi256` is already the native form, so only the 16-color levels need converting.
	const ansi = code => style.ansi(ansiStyles.ansi256ToAnsi(code));
	return [ansi, ansi, style.ansi256, style.ansi256];
};

const usedModels = ['rgb', 'hex', 'ansi256'];

for (const model of usedModels) {
	const capitalizedModel = model[0].toUpperCase() + model.slice(1);

	for (const [styleName, type] of [
		[model, 'color'],
		['bg' + capitalizedModel, 'bgColor'],
		['underline' + capitalizedModel, 'underlineColor'],
	]) {
		const {close} = ansiStyles[type];
		const converters = createModelConverters(model, type);

		styles[styleName] = {
			get() {
				// The level is read on call rather than captured here so the function can be cached on the instance instead of being reallocated on every property access.
				// `rgb` is the widest model, so naming the three parameters avoids a rest array.
				const styleFunction = function (first, second, third) {
					const open = converters[this.level](first, second, third);
					return createBuilder(this, createStyler(open, close, this[STYLER]), this[IS_EMPTY]);
				};

				Object.defineProperty(this, styleName, {value: styleFunction});
				return styleFunction;
			},
		};
	}
}

const proto = Object.defineProperties(
	() => {},
	{
		...styles,
		level: {
			enumerable: true,
			get() {
				return this[GENERATOR].level;
			},
			set(level) {
				this[GENERATOR].level = level;
			},
		},
	},
);

const createStyler = (open, close, parent) => {
	let openAll;
	let closeAll;
	if (parent === undefined) {
		openAll = open;
		closeAll = close;
	} else {
		openAll = parent.openAll + open;
		closeAll = close + parent.closeAll;
	}

	return {
		open,
		close,
		openAll,
		closeAll,
		parent,
	};
};

const createBuilder = (self, _styler, _isEmpty) => {
	// Single argument is hot path, implicit coercion is faster than anything
	const builder = (...arguments_) => {
		if (arguments_.length === 1) {
			// eslint-disable-next-line no-implicit-coercion
			return applyStyle(builder, '' + arguments_[0]);
		}

		if (arguments_.length === 2) {
			return applyStyle(builder, arguments_[0] + ' ' + arguments_[1]);
		}

		return applyStyle(builder, arguments_.join(' '));
	};

	// Pick up the per-instance prototype when the chalk root carries a theme; otherwise builders share the module-level `proto`. Either way builders are still functions whose only difference from `self` is the `[STYLER]` / `[IS_EMPTY]` they carry.
	const instanceProto = (self[GENERATOR] ?? self)[PROTO] ?? proto;
	Object.setPrototypeOf(builder, instanceProto);

	// Point every builder at the root generator instead of its immediate parent, so reading the level costs one property load rather than walking a `level` getter per link of the chain.
	builder[GENERATOR] = self[GENERATOR] ?? self;
	builder[STYLER] = _styler;
	builder[IS_EMPTY] = _isEmpty;

	return builder;
};

// Resolve a `theme` entry value to the `{open, close}` escape codes it represents. Strings reference a single built-in style; arrays compose styles in the given order, mirroring how chained `chalk.red.bold` would compose their codes.
const resolveThemeStyle = value => {
	if (typeof value === 'string') {
		if (!Object.hasOwn(ansiStyles, value)) {
			throw new TypeError(`Unknown theme style: "${value}"`);
		}

		return ansiStyles[value];
	}

	if (Array.isArray(value)) {
		let open = '';
		let close = '';

		for (const part of value) {
			// Only allow strings inside arrays so a malformed entry like `[['red']]` is rejected loudly rather than silently flattening.
			if (typeof part !== 'string') {
				throw new TypeError('Theme style values must be a string or an array of strings');
			}

			if (!Object.hasOwn(ansiStyles, part)) {
				throw new TypeError(`Unknown theme style: "${part}"`);
			}

			open += ansiStyles[part].open;
			// Close codes wrap in reverse so a single nested block unwinds correctly when one `theme` style is used on its own.
			close = ansiStyles[part].close + close;
		}

		return {open, close};
	}

	throw new TypeError('Theme style values must be a string or an array of strings');
};

// Build the per-instance prototype that carries a chalk instance's theme. Inheriting from the shared `proto` keeps every built-in style getter (and the `[GENERATOR]`-based level getter for builders) free; the theme getters are own properties so they win over inherited built-ins on name collision.
const createThemedProto = theme => {
	const themedProto = Object.create(proto);

	for (const [name, value] of Object.entries(theme)) {
		const resolved = resolveThemeStyle(value);

		Object.defineProperty(themedProto, name, {
			get() {
				const builder = createBuilder(this, createStyler(resolved.open, resolved.close, this[STYLER]), this[IS_EMPTY]);
				Object.defineProperty(this, name, {value: builder});
				return builder;
			},
		});
	}

	// `theme` is exposed on the chalk root as a non-writable value property; here we mirror it on the per-instance prototype so `themed.bold.theme` resolves to the same definition by walking back through `[GENERATOR]`.
	Object.defineProperty(themedProto, 'theme', {
		enumerable: true,
		configurable: true,
		get() {
			return (this[GENERATOR] ?? this).theme;
		},
	});

	return themedProto;
};

const applyStyle = (self, string) => {
	// Read the level directly off the generator to skip the `level` getter dispatch on this hot path
	if (self[GENERATOR][LEVEL] <= 0 || !string) {
		// eslint-disable-next-line unicorn/no-computed-property-existence-check -- Reads the boolean value, not a property existence check.
		return self[IS_EMPTY] ? '' : string;
	}

	let styler = self[STYLER];

	if (styler === undefined) {
		return string;
	}

	const {openAll, closeAll} = styler;
	if (string.includes('\u{1B}')) {
		while (styler !== undefined) {
			// Replace any instances already present with a re-opening code
			// otherwise only the part of the string until said closing code
			// will be colored, and the rest will simply be 'plain'.
			string = stringReplaceAll(string, styler.close, styler.open);

			styler = styler.parent;
		}
	}

	// We can move both next actions out of loop, because remaining actions in loop won't have
	// any/visible effect on parts we add here. Close the styling before a linebreak and reopen
	// after next line to fix a bleed issue on macOS: https://github.com/chalk/chalk/pull/92
	const lfIndex = string.indexOf('\n');
	if (lfIndex !== -1) {
		string = stringEncaseCRLFWithFirstIndex(string, closeAll, openAll, lfIndex);
	}

	return openAll + string + closeAll;
};

// `level` lives on the prototype rather than on each instance, so it costs nothing to construct an instance and matches how builders already expose it. It is inherited rather than own, so it does not show up in `Object.keys()`, same as for a builder.
// eslint-disable-next-line unicorn/no-top-level-side-effects -- The style getters must be installed at module load.
Object.defineProperties(createChalk.prototype, {...styles, level: levelDescriptor});

const chalk = createChalk();
export const chalkStderr = createChalk({level: stderrColor ? stderrColor.level : 0});

export {
	modifierNames,
	foregroundColorNames,
	backgroundColorNames,
	underlineColorNames,
	colorNames,

	// TODO: Remove these aliases in the next major version
	modifierNames as modifiers,
	foregroundColorNames as foregroundColors,
	backgroundColorNames as backgroundColors,
	colorNames as colors,
} from './vendor/ansi-styles/index.js';

export {
	stdoutColor as supportsColor,
	stderrColor as supportsColorStderr,
};

export default chalk;
