const test = require("node:test");
const assert = require("node:assert");

const { fetchCodes } = require("../crons/code-redeem/utils.js");

/**
 * Stubs the HTTP layer the code-source modules reach for, and records logs so a
 * dead source can be told apart from a quiet day.
 */
const withStubs = (gotImpl) => {
	const logs = { warn: [], debug: [], error: [], info: [] };

	globalThis.app = {
		Got: gotImpl,
		Logger: {
			warn: (_t, m) => logs.warn.push(typeof m === "string" ? m : JSON.stringify(m)),
			debug: (_t, m) => logs.debug.push(typeof m === "string" ? m : JSON.stringify(m)),
			error: (_t, m) => logs.error.push(m),
			info: () => {}
		}
	};

	return logs;
};

test.afterEach(() => {
	delete globalThis.app;
});

test("a code source returning non-200 is reported, not silently treated as no codes", async () => {
	// This is the failure that has no signal today. Every source degrades a dead
	// feed to an empty list, so redemption stops running and looks exactly like
	// a day with no new codes. That is the same shape as the twelve-day outage:
	// nothing ran, so nothing could report.
	const logs = withStubs(async () => ({ statusCode: 503, body: {} }));

	const codes = await fetchCodes();

	for (const [game, list] of Object.entries(codes)) {
		assert.deepStrictEqual(list, [], `${game} must still degrade to an empty list`);
	}

	// One warning per source, so a single broken feed is visible without the
	// others being stopped by it.
	assert.strictEqual(logs.warn.length, Object.keys(codes).length);
	for (const line of logs.warn) {
		assert.match(line, /Code source for \w+ failed/);
		assert.match(line, /nothing will be redeemed/, "must say what the consequence is");
	}
});

test("a code source returning a malformed body is reported the same way", async () => {
	const logs = withStubs(async () => ({ statusCode: 200, body: { active: "not-an-array" } }));

	const codes = await fetchCodes();

	assert.ok(Object.values(codes).every(list => list.length === 0));
	assert.strictEqual(logs.warn.length, Object.keys(codes).length);
});

test("a source that throws is reported with its message, and does not stop the others", async () => {
	let call = 0;
	const logs = withStubs(async () => {
		call += 1;
		if (call === 1) {
			throw new Error("ECONNRESET");
		}

		return { statusCode: 200, body: { active: [] } };
	});

	const codes = await fetchCodes();

	assert.strictEqual(logs.warn.length, 1, "only the throwing source is reported");
	assert.match(logs.warn[0], /threw \(ECONNRESET\)/);

	// Every source still returns a usable list, so one dead feed cannot stop the rest.
	assert.ok(Object.values(codes).every(list => Array.isArray(list)));
});

test("a healthy source is not reported, and its codes come through", async () => {
	const logs = withStubs(async () => ({
		statusCode: 200,
		body: { active: [{ code: "TESTCODE1234", rewards: ["x"] }] }
	}));

	const codes = await fetchCodes();

	assert.strictEqual(logs.warn.length, 0, "a working day must be silent");
	for (const [game, list] of Object.entries(codes)) {
		assert.strictEqual(list.length, 1, `${game} must return its code`);
		assert.strictEqual(list[0].code, "TESTCODE1234");
	}
});
