const test = require("node:test");
const assert = require("node:assert");

const Health = require("../crons/health/index.js");

const URLS = {
	liveness: "https://kuma.example.com/api/push/live",
	ltoken: "https://kuma.example.com/api/push/lt",
	cookieToken: "https://kuma.example.com/api/push/ct"
};

/**
 * Stubs the globals the cron reaches for, and records every heartbeat so each
 * monitor's verdict (up, down, or silence) can be asserted independently.
 */
const withStubs = ({ accounts, probeResults, urls = URLS }) => {
	const pushes = [];
	const logs = { error: [], warn: [], debug: [] };
	const queue = [...probeResults];

	globalThis.app = {
		Config: { get: (key) => (key === "health" ? { kuma: urls } : undefined) },
		HoyoLab: { getActiveAccounts: () => accounts },
		Logger: {
			error: (_t, m) => logs.error.push(m),
			warn: (_t, m) => logs.warn.push(m),
			info: () => {},
			debug: (_t, m) => logs.debug.push(m)
		},
		Got: async (_name, opts) => {
			pushes.push(opts.url);
			return { statusCode: 200, body: "OK" };
		}
	};

	const probeModule = require("../object/credential-probe.js");
	probeModule.checkAccount = async () => {
		const next = queue.shift();
		if (next instanceof Error) {
			throw next;
		}

		return next;
	};

	return { pushes, logs };
};

/** Finds the push for one monitor and decodes it into a readable string. */
const pushFor = (pushes, token) => {
	const hit = pushes.find(u => u.includes(`/push/${token}`));
	return hit ? decodeURIComponent(hit.replace(/\+/g, " ")) : null;
};

const ACCOUNT = { uid: "714798638", platform: "starrail", game: { short: "HSR" }, cookie: "x" };

test.afterEach(() => {
	delete globalThis.app;
});

test("all healthy pushes up on every monitor", async () => {
	const { pushes } = withStubs({
		accounts: [ACCOUNT],
		probeResults: [[
			{ credential: "ltoken_v2", state: "healthy", impact: "check-in" },
			{ credential: "cookie_token_v2", state: "healthy", impact: "code redemption" }
		]]
	});

	await Health.code();

	assert.match(pushFor(pushes, "lt"), /status=up/);
	assert.match(pushFor(pushes, "ct"), /status=up/);
	assert.match(pushFor(pushes, "live"), /status=up/);
});

test("a dead redemption credential takes down ONLY its own monitor", async () => {
	// This is the whole point of splitting them. The August failure looked
	// exactly like this: redemption dead, everything else genuinely fine.
	const { pushes } = withStubs({
		accounts: [ACCOUNT],
		probeResults: [[
			{ credential: "ltoken_v2", state: "healthy", impact: "check-in" },
			{ credential: "cookie_token_v2", state: "dead", impact: "code redemption", detail: "retcode -100" }
		]]
	});

	await Health.code();

	const ct = pushFor(pushes, "ct");
	assert.match(ct, /status=down/);
	assert.match(ct, /cookie_token_v2/, "the alert must name the credential");
	assert.match(ct, /code redemption/, "the alert must say what stops working");

	assert.match(pushFor(pushes, "lt"), /status=up/, "the login credential is fine and must stay up");
	assert.match(pushFor(pushes, "live"), /status=up/, "the process is alive and must stay up");
});

test("liveness still reports up when both credentials are dead", async () => {
	// The process ran. Conflating that with credential health is what makes an
	// aggregate monitor unable to tell you which thing actually broke.
	const { pushes } = withStubs({
		accounts: [ACCOUNT],
		probeResults: [[
			{ credential: "ltoken_v2", state: "dead", impact: "check-in", detail: "retcode -100" },
			{ credential: "cookie_token_v2", state: "dead", impact: "code redemption", detail: "retcode -100" }
		]]
	});

	await Health.code();

	assert.match(pushFor(pushes, "lt"), /status=down/);
	assert.match(pushFor(pushes, "ct"), /status=down/);
	assert.match(pushFor(pushes, "live"), /status=up/);
});

test("an undecided probe stays silent on that monitor only", async () => {
	const { pushes } = withStubs({
		accounts: [ACCOUNT],
		probeResults: [[
			{ credential: "ltoken_v2", state: "inconclusive", detail: "timeout" },
			{ credential: "cookie_token_v2", state: "healthy", impact: "code redemption" }
		]]
	});

	await Health.code();

	assert.strictEqual(pushFor(pushes, "lt"), null, "an undecided probe must push nothing");
	assert.match(pushFor(pushes, "ct"), /status=up/);
	assert.match(pushFor(pushes, "live"), /status=up/);
});

test("a thrown probe leaves both credentials undecided but liveness up", async () => {
	const { pushes } = withStubs({
		accounts: [ACCOUNT],
		probeResults: [new Error("boom")]
	});

	await Health.code();

	assert.strictEqual(pushFor(pushes, "lt"), null);
	assert.strictEqual(pushFor(pushes, "ct"), null);
	assert.match(pushFor(pushes, "live"), /status=up/, "the cron itself completed");
});

test("dead outranks inconclusive within one monitor", async () => {
	const { pushes } = withStubs({
		accounts: [ACCOUNT, { ...ACCOUNT, uid: "2" }],
		probeResults: [
			[{ credential: "cookie_token_v2", state: "inconclusive", detail: "timeout" }],
			[{ credential: "cookie_token_v2", state: "dead", impact: "code redemption", detail: "retcode -100" }]
		]
	});

	await Health.code();

	assert.match(pushFor(pushes, "ct"), /status=down/);
});

test("an unconfigured monitor is skipped, and the others still report", async () => {
	const { pushes, logs } = withStubs({
		accounts: [ACCOUNT],
		probeResults: [[
			{ credential: "ltoken_v2", state: "healthy", impact: "check-in" },
			{ credential: "cookie_token_v2", state: "dead", impact: "code redemption", detail: "d" }
		]],
		urls: { liveness: "", ltoken: URLS.ltoken, cookieToken: "" }
	});

	await Health.code();

	assert.strictEqual(pushFor(pushes, "ct"), null);
	assert.strictEqual(pushFor(pushes, "live"), null);
	assert.match(pushFor(pushes, "lt"), /status=up/);
	assert.strictEqual(logs.error.length, 1, "the dead credential is still logged");
});

test("an unrendered envsubst placeholder counts as unconfigured", async () => {
	// A var added to the config template but not to the Dockerfile's envsubst
	// list survives as the literal "$KUMA_...", which must not be fetched.
	const { pushes } = withStubs({
		accounts: [ACCOUNT],
		probeResults: [[{ credential: "ltoken_v2", state: "healthy", impact: "check-in" }]],
		urls: { liveness: "$KUMA_PUSH_URL_LIVENESS", ltoken: "$KUMA_PUSH_URL_LTOKEN", cookieToken: "" }
	});

	await Health.code();

	assert.strictEqual(pushes.length, 0);
});
