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
	const sent = [];
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
		Got: async () => {
			throw new Error("the heartbeat must not use the app's got stack");
		}
	};

	// The heartbeat uses plain fetch, not app.Got, because Cloudflare challenges
	// every got request to the watchdog. See crons/health/index.js.
	globalThis.fetch = async (url, opts = {}) => {
		pushes.push(String(url));
		sent.push({ url: String(url), headers: opts.headers ?? {} });
		return { status: 200, text: async () => "OK" };
	};

	const probeModule = require("../object/credential-probe.js");
	probeModule.checkAccount = async () => {
		const next = queue.shift();
		if (next instanceof Error) {
			throw next;
		}

		return next;
	};

	return { pushes, sent, logs };
};

/** Finds the push for one monitor and decodes it into a readable string. */
const pushFor = (pushes, token) => {
	const hit = pushes.find(u => u.includes(`/push/${token}`));
	return hit ? decodeURIComponent(hit.replace(/\+/g, " ")) : null;
};

const ACCOUNT = { uid: "714798638", platform: "starrail", game: { short: "HSR" }, cookie: "x" };

test.afterEach(() => {
	delete globalThis.app;
	delete globalThis.fetch;
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

test("the heartbeat identifies itself honestly, not as a browser", async () => {
	// Measured from inside the container: fetch carrying the app's spoofed Chrome
	// agent is challenged by Cloudflare with a 403, and so is got with any agent.
	// A blocked heartbeat means a blind watchdog, so this is load-bearing.
	const { sent } = withStubs({
		accounts: [ACCOUNT],
		probeResults: [[{ credential: "ltoken_v2", state: "healthy", impact: "check-in" }]]
	});

	await Health.code();

	assert.ok(sent.length > 0, "something must have been pushed");
	for (const req of sent) {
		const ua = req.headers?.["User-Agent"];
		assert.strictEqual(ua, Health.HEARTBEAT_USER_AGENT);
		assert.ok(!/Mozilla|Chrome|Safari/i.test(ua), "must not claim to be a browser");
	}
});

test("a concern with no findings is undecided, never up", () => {
	// Reporting a credential healthy without having probed it is the exact
	// failure this cron exists to prevent. An empty list must push nothing, so
	// the missed heartbeat pages instead of a green light standing in for a
	// check that never ran.
	assert.deepStrictEqual(Health.verdictFor([]), { decided: false });
});

test("a concern whose findings are all healthy is up, and counts them", () => {
	const verdict = Health.verdictFor([
		{ state: "healthy", line: "one" },
		{ state: "healthy", line: "two" }
	]);

	assert.strictEqual(verdict.decided, true);
	assert.strictEqual(verdict.up, true);
	assert.strictEqual(verdict.message, "2 account(s) OK");
});

test("no active accounts takes liveness down instead of going silent", async () => {
	// This used to return before every push, so a config mistake that emptied
	// the account list was indistinguishable from a dead process. A bot with no
	// accounts is not doing its job, and liveness is where that belongs.
	const { pushes, logs } = withStubs({ accounts: [], probeResults: [] });

	await Health.code();

	const liveness = pushFor(pushes, "live");
	assert.match(liveness, /status=down/);
	assert.match(liveness, /no active accounts/);

	// Nothing was probed, so neither credential may be reported either way.
	assert.strictEqual(pushFor(pushes, "lt"), null);
	assert.strictEqual(pushFor(pushes, "ct"), null);

	assert.ok(logs.error.some(m => /config fault/.test(m)), "must say this is a config fault");
});

test("an unrendered push URL is an error, because that watchdog is blind", async () => {
	// A literal "$KUMA_..." means the variable reached the config template but
	// not the Dockerfile's envsubst list. That concern goes dark while its
	// siblings keep reporting green, which is the failure this cron exists to
	// prevent, so it must not be a debug line.
	const { pushes, logs } = withStubs({
		accounts: [ACCOUNT],
		probeResults: [[
			{ credential: "ltoken_v2", state: "healthy", impact: "check-in" },
			{ credential: "cookie_token_v2", state: "healthy", impact: "code redemption" }
		]],
		urls: { ...URLS, ltoken: "$KUMA_PUSH_URL_LTOKEN" }
	});

	await Health.code();

	assert.strictEqual(pushFor(pushes, "lt"), null, "must not push to a literal variable name");
	assert.ok(logs.error.some(m => /blind/.test(m)), "must log at error, not debug");
	assert.strictEqual(logs.debug.filter(m => /No push URL/.test(m)).length, 0);

	// The siblings must be unaffected.
	assert.match(pushFor(pushes, "ct"), /status=up/);
	assert.match(pushFor(pushes, "live"), /status=up/);
});
