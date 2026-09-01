const test = require("node:test");
const assert = require("node:assert");

const { redeemCodes } = require("../crons/code-redeem/zenless.js");

const ACCOUNT = { uid: "1003643521", region: "prod_gf_us", cookie: "cookie_token_v2=x; account_mid_v2=y; account_id_v2=z" };
const CODE = { code: "TESTCODE1234" };

/**
 * Stubs what redeemCodes reaches for, and records log lines so the retcode can
 * be asserted to actually reach an operator.
 */
const withStubs = (body) => {
	const logs = [];

	globalThis.app = {
		Got: async () => ({ statusCode: 200, body }),
		Date: { now: () => 1788224412675 },
		HoyoLab: { parseCookie: () => "cookie_token_v2=x" },
		Logger: {
			info: (_t, m) => logs.push(typeof m === "string" ? m : JSON.stringify(m)),
			log: (_t, m) => logs.push(typeof m === "string" ? m : JSON.stringify(m)),
			warn: () => {},
			debug: () => {},
			error: () => {}
		}
	};

	return logs;
};

test.afterEach(() => {
	delete globalThis.app;
});

test("an auth failure returns its retcode, not just a localised message", async () => {
	// -1071 is the redemption endpoint's dead-credential code. Classifying on
	// res.body.message instead would mean matching a localised human string,
	// which is the antipattern that makes Mimo's credential detection unreliable.
	const logs = withStubs({ retcode: -1071, message: "Please log in to your account first." });

	const result = await redeemCodes(ACCOUNT, CODE);

	assert.strictEqual(result.success, false);
	assert.strictEqual(result.retcode, -1071, "the number must survive to the caller");
	assert.strictEqual(result.reason, "Please log in to your account first.");
	assert.ok(logs.some(l => l.includes("-1071")), "an operator must see the retcode in the log");
});

test("an already-used or invalid code keeps its distinct retcode", async () => {
	// -2001 and -2003 collapse to one reason string, which loses the difference
	// between them. The retcode is the only thing that still tells them apart.
	const logs = withStubs({ retcode: -2003, message: "Invalid redemption code" });

	const result = await redeemCodes(ACCOUNT, CODE);

	assert.strictEqual(result.success, false);
	assert.strictEqual(result.retcode, -2003);
	assert.strictEqual(result.reason, "Expired or invalid code");
	assert.ok(logs.some(l => l.includes("-2003")), "the collapsed branch must still record which code it was");
});

test("an unrecognised retcode is carried through rather than flattened", async () => {
	// The inventory of what this endpoint returns has never been written down.
	// Anything unknown has to reach the logs intact or it can never be learned.
	const logs = withStubs({ retcode: -9999, message: "Some unseen vendor state" });

	const result = await redeemCodes(ACCOUNT, CODE);

	assert.strictEqual(result.retcode, -9999);
	assert.ok(logs.some(l => l.includes("-9999")));
});

test("a success reports retcode 0, so every outcome carries the same field", async () => {
	withStubs({ retcode: 0, message: "OK", data: null });

	const result = await redeemCodes(ACCOUNT, { code: "GOODCODE1234" });

	assert.strictEqual(result.success, true);
	assert.strictEqual(result.retcode, 0, "a caller must be able to read .retcode unconditionally");
});

test("a non-200 still throws, and that path reports no retcode at all", async () => {
	// Worth pinning: an HTTP failure escapes redeemCodes entirely rather than
	// returning a verdict, so anything downstream that assumes it always gets a
	// result object is wrong. This is a known gap, recorded rather than fixed.
	globalThis.app = {
		Got: async () => ({ statusCode: 503, body: {} }),
		Date: { now: () => 1 },
		HoyoLab: { parseCookie: () => "x" },
		Logger: { info: () => {}, log: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
		Error: class extends Error {
			constructor ({ message }) {
				super(message);
			}
		}
	};

	await assert.rejects(() => redeemCodes(ACCOUNT, CODE), /non-200/);
});
