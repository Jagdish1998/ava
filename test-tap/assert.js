'use strict';
require('../lib/chalk').set();
require('../lib/worker/options').set({chalkOptions: {level: 0}});

const path = require('path');
const stripAnsi = require('strip-ansi');
const {test} = require('tap');
const assert = require('../lib/assert');
const snapshotManager = require('../lib/snapshot-manager');

let lastFailure = null;
let lastPassed = false;

const AssertionsBase = class extends assert.Assertions {
	constructor(overwrites = {}) {
		super({
			pass: () => {
				lastPassed = true;
			},
			pending: promise => {
				promise.then(() => {
					lastPassed = true;
				}, error => {
					lastFailure = error;
				});
			},
			fail: error => {
				lastFailure = error;
			},
			skip: () => {},
			experiments: {},
			...overwrites
		});
	}
};

const assertions = new AssertionsBase();

function assertFailure(t, subset) {
	if (!lastFailure) {
		t.fail('Expected assertion to fail');
		return;
	}

	t.is(lastFailure.assertion, subset.assertion);
	t.is(lastFailure.message, subset.message);
	t.is(lastFailure.name, 'AssertionError');
	t.is(lastFailure.operator, subset.operator);
	if (subset.raw) {
		t.is(lastFailure.raw.expected, subset.raw.expected);
		t.is(lastFailure.raw.actual, subset.raw.actual);
	}

	if (subset.statements) {
		t.is(lastFailure.statements.length, subset.statements.length);
		lastFailure.statements.forEach((s, i) => {
			t.is(s[0], subset.statements[i][0]);
			t.match(s[1], subset.statements[i][1]);
		});
	} else {
		t.same(lastFailure.statements, []);
	}

	if (subset.values) {
		t.is(lastFailure.values.length, subset.values.length);
		lastFailure.values.forEach((s, i) => {
			t.is(s.label, subset.values[i].label);
			t.match(stripAnsi(s.formatted), subset.values[i].formatted);
		});
	} else {
		t.same(lastFailure.values, []);
	}
}

let gathering = false;
let gatheringPromise = Promise.resolve();
function gather(run) {
	return t => {
		if (gathering) {
			throw new Error('Cannot nest gather()');
		}

		gathering = true;
		try {
			run(t);
			return gatheringPromise;
		} finally {
			gathering = false;
			gatheringPromise = Promise.resolve();
		}
	};
}

function add(fn) {
	if (!gathering) {
		throw new Error('Cannot add promise, must be called from gather() callback');
	}

	gatheringPromise = gatheringPromise.then(fn);
	return gatheringPromise;
}

function failsWith(t, fn, subset) {
	lastFailure = null;
	fn();
	assertFailure(t, subset);
}

function eventuallyFailsWith(t, fn, subset) {
	return add(() => {
		lastFailure = null;
		return fn().then(() => {
			assertFailure(t, subset);
		});
	});
}

function fails(t, fn) {
	lastFailure = null;
	fn();
	if (lastFailure) {
		t.pass();
	} else {
		t.fail('Expected assertion to fail');
	}
}

/* Might be useful
function eventuallyFails(t, fn) {
	return add(() => {
		lastFailure = null;
		return fn().then(() => {
			if (lastFailure) {
				t.pass();
			} else {
				t.fail('Expected assertion to fail');
			}
		});
	});
}
*/

function passes(t, fn) {
	lastPassed = false;
	lastFailure = null;
	fn();
	if (lastPassed) {
		t.pass();
	} else {
		t.ifError(lastFailure, 'Expected assertion to pass');
	}
}

function eventuallyPasses(t, fn) {
	return add(() => {
		lastPassed = false;
		lastFailure = null;
		return fn().then(() => {
			if (lastPassed) {
				t.pass();
			} else {
				t.ifError(lastFailure, 'Expected assertion to pass');
			}
		});
	});
}

test('.pass()', t => {
	passes(t, () => {
		assertions.pass();
	});

	passes(t, () => {
		const {pass} = assertions;
		pass();
	});

	t.end();
});

test('.fail()', t => {
	failsWith(t, () => {
		assertions.fail();
	}, {
		assertion: 'fail',
		message: 'Test failed via `t.fail()`'
	});

	failsWith(t, () => {
		assertions.fail('my message');
	}, {
		assertion: 'fail',
		message: 'my message'
	});

	failsWith(t, () => {
		const {fail} = assertions;
		fail();
	}, {
		assertion: 'fail',
		message: 'Test failed via `t.fail()`'
	});

	failsWith(t, () => {
		assertions.fail(null);
	}, {
		assertion: 'fail',
		improperUsage: true,
		message: 'The assertion message must be a string',
		values: [{
			label: 'Called with:',
			formatted: /null/
		}]
	});

	t.end();
});

test('.is()', t => {
	passes(t, () => {
		assertions.is('foo', 'foo');
	});

	passes(t, () => {
		const {is} = assertions;
		is('foo', 'foo');
	});

	passes(t, () => {
		assertions.is('', '');
	});

	passes(t, () => {
		assertions.is(true, true);
	});

	passes(t, () => {
		assertions.is(false, false);
	});

	passes(t, () => {
		assertions.is(null, null);
	});

	passes(t, () => {
		assertions.is(undefined, undefined);
	});

	passes(t, () => {
		assertions.is(1, 1);
	});

	passes(t, () => {
		assertions.is(0, 0);
	});

	passes(t, () => {
		assertions.is(-0, -0);
	});

	passes(t, () => {
		assertions.is(Number.NaN, Number.NaN);
	});

	passes(t, () => {
		assertions.is(0 / 0, Number.NaN);
	});

	passes(t, () => {
		const someRef = {foo: 'bar'};
		assertions.is(someRef, someRef);
	});

	fails(t, () => {
		assertions.is(0, -0);
	});

	fails(t, () => {
		assertions.is(0, false);
	});

	fails(t, () => {
		assertions.is('', false);
	});

	fails(t, () => {
		assertions.is('0', 0);
	});

	fails(t, () => {
		assertions.is('17', 17);
	});

	fails(t, () => {
		assertions.is([1, 2], '1,2');
	});

	fails(t, () => {
		// eslint-disable-next-line no-new-wrappers, unicorn/new-for-builtins
		assertions.is(new String('foo'), 'foo');
	});

	fails(t, () => {
		assertions.is(null, undefined);
	});

	fails(t, () => {
		assertions.is(null, false);
	});

	fails(t, () => {
		assertions.is(undefined, false);
	});

	fails(t, () => {
		// eslint-disable-next-line no-new-wrappers, unicorn/new-for-builtins
		assertions.is(new String('foo'), new String('foo'));
	});

	fails(t, () => {
		assertions.is(0, null);
	});

	fails(t, () => {
		assertions.is(0, Number.NaN);
	});

	fails(t, () => {
		assertions.is('foo', Number.NaN);
	});

	failsWith(t, () => {
		assertions.is({foo: 'bar'}, {foo: 'bar'});
	}, {
		assertion: 'is',
		message: '',
		actual: {foo: 'bar'},
		expected: {foo: 'bar'},
		values: [{
			label: 'Values are deeply equal to each other, but they are not the same:',
			formatted: /foo/
		}]
	});

	failsWith(t, () => {
		assertions.is('foo', 'bar');
	}, {
		assertion: 'is',
		message: '',
		raw: {actual: 'foo', expected: 'bar'},
		values: [
			{label: 'Difference:', formatted: /- 'foo'\n\+ 'bar'/}
		]
	});

	failsWith(t, () => {
		assertions.is('foo', 42);
	}, {
		actual: 'foo',
		assertion: 'is',
		expected: 42,
		message: '',
		values: [
			{label: 'Difference:', formatted: /- 'foo'\n\+ 42/}
		]
	});

	failsWith(t, () => {
		assertions.is('foo', 42, 'my message');
	}, {
		assertion: 'is',
		message: 'my message',
		values: [
			{label: 'Difference:', formatted: /- 'foo'\n\+ 42/}
		]
	});

	failsWith(t, () => {
		assertions.is(0, -0, 'my message');
	}, {
		assertion: 'is',
		message: 'my message',
		values: [
			{label: 'Difference:', formatted: /- 0\n\+ -0/}
		]
	});

	failsWith(t, () => {
		assertions.is(-0, 0, 'my message');
	}, {
		assertion: 'is',
		message: 'my message',
		values: [
			{label: 'Difference:', formatted: /- -0\n\+ 0/}
		]
	});

	failsWith(t, () => {
		assertions.is(0, 0, null);
	}, {
		assertion: 'is',
		improperUsage: true,
		message: 'The assertion message must be a string',
		values: [{
			label: 'Called with:',
			formatted: /null/
		}]
	});

	t.end();
});

test('.not()', t => {
	passes(t, () => {
		assertions.not('foo', 'bar');
	});

	passes(t, () => {
		const {not} = assertions;
		not('foo', 'bar');
	});

	fails(t, () => {
		assertions.not(Number.NaN, Number.NaN);
	});

	fails(t, () => {
		assertions.not(0 / 0, Number.NaN);
	});

	failsWith(t, () => {
		assertions.not('foo', 'foo');
	}, {
		assertion: 'not',
		message: '',
		raw: {actual: 'foo', expected: 'foo'},
		values: [{label: 'Value is the same as:', formatted: /foo/}]
	});

	failsWith(t, () => {
		assertions.not('foo', 'foo', 'my message');
	}, {
		assertion: 'not',
		message: 'my message',
		values: [{label: 'Value is the same as:', formatted: /foo/}]
	});

	failsWith(t, () => {
		assertions.not(0, 1, null);
	}, {
		assertion: 'not',
		improperUsage: true,
		message: 'The assertion message must be a string',
		values: [{
			label: 'Called with:',
			formatted: /null/
		}]
	});

	t.end();
});

test('.deepEqual()', t => {
	// Tests starting here are to detect regressions in the underlying libraries
	// used to test deep object equality

	fails(t, () => {
		assertions.deepEqual({a: false}, {a: 0});
	});

	passes(t, () => {
		assertions.deepEqual({
			a: 'a',
			b: 'b'
		}, {
			b: 'b',
			a: 'a'
		});
	});

	passes(t, () => {
		const {deepEqual} = assertions;
		deepEqual({a: 'a', b: 'b'}, {b: 'b', a: 'a'});
	});

	passes(t, () => {
		assertions.deepEqual({
			a: 'a',
			b: 'b',
			c: {
				d: 'd'
			}
		}, {
			c: {
				d: 'd'
			},
			b: 'b',
			a: 'a'
		});
	});

	fails(t, () => {
		assertions.deepEqual([1, 2, 3], [1, 2, 3, 4]);
	});

	passes(t, () => {
		assertions.deepEqual([1, 2, 3], [1, 2, 3]);
	});

	fails(t, () => {
		const fnA = a => a;
		const fnB = a => a;
		assertions.deepEqual(fnA, fnB);
	});

	passes(t, () => {
		const x1 = {z: 4};
		const y1 = {x: x1};
		x1.y = y1;

		const x2 = {z: 4};
		const y2 = {x: x2};
		x2.y = y2;

		assertions.deepEqual(x1, x2);
	});

	passes(t, () => {
		function Foo(a) {
			this.a = a;
		}

		const x = new Foo(1);
		const y = new Foo(1);

		assertions.deepEqual(x, y);
	});

	fails(t, () => {
		function Foo(a) {
			this.a = a;
		}

		function Bar(a) {
			this.a = a;
		}

		const x = new Foo(1);
		const y = new Bar(1);

		assertions.deepEqual(x, y);
	});

	fails(t, () => {
		assertions.deepEqual({
			a: 'a',
			b: 'b',
			c: {
				d: false
			}
		}, {
			c: {
				d: 0
			},
			b: 'b',
			a: 'a'
		});
	});

	fails(t, () => {
		assertions.deepEqual({}, []);
	});

	fails(t, () => {
		assertions.deepEqual({0: 'a', 1: 'b'}, ['a', 'b']);
	});

	fails(t, () => {
		assertions.deepEqual({a: 1}, {a: 1, b: undefined});
	});

	fails(t, () => {
		assertions.deepEqual(new Date('1972-08-01'), null);
	});

	fails(t, () => {
		assertions.deepEqual(new Date('1972-08-01'), undefined);
	});

	passes(t, () => {
		assertions.deepEqual(new Date('1972-08-01'), new Date('1972-08-01'));
	});

	passes(t, () => {
		assertions.deepEqual({x: new Date('1972-08-01')}, {x: new Date('1972-08-01')});
	});

	fails(t, () => {
		assertions.deepEqual(() => {}, () => {});
	});

	passes(t, () => {
		assertions.deepEqual(undefined, undefined);
		assertions.deepEqual({x: undefined}, {x: undefined});
		assertions.deepEqual({x: [undefined]}, {x: [undefined]});
	});

	passes(t, () => {
		assertions.deepEqual(null, null);
		assertions.deepEqual({x: null}, {x: null});
		assertions.deepEqual({x: [null]}, {x: [null]});
	});

	passes(t, () => {
		assertions.deepEqual(0, 0);
		assertions.deepEqual(1, 1);
		assertions.deepEqual(3.14, 3.14);
	});

	fails(t, () => {
		assertions.deepEqual(0, 1);
	});

	fails(t, () => {
		assertions.deepEqual(1, -1);
	});

	fails(t, () => {
		assertions.deepEqual(3.14, 2.72);
	});

	fails(t, () => {
		assertions.deepEqual({0: 'a', 1: 'b'}, ['a', 'b']);
	});

	passes(t, () => {
		assertions.deepEqual(
			[
				{foo: {z: 100, y: 200, x: 300}},
				'bar',
				11,
				{baz: {d: 4, a: 1, b: 2, c: 3}}
			],
			[
				{foo: {x: 300, y: 200, z: 100}},
				'bar',
				11,
				{baz: {c: 3, b: 2, a: 1, d: 4}}
			]
		);
	});

	passes(t, () => {
		assertions.deepEqual(
			{x: {a: 1, b: 2}, y: {c: 3, d: 4}},
			{y: {d: 4, c: 3}, x: {b: 2, a: 1}}
		);
	});

	// Regression test end here

	passes(t, () => {
		assertions.deepEqual({a: 'a'}, {a: 'a'});
	});

	passes(t, () => {
		assertions.deepEqual(['a', 'b'], ['a', 'b']);
	});

	fails(t, () => {
		assertions.deepEqual({a: 'a'}, {a: 'b'});
	});

	fails(t, () => {
		assertions.deepEqual(['a', 'b'], ['a', 'a']);
	});

	fails(t, () => {
		assertions.deepEqual([['a', 'b'], 'c'], [['a', 'b'], 'd']);
	});

	fails(t, () => {
		const circular = ['a', 'b'];
		circular.push(circular);
		assertions.deepEqual([circular, 'c'], [circular, 'd']);
	});

	failsWith(t, () => {
		assertions.deepEqual('foo', 'bar');
	}, {
		assertion: 'deepEqual',
		message: '',
		raw: {actual: 'foo', expected: 'bar'},
		values: [{label: 'Difference:', formatted: /- 'foo'\n\+ 'bar'/}]
	});

	failsWith(t, () => {
		assertions.deepEqual('foo', 42);
	}, {
		assertion: 'deepEqual',
		message: '',
		raw: {actual: 'foo', expected: 42},
		values: [{label: 'Difference:', formatted: /- 'foo'\n\+ 42/}]
	});

	failsWith(t, () => {
		assertions.deepEqual('foo', 42, 'my message');
	}, {
		assertion: 'deepEqual',
		message: 'my message',
		values: [{label: 'Difference:', formatted: /- 'foo'\n\+ 42/}]
	});

	failsWith(t, () => {
		assertions.deepEqual({}, {}, null);
	}, {
		assertion: 'deepEqual',
		improperUsage: true,
		message: 'The assertion message must be a string',
		values: [{
			label: 'Called with:',
			formatted: /null/
		}]
	});

	t.end();
});

test('.notDeepEqual()', t => {
	passes(t, () => {
		assertions.notDeepEqual({a: 'a'}, {a: 'b'});
	});

	passes(t, () => {
		const {notDeepEqual} = assertions;
		notDeepEqual({a: 'a'}, {a: 'b'});
	});

	passes(t, () => {
		assertions.notDeepEqual(['a', 'b'], ['c', 'd']);
	});

	const actual = {a: 'a'};
	const expected = {a: 'a'};
	failsWith(t, () => {
		assertions.notDeepEqual(actual, expected);
	}, {
		actual,
		assertion: 'notDeepEqual',
		expected,
		message: '',
		raw: {actual, expected},
		values: [{label: 'Value is deeply equal:', formatted: /.*{.*\n.*a: 'a'/}]
	});

	failsWith(t, () => {
		assertions.notDeepEqual(['a', 'b'], ['a', 'b'], 'my message');
	}, {
		assertion: 'notDeepEqual',
		message: 'my message',
		values: [{label: 'Value is deeply equal:', formatted: /.*\[.*\n.*'a',\n.*'b',/}]
	});

	failsWith(t, () => {
		assertions.notDeepEqual({}, [], null);
	}, {
		assertion: 'notDeepEqual',
		improperUsage: true,
		message: 'The assertion message must be a string',
		values: [{
			label: 'Called with:',
			formatted: /null/
		}]
	});

	t.end();
});

test('.like()', t => {
	fails(t, () => {
		assertions.like({a: false}, {a: 0});
	});

	passes(t, () => {
		assertions.like({
			a: 'a',
			b: 'b'
		}, {
			b: 'b',
			a: 'a'
		});
	});

	passes(t, () => {
		const {like} = assertions;
		like({a: 'a', b: 'b'}, {b: 'b', a: 'a'});
	});

	passes(t, () => {
		assertions.like({
			a: 'a',
			b: 'b',
			c: {
				d: 'd',
				x: 'x'
			},
			x: 'x'
		}, {
			c: {
				d: 'd'
			},
			b: 'b',
			a: 'a'
		});
	});

	fails(t, () => {
		assertions.like([1, 2, 3], [1, 2, 3, 4]);
	});

	fails(t, () => {
		assertions.like({
			a: [1, 2, 3]
		}, {
			a: [1, 2, 3, 4]
		});
	});

	passes(t, () => {
		assertions.like({
			a: [1, 2, 3],
			x: 'x'
		}, {
			a: [1, 2, 3]
		});
	});

	passes(t, () => {
		const actual = {
			a: 'a',
			extra: 'irrelevant'
		};
		actual.circular = actual;

		const likePattern = {
			a: 'a'
		};

		assertions.like(actual, likePattern);
	});

	fails(t, () => {
		const fnA = a => a;
		const fnB = a => a;
		assertions.like(fnA, fnB);
	});

	fails(t, () => {
		const fnA = a => a;
		const fnB = a => a;
		assertions.like({
			fn: fnA
		}, {
			fn: fnB
		});
	});

	fails(t, () => {
		function Foo(a) {
			this.a = a;
		}

		function Bar(a) {
			this.a = a;
		}

		const x = new Foo(1);
		const y = new Bar(1);

		assertions.like(x, y);
	});

	passes(t, () => {
		assertions.like({a: 'a'}, {a: 'a'});
	});

	passes(t, () => {
		assertions.like({a: 'a', b: 'b'}, {a: 'a'});
	});

	passes(t, () => {
		assertions.like({ab: ['a', 'b']}, {ab: ['a', 'b']});
	});

	passes(t, () => {
		assertions.like({ab: ['a', 'b'], c: 'c'}, {ab: ['a', 'b']});
	});

	fails(t, () => {
		assertions.like({a: 'a'}, {a: 'b'});
	});

	fails(t, () => {
		assertions.like({a: 'a', b: 'b'}, {a: 'b'});
	});

	fails(t, () => {
		assertions.like({ab: ['a', 'b']}, {ab: ['a', 'a']});
	});

	fails(t, () => {
		assertions.like({ab: ['a', 'b'], c: 'c'}, {ab: ['a', 'a']});
	});

	fails(t, () => {
		assertions.like([['a', 'b'], 'c'], [['a', 'b'], 'd']);
	});

	fails(t, () => {
		const circular = ['a', 'b'];
		circular.push(circular);
		assertions.like([circular, 'c'], [circular, 'd']);
	});

	fails(t, () => {
		const circular = ['a', 'b'];
		circular.push(circular);
		assertions.like({xc: [circular, 'c']}, {xc: [circular, 'd']});
	});

	failsWith(t, () => {
		assertions.like({a: 'a'}, {});
	}, {
		assertion: 'like',
		message: '`t.like()` selector must be a non-empty object',
		values: [{label: 'Called with:', formatted: '{}'}]
	});

	failsWith(t, () => {
		assertions.like('foo', 'bar');
	}, {
		assertion: 'like',
		message: '`t.like()` selector must be a non-empty object',
		values: [{label: 'Called with:', formatted: '\'bar\''}]
	});

	failsWith(t, () => {
		const likePattern = {
			a: 'a'
		};
		likePattern.circular = likePattern;

		assertions.like({}, likePattern);
	}, {
		assertion: 'like',
		message: '`t.like()` selector must not contain circular references',
		values: [{label: 'Called with:', formatted: '{\n  a: \'a\',\n  circular: [Circular],\n}'}]
	});

	failsWith(t, () => {
		assertions.like({}, {}, null);
	}, {
		assertion: 'like',
		improperUsage: true,
		message: 'The assertion message must be a string',
		values: [{
			label: 'Called with:',
			formatted: /null/
		}]
	});

	failsWith(t, () => {
		assertions.like({a: 'foo', b: 'irrelevant'}, {a: 'bar'});
	}, {
		assertion: 'like',
		message: '',
		values: [{label: 'Difference:', formatted: /{\n-\s*a: 'foo',\n\+\s*a: 'bar',\n\s*}/}]
	});

	t.end();
});

test('.throws()', gather(t => {
	// Fails because function doesn't throw.
	failsWith(t, () => {
		assertions.throws(() => {});
	}, {
		assertion: 'throws',
		message: '',
		values: [{label: 'Function returned:', formatted: /undefined/}]
	});

	failsWith(t, () => {
		const {throws} = assertions;
		throws(() => {});
	}, {
		assertion: 'throws',
		message: '',
		values: [{label: 'Function returned:', formatted: /undefined/}]
	});

	// Fails because function doesn't throw. Asserts that 'my message' is used
	// as the assertion message (*not* compared against the error).
	failsWith(t, () => {
		assertions.throws(() => {}, undefined, 'my message');
	}, {
		assertion: 'throws',
		message: 'my message',
		values: [{label: 'Function returned:', formatted: /undefined/}]
	});

	// Fails because the function returned a promise.
	failsWith(t, () => {
		assertions.throws(() => Promise.resolve());
	}, {
		assertion: 'throws',
		message: '',
		values: [{label: 'Function returned a promise. Use `t.throwsAsync()` instead:', formatted: /Promise/}]
	});

	// Fails because thrown exception is not an error
	failsWith(t, () => {
		assertions.throws(() => {
			const err = 'foo';
			throw err;
		});
	}, {
		assertion: 'throws',
		message: '',
		values: [
			{label: 'Function threw exception that is not an error:', formatted: /'foo'/}
		]
	});

	// Passes because an error is thrown.
	passes(t, () => {
		assertions.throws(() => {
			throw new Error('foo');
		});
	});

	// Passes because the correct error is thrown.
	passes(t, () => {
		const err = new Error('foo');
		assertions.throws(() => {
			throw err;
		}, {is: err});
	});

	// Fails because the thrown value is not an error
	fails(t, () => {
		const object = {};
		assertions.throws(() => {
			throw object;
		}, {is: object});
	});

	// Fails because the thrown value is not the right one
	fails(t, () => {
		const err = new Error('foo');
		assertions.throws(() => {
			throw err;
		}, {is: {}});
	});

	// Passes because the correct error is thrown.
	passes(t, () => {
		assertions.throws(() => {
			throw new TypeError();
		}, {name: 'TypeError'});
	});

	// Fails because the thrown value is not an error
	fails(t, () => {
		assertions.throws(() => {
			const err = {name: 'Bob'};
			throw err;
		}, {name: 'Bob'});
	});

	// Fails because the thrown value is not the right one
	fails(t, () => {
		assertions.throws(() => {
			throw new Error('foo');
		}, {name: 'TypeError'});
	});

	// Passes because the correct error is thrown.
	passes(t, () => {
		assertions.throws(() => {
			const err = new TypeError();
			err.code = 'ERR_TEST';
			throw err;
		}, {code: 'ERR_TEST'});
	});

	// Passes because the correct error is thrown.
	passes(t, () => {
		assertions.throws(() => {
			const err = new TypeError();
			err.code = 42;
			throw err;
		}, {code: 42});
	});

	// Fails because the thrown value is not the right one
	fails(t, () => {
		assertions.throws(() => {
			const err = new TypeError();
			err.code = 'ERR_NOPE';
			throw err;
		}, {code: 'ERR_TEST'});
	});

	fails(t, () => {
		assertions.throws(() => {
			const err = new TypeError();
			err.code = 1;
			throw err;
		}, {code: 42});
	});

	// Regression test for https://github.com/avajs/ava/issues/1676
	fails(t, () => {
		assertions.throws(() => {
			throw new Error('foo');
		}, false);
	});

	passes(t, () => {
		assertions.throws(() => {
			throw new Error('foo');
		}, undefined);
	});

	passes(t, async () => {
		await assertions.throwsAsync(() => {
			return Promise.reject(new Error('foo'));
		}, undefined);
	});

	failsWith(t, () => {
		assertions.throws(() => {}, undefined, null);
	}, {
		assertion: 'throws',
		improperUsage: true,
		message: 'The assertion message must be a string',
		values: [{
			label: 'Called with:',
			formatted: /null/
		}]
	});
}));

test('.throws() returns the thrown error', t => {
	const expected = new Error();
	const actual = assertions.throws(() => {
		throw expected;
	});

	t.is(actual, expected);

	t.end();
});

test('.throwsAsync()', gather(t => {
	// Fails because the promise is resolved, not rejected.
	eventuallyFailsWith(t, () => assertions.throwsAsync(Promise.resolve('foo')), {
		assertion: 'throwsAsync',
		message: '',
		values: [{label: 'Promise resolved with:', formatted: /'foo'/}]
	});

	eventuallyFailsWith(t, () => {
		const {throwsAsync} = assertions;
		return throwsAsync(Promise.resolve('foo'));
	}, {
		assertion: 'throwsAsync',
		message: '',
		values: [{label: 'Promise resolved with:', formatted: /'foo'/}]
	});

	// Fails because the promise is resolved with an Error
	eventuallyFailsWith(t, () => assertions.throwsAsync(Promise.resolve(new Error())), {
		assertion: 'throwsAsync',
		message: '',
		values: [{label: 'Promise resolved with:', formatted: /Error/}]
	});

	// Fails because the function returned a promise that resolved, not rejected.
	eventuallyFailsWith(t, () => assertions.throwsAsync(() => Promise.resolve('foo')), {
		assertion: 'throwsAsync',
		message: '',
		values: [{label: 'Returned promise resolved with:', formatted: /'foo'/}]
	});

	// Passes because the promise was rejected with an error.
	eventuallyPasses(t, () => assertions.throwsAsync(Promise.reject(new Error())));

	// Passes because the function returned a promise rejected with an error.
	eventuallyPasses(t, () => assertions.throwsAsync(() => Promise.reject(new Error())));

	// Fails because the function throws synchronously
	eventuallyFailsWith(t, () => assertions.throwsAsync(() => {
		throw new Error('sync');
	}, undefined, 'message'), {
		assertion: 'throwsAsync',
		message: 'message',
		values: [
			{label: 'Function threw synchronously. Use `t.throws()` instead:', formatted: /Error/}
		]
	});

	// Fails because the function did not return a promise
	eventuallyFailsWith(t, () => assertions.throwsAsync(() => {}, undefined, 'message'), {
		assertion: 'throwsAsync',
		message: 'message',
		values: [
			{label: 'Function returned:', formatted: /undefined/}
		]
	});

	eventuallyFailsWith(t, () => assertions.throwsAsync(Promise.resolve(), undefined, null), {
		assertion: 'throwsAsync',
		improperUsage: true,
		message: 'The assertion message must be a string',
		values: [{
			label: 'Called with:',
			formatted: /null/
		}]
	});
}));

test('.throwsAsync() returns the rejection reason of promise', t => {
	const expected = new Error();

	return assertions.throwsAsync(Promise.reject(expected)).then(actual => {
		t.is(actual, expected);
		t.end();
	});
});

test('.throwsAsync() returns the rejection reason of a promise returned by the function', t => {
	const expected = new Error();

	return assertions.throwsAsync(() => {
		return Promise.reject(expected);
	}).then(actual => {
		t.is(actual, expected);
		t.end();
	});
});

test('.throws() fails if passed a bad value', t => {
	failsWith(t, () => {
		assertions.throws('not a function');
	}, {
		assertion: 'throws',
		message: '`t.throws()` must be called with a function',
		values: [{label: 'Called with:', formatted: /not a function/}]
	});

	t.end();
});

test('.throwsAsync() fails if passed a bad value', t => {
	failsWith(t, () => {
		assertions.throwsAsync('not a function');
	}, {
		assertion: 'throwsAsync',
		message: '`t.throwsAsync()` must be called with a function or promise',
		values: [{label: 'Called with:', formatted: /not a function/}]
	});

	t.end();
});

test('.throws() fails if passed a bad expectation', t => {
	failsWith(t, () => {
		assertions.throws(() => {}, true);
	}, {
		assertion: 'throws',
		message: 'The second argument to `t.throws()` must be an expectation object, `null` or `undefined`',
		values: [{label: 'Called with:', formatted: /true/}]
	});

	failsWith(t, () => {
		assertions.throws(() => {}, 'foo');
	}, {
		assertion: 'throws',
		message: 'The second argument to `t.throws()` must be an expectation object, `null` or `undefined`',
		values: [{label: 'Called with:', formatted: /foo/}]
	});

	failsWith(t, () => {
		assertions.throws(() => {}, /baz/);
	}, {
		assertion: 'throws',
		message: 'The second argument to `t.throws()` must be an expectation object, `null` or `undefined`',
		values: [{label: 'Called with:', formatted: /baz/}]
	});

	failsWith(t, () => {
		assertions.throws(() => {}, class Bar {});
	}, {
		assertion: 'throws',
		message: 'The second argument to `t.throws()` must be an expectation object, `null` or `undefined`',
		values: [{label: 'Called with:', formatted: /Bar/}]
	});

	failsWith(t, () => {
		assertions.throws(() => {}, {});
	}, {
		assertion: 'throws',
		message: 'The second argument to `t.throws()` must be an expectation object, `null` or `undefined`',
		values: [{label: 'Called with:', formatted: /{}/}]
	});

	failsWith(t, () => {
		assertions.throws(() => {}, []);
	}, {
		assertion: 'throws',
		message: 'The second argument to `t.throws()` must be an expectation object, `null` or `undefined`',
		values: [{label: 'Called with:', formatted: /\[]/}]
	});

	failsWith(t, () => {
		assertions.throws(() => {}, {code: {}});
	}, {
		assertion: 'throws',
		message: 'The `code` property of the second argument to `t.throws()` must be a string or number',
		values: [{label: 'Called with:', formatted: /code: {}/}]
	});

	failsWith(t, () => {
		assertions.throws(() => {}, {instanceOf: null});
	}, {
		assertion: 'throws',
		message: 'The `instanceOf` property of the second argument to `t.throws()` must be a function',
		values: [{label: 'Called with:', formatted: /instanceOf: null/}]
	});

	failsWith(t, () => {
		assertions.throws(() => {}, {message: null});
	}, {
		assertion: 'throws',
		message: 'The `message` property of the second argument to `t.throws()` must be a string or regular expression',
		values: [{label: 'Called with:', formatted: /message: null/}]
	});

	failsWith(t, () => {
		assertions.throws(() => {}, {name: null});
	}, {
		assertion: 'throws',
		message: 'The `name` property of the second argument to `t.throws()` must be a string',
		values: [{label: 'Called with:', formatted: /name: null/}]
	});

	failsWith(t, () => {
		assertions.throws(() => {}, {is: {}, message: '', name: '', of() {}, foo: null});
	}, {
		assertion: 'throws',
		message: 'The second argument to `t.throws()` contains unexpected properties',
		values: [{label: 'Called with:', formatted: /foo: null/}]
	});

	t.end();
});

test('.throwsAsync() fails if passed a bad expectation', t => {
	failsWith(t, () => {
		assertions.throwsAsync(() => {}, true);
	}, {
		assertion: 'throwsAsync',
		message: 'The second argument to `t.throwsAsync()` must be an expectation object, `null` or `undefined`',
		values: [{label: 'Called with:', formatted: /true/}]
	});

	failsWith(t, () => {
		assertions.throwsAsync(() => {}, 'foo');
	}, {
		assertion: 'throwsAsync',
		message: 'The second argument to `t.throwsAsync()` must be an expectation object, `null` or `undefined`',
		values: [{label: 'Called with:', formatted: /foo/}]
	});

	failsWith(t, () => {
		assertions.throwsAsync(() => {}, /baz/);
	}, {
		assertion: 'throwsAsync',
		message: 'The second argument to `t.throwsAsync()` must be an expectation object, `null` or `undefined`',
		values: [{label: 'Called with:', formatted: /baz/}]
	});

	failsWith(t, () => {
		assertions.throwsAsync(() => {}, class Bar {});
	}, {
		assertion: 'throwsAsync',
		message: 'The second argument to `t.throwsAsync()` must be an expectation object, `null` or `undefined`',
		values: [{label: 'Called with:', formatted: /Bar/}]
	});

	failsWith(t, () => {
		assertions.throwsAsync(() => {}, {});
	}, {
		assertion: 'throwsAsync',
		message: 'The second argument to `t.throwsAsync()` must be an expectation object, `null` or `undefined`',
		values: [{label: 'Called with:', formatted: /{}/}]
	});

	failsWith(t, () => {
		assertions.throwsAsync(() => {}, []);
	}, {
		assertion: 'throwsAsync',
		message: 'The second argument to `t.throwsAsync()` must be an expectation object, `null` or `undefined`',
		values: [{label: 'Called with:', formatted: /\[]/}]
	});

	failsWith(t, () => {
		assertions.throwsAsync(() => {}, {code: {}});
	}, {
		assertion: 'throwsAsync',
		message: 'The `code` property of the second argument to `t.throwsAsync()` must be a string or number',
		values: [{label: 'Called with:', formatted: /code: {}/}]
	});

	failsWith(t, () => {
		assertions.throwsAsync(() => {}, {instanceOf: null});
	}, {
		assertion: 'throwsAsync',
		message: 'The `instanceOf` property of the second argument to `t.throwsAsync()` must be a function',
		values: [{label: 'Called with:', formatted: /instanceOf: null/}]
	});

	failsWith(t, () => {
		assertions.throwsAsync(() => {}, {message: null});
	}, {
		assertion: 'throwsAsync',
		message: 'The `message` property of the second argument to `t.throwsAsync()` must be a string or regular expression',
		values: [{label: 'Called with:', formatted: /message: null/}]
	});

	failsWith(t, () => {
		assertions.throwsAsync(() => {}, {name: null});
	}, {
		assertion: 'throwsAsync',
		message: 'The `name` property of the second argument to `t.throwsAsync()` must be a string',
		values: [{label: 'Called with:', formatted: /name: null/}]
	});

	failsWith(t, () => {
		assertions.throwsAsync(() => {}, {is: {}, message: '', name: '', of() {}, foo: null});
	}, {
		assertion: 'throwsAsync',
		message: 'The second argument to `t.throwsAsync()` contains unexpected properties',
		values: [{label: 'Called with:', formatted: /foo: null/}]
	});

	t.end();
});

test('.throws() fails if passed null expectation', t => {
	const asserter = new AssertionsBase();

	failsWith(t, () => {
		asserter.throws(() => {}, null);
	}, {
		assertion: 'throws',
		message: 'The second argument to `t.throws()` must be an expectation object or `undefined`',
		values: [{label: 'Called with:', formatted: /null/}]
	});

	t.end();
});

test('.throwsAsync() fails if passed null', t => {
	const asserter = new AssertionsBase();

	failsWith(t, () => {
		asserter.throwsAsync(() => {}, null);
	}, {
		assertion: 'throwsAsync',
		message: 'The second argument to `t.throwsAsync()` must be an expectation object or `undefined`',
		values: [{label: 'Called with:', formatted: /null/}]
	});

	t.end();
});

test('.notThrows()', gather(t => {
	// Passes because the function doesn't throw
	passes(t, () => {
		assertions.notThrows(() => {});
	});

	passes(t, () => {
		const {notThrows} = assertions;
		notThrows(() => {});
	});

	// Fails because the function throws.
	failsWith(t, () => {
		assertions.notThrows(() => {
			throw new Error('foo');
		});
	}, {
		assertion: 'notThrows',
		message: '',
		values: [{label: 'Function threw:', formatted: /foo/}]
	});

	// Fails because the function throws. Asserts that message is used for the
	// assertion, not to validate the thrown error.
	failsWith(t, () => {
		assertions.notThrows(() => {
			throw new Error('foo');
		}, 'my message');
	}, {
		assertion: 'notThrows',
		message: 'my message',
		values: [{label: 'Function threw:', formatted: /foo/}]
	});

	failsWith(t, () => {
		assertions.notThrows(() => {}, null);
	}, {
		assertion: 'notThrows',
		improperUsage: true,
		message: 'The assertion message must be a string',
		values: [{
			label: 'Called with:',
			formatted: /null/
		}]
	});
}));

test('.notThrowsAsync()', gather(t => {
	// Passes because the promise is resolved
	eventuallyPasses(t, () => assertions.notThrowsAsync(Promise.resolve()));

	eventuallyPasses(t, () => {
		const {notThrowsAsync} = assertions;
		return notThrowsAsync(Promise.resolve());
	});

	// Fails because the promise is rejected
	eventuallyFailsWith(t, () => assertions.notThrowsAsync(Promise.reject(new Error())), {
		assertion: 'notThrowsAsync',
		message: '',
		values: [{label: 'Promise rejected with:', formatted: /Error/}]
	});

	// Passes because the function returned a resolved promise
	eventuallyPasses(t, () => assertions.notThrowsAsync(() => Promise.resolve()));

	// Fails because the function returned a rejected promise
	eventuallyFailsWith(t, () => assertions.notThrowsAsync(() => Promise.reject(new Error())), {
		assertion: 'notThrowsAsync',
		message: '',
		values: [{label: 'Returned promise rejected with:', formatted: /Error/}]
	});

	// Fails because the function throws synchronously
	eventuallyFailsWith(t, () => assertions.notThrowsAsync(() => {
		throw new Error('sync');
	}, 'message'), {
		assertion: 'notThrowsAsync',
		message: 'message',
		values: [
			{label: 'Function threw:', formatted: /Error/}
		]
	});

	// Fails because the function did not return a promise
	eventuallyFailsWith(t, () => assertions.notThrowsAsync(() => {}, 'message'), {
		assertion: 'notThrowsAsync',
		message: 'message',
		values: [
			{label: 'Function did not return a promise. Use `t.notThrows()` instead:', formatted: /undefined/}
		]
	});

	eventuallyFailsWith(t, () => assertions.notThrowsAsync(Promise.resolve(), null), {
		assertion: 'notThrowsAsync',
		improperUsage: true,
		message: 'The assertion message must be a string',
		values: [{
			label: 'Called with:',
			formatted: /null/
		}]
	});
}));

test('.notThrowsAsync() returns undefined for a fulfilled promise', t => {
	return assertions.notThrowsAsync(Promise.resolve(Symbol(''))).then(actual => {
		t.is(actual, undefined);
	});
});

test('.notThrowsAsync() returns undefined for a fulfilled promise returned by the function', t => {
	return assertions.notThrowsAsync(() => {
		return Promise.resolve(Symbol(''));
	}).then(actual => {
		t.is(actual, undefined);
	});
});

test('.notThrows() fails if passed a bad value', t => {
	failsWith(t, () => {
		assertions.notThrows('not a function');
	}, {
		assertion: 'notThrows',
		message: '`t.notThrows()` must be called with a function',
		values: [{label: 'Called with:', formatted: /not a function/}]
	});

	t.end();
});

test('.notThrowsAsync() fails if passed a bad value', t => {
	failsWith(t, () => {
		assertions.notThrowsAsync('not a function');
	}, {
		assertion: 'notThrowsAsync',
		message: '`t.notThrowsAsync()` must be called with a function or promise',
		values: [{label: 'Called with:', formatted: /not a function/}]
	});

	t.end();
});

test('.snapshot()', t => {
	// Set to `true` to update the snapshot, then run:
	// npx tap test-tap/assert.js
	//
	// Ignore errors and make sure not to run tests with the `-b` (bail) option.
	const updating = false;

	const projectDir = path.join(__dirname, 'fixture');
	const manager = snapshotManager.load({
		file: path.join(projectDir, 'assert.js'),
		projectDir,
		fixedLocation: null,
		recordNewSnapshots: updating,
		updating
	});
	const setup = _title => {
		return new class extends assertions.constructor {
			constructor(title) {
				super({
					compareWithSnapshot: assertionOptions => {
						const {record, ...result} = manager.compare({
							belongsTo: assertionOptions.id || this.title,
							expected: assertionOptions.expected,
							index: assertionOptions.id ? 0 : this.snapshotInvocationCount++,
							label: assertionOptions.id ? '' : assertionOptions.message || `Snapshot ${this.snapshotInvocationCount}`
						});
						if (record) {
							record();
						}

						return result;
					}
				});
				this.title = title;
				this.snapshotInvocationCount = 0;
			}
		}(_title);
	};

	{
		const assertions = setup('passes');

		passes(t, () => {
			assertions.snapshot({foo: 'bar'});
		});

		passes(t, () => {
			const {snapshot} = assertions;
			snapshot({foo: 'bar'});
		});

		passes(t, () => {
			assertions.snapshot({foo: 'bar'}, {id: 'fixed id'}, 'message not included in snapshot report');
		});
	}

	{
		const assertions = setup('fails');
		if (updating) {
			assertions.snapshot({foo: 'bar'});
		} else {
			failsWith(t, () => {
				assertions.snapshot({foo: 'not bar'});
			}, {
				assertion: 'snapshot',
				message: 'Did not match snapshot',
				values: [{label: 'Difference:', formatted: '  {\n-   foo: \'not bar\',\n+   foo: \'bar\',\n  }'}]
			});
		}
	}

	failsWith(t, () => {
		const assertions = setup('fails (fixed id)');
		assertions.snapshot({foo: 'not bar'}, {id: 'fixed id'}, 'different message, also not included in snapshot report');
	}, {
		assertion: 'snapshot',
		message: 'different message, also not included in snapshot report',
		values: [{label: 'Difference:', formatted: '  {\n-   foo: \'not bar\',\n+   foo: \'bar\',\n  }'}]
	});

	{
		const assertions = setup('fails');
		if (updating) {
			assertions.snapshot({foo: 'bar'}, 'my message');
		} else {
			failsWith(t, () => {
				assertions.snapshot({foo: 'not bar'}, 'my message');
			}, {
				assertion: 'snapshot',
				message: 'my message',
				values: [{label: 'Difference:', formatted: '  {\n-   foo: \'not bar\',\n+   foo: \'bar\',\n  }'}]
			});
		}
	}

	{
		const assertions = setup('bad message');
		failsWith(t, () => {
			assertions.snapshot(null, null, null);
		}, {
			assertion: 'snapshot',
			improperUsage: true,
			message: 'The assertion message must be a string',
			values: [{
				label: 'Called with:',
				formatted: /null/
			}]
		});
	}

	manager.save();
	t.end();
});

test('.truthy()', t => {
	failsWith(t, () => {
		assertions.truthy(0);
	}, {
		assertion: 'truthy',
		message: '',
		operator: '!!',
		values: [{label: 'Value is not truthy:', formatted: /0/}]
	});

	failsWith(t, () => {
		assertions.truthy(false, 'my message');
	}, {
		assertion: 'truthy',
		message: 'my message',
		operator: '!!',
		values: [{label: 'Value is not truthy:', formatted: /false/}]
	});

	passes(t, () => {
		assertions.truthy(1);
		assertions.truthy(true);
	});

	passes(t, () => {
		const {truthy} = assertions;
		truthy(1);
		truthy(true);
	});

	failsWith(t, () => {
		assertions.truthy(true, null);
	}, {
		assertion: 'truthy',
		improperUsage: true,
		message: 'The assertion message must be a string',
		values: [{
			label: 'Called with:',
			formatted: /null/
		}]
	});

	t.end();
});

test('.falsy()', t => {
	failsWith(t, () => {
		assertions.falsy(1);
	}, {
		assertion: 'falsy',
		message: '',
		operator: '!',
		values: [{label: 'Value is not falsy:', formatted: /1/}]
	});

	failsWith(t, () => {
		assertions.falsy(true, 'my message');
	}, {
		assertion: 'falsy',
		message: 'my message',
		operator: '!',
		values: [{label: 'Value is not falsy:', formatted: /true/}]
	});

	passes(t, () => {
		assertions.falsy(0);
		assertions.falsy(false);
	});

	passes(t, () => {
		const {falsy} = assertions;
		falsy(0);
		falsy(false);
	});

	failsWith(t, () => {
		assertions.falsy(false, null);
	}, {
		assertion: 'falsy',
		improperUsage: true,
		message: 'The assertion message must be a string',
		values: [{
			label: 'Called with:',
			formatted: /null/
		}]
	});

	t.end();
});

test('.true()', t => {
	failsWith(t, () => {
		assertions.true(1);
	}, {
		assertion: 'true',
		message: '',
		values: [{label: 'Value is not `true`:', formatted: /1/}]
	});

	failsWith(t, () => {
		assertions.true(0);
	}, {
		assertion: 'true',
		message: '',
		values: [{label: 'Value is not `true`:', formatted: /0/}]
	});

	failsWith(t, () => {
		assertions.true(false);
	}, {
		assertion: 'true',
		message: '',
		values: [{label: 'Value is not `true`:', formatted: /false/}]
	});

	failsWith(t, () => {
		assertions.true('foo', 'my message');
	}, {
		assertion: 'true',
		message: 'my message',
		values: [{label: 'Value is not `true`:', formatted: /foo/}]
	});

	passes(t, () => {
		assertions.true(true);
	});

	passes(t, () => {
		const {true: trueFn} = assertions;
		trueFn(true);
	});

	failsWith(t, () => {
		assertions.true(true, null);
	}, {
		assertion: 'true',
		improperUsage: true,
		message: 'The assertion message must be a string',
		values: [{
			label: 'Called with:',
			formatted: /null/
		}]
	});

	t.end();
});

test('.false()', t => {
	failsWith(t, () => {
		assertions.false(0);
	}, {
		assertion: 'false',
		message: '',
		values: [{label: 'Value is not `false`:', formatted: /0/}]
	});

	failsWith(t, () => {
		assertions.false(1);
	}, {
		assertion: 'false',
		message: '',
		values: [{label: 'Value is not `false`:', formatted: /1/}]
	});

	failsWith(t, () => {
		assertions.false(true);
	}, {
		assertion: 'false',
		message: '',
		values: [{label: 'Value is not `false`:', formatted: /true/}]
	});

	failsWith(t, () => {
		assertions.false('foo', 'my message');
	}, {
		assertion: 'false',
		message: 'my message',
		values: [{label: 'Value is not `false`:', formatted: /foo/}]
	});

	passes(t, () => {
		assertions.false(false);
	});

	passes(t, () => {
		const {false: falseFn} = assertions;
		falseFn(false);
	});

	failsWith(t, () => {
		assertions.false(false, null);
	}, {
		assertion: 'false',
		improperUsage: true,
		message: 'The assertion message must be a string',
		values: [{
			label: 'Called with:',
			formatted: /null/
		}]
	});

	t.end();
});

test('.regex()', t => {
	passes(t, () => {
		assertions.regex('abc', /^abc$/);
	});

	passes(t, () => {
		const {regex} = assertions;
		regex('abc', /^abc$/);
	});

	failsWith(t, () => {
		assertions.regex('foo', /^abc$/);
	}, {
		assertion: 'regex',
		message: '',
		values: [
			{label: 'Value must match expression:', formatted: /foo/},
			{label: 'Regular expression:', formatted: /\/\^abc\$\//}
		]
	});

	failsWith(t, () => {
		assertions.regex('foo', /^abc$/, 'my message');
	}, {
		assertion: 'regex',
		message: 'my message',
		values: [
			{label: 'Value must match expression:', formatted: /foo/},
			{label: 'Regular expression:', formatted: /\/\^abc\$\//}
		]
	});

	failsWith(t, () => {
		assertions.regex('foo', /^abc$/, null);
	}, {
		assertion: 'regex',
		improperUsage: true,
		message: 'The assertion message must be a string',
		values: [{
			label: 'Called with:',
			formatted: /null/
		}]
	});

	t.end();
});

test('.regex() fails if passed a bad value', t => {
	failsWith(t, () => {
		assertions.regex(42, /foo/);
	}, {
		assertion: 'regex',
		improperUsage: true,
		message: '`t.regex()` must be called with a string',
		values: [{label: 'Called with:', formatted: /42/}]
	});

	failsWith(t, () => {
		assertions.regex('42', {});
	}, {
		assertion: 'regex',
		message: '`t.regex()` must be called with a regular expression',
		values: [{label: 'Called with:', formatted: /{}/}]
	});

	t.end();
});

test('.notRegex()', t => {
	passes(t, () => {
		assertions.notRegex('abc', /def/);
	});

	passes(t, () => {
		const {notRegex} = assertions;
		notRegex('abc', /def/);
	});

	failsWith(t, () => {
		assertions.notRegex('abc', /abc/);
	}, {
		assertion: 'notRegex',
		message: '',
		values: [
			{label: 'Value must not match expression:', formatted: /abc/},
			{label: 'Regular expression:', formatted: /\/abc\//}
		]
	});

	failsWith(t, () => {
		assertions.notRegex('abc', /abc/, 'my message');
	}, {
		assertion: 'notRegex',
		message: 'my message',
		values: [
			{label: 'Value must not match expression:', formatted: /abc/},
			{label: 'Regular expression:', formatted: /\/abc\//}
		]
	});

	failsWith(t, () => {
		assertions.notRegex('abc', /abc/, null);
	}, {
		assertion: 'notRegex',
		improperUsage: true,
		message: 'The assertion message must be a string',
		values: [{
			label: 'Called with:',
			formatted: /null/
		}]
	});

	t.end();
});

test('.notRegex() fails if passed a bad value', t => {
	failsWith(t, () => {
		assertions.notRegex(42, /foo/);
	}, {
		assertion: 'notRegex',
		message: '`t.notRegex()` must be called with a string',
		values: [{label: 'Called with:', formatted: /42/}]
	});

	failsWith(t, () => {
		assertions.notRegex('42', {});
	}, {
		assertion: 'notRegex',
		message: '`t.notRegex()` must be called with a regular expression',
		values: [{label: 'Called with:', formatted: /{}/}]
	});

	t.end();
});

test('.assert()', t => {
	failsWith(t, () => {
		assertions.assert(0);
	}, {
		assertion: 'assert',
		message: '',
		operator: '!!',
		values: [{label: 'Value is not truthy:', formatted: /0/}]
	});

	failsWith(t, () => {
		assertions.assert(false, 'my message');
	}, {
		assertion: 'assert',
		message: 'my message',
		operator: '!!',
		values: [{label: 'Value is not truthy:', formatted: /false/}]
	});

	passes(t, () => {
		assertions.assert(1);
		assertions.assert(true);
	});

	passes(t, () => {
		const {assert} = assertions;
		assert(1);
		assert(true);
	});

	failsWith(t, () => {
		assertions.assert(null, null);
	}, {
		assertion: 'assert',
		improperUsage: true,
		message: 'The assertion message must be a string',
		values: [{
			label: 'Called with:',
			formatted: /null/
		}]
	});

	t.end();
});
