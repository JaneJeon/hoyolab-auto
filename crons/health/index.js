const CredentialProbe = require("../../object/credential-probe.js");

const HEARTBEAT_TIMEOUT_MS = 15000;

/**
 * The heartbeat identifies itself honestly instead of inheriting the app's
 * browser User-Agent.
 *
 * The watchdog sits behind Cloudflare, whose bot rules challenge a request that
 * claims to be Chrome but has a Node TLS fingerprint, and also challenge Node's
 * own default agent. Both got HTTP 403 "Just a moment" from inside the
 * container, while a plain custom agent got 200. A blocked heartbeat means a
 * blind watchdog, so this header is load-bearing, not cosmetic.
 */
const HEARTBEAT_USER_AGENT = "hoyolab-auto-healthcheck";

/**
 * One push monitor per independently-failing concern.
 *
 * An aggregate monitor cannot say WHICH thing broke, and it lets one failure
 * hide behind another's success. Separate monitors also give an accurate "down
 * since" and duration per concern, which a combined signal destroys.
 */
const CONCERNS = {
	liveness: "the process is alive and the health check ran",
	ltoken: "daily check-in, Mimo, stamina and reminders",
	cookieToken: "code redemption"
};

/**
 * Sends one heartbeat. Only called with a decided verdict: an undecided probe
 * sends nothing, so a transient network fault reads as one missed beat rather
 * than as a dead credential.
 */
const pushHeartbeat = async (concern, url, { up, message }) => {
	const target = new URL(url);
	target.searchParams.set("status", up ? "up" : "down");
	target.searchParams.set("msg", message);

	try {
		const res = await app.Got("API", {
			url: target.toString(),
			method: "GET",
			responseType: "text",
			throwHttpErrors: false,
			headers: { "User-Agent": HEARTBEAT_USER_AGENT },
			timeout: { request: HEARTBEAT_TIMEOUT_MS }
		});

		if (res.statusCode !== 200) {
			app.Logger.error("Cron:Health", `Heartbeat for "${concern}" rejected with HTTP ${res.statusCode}. That watchdog is blind, check its push URL.`);
			return;
		}

		app.Logger.debug("Cron:Health", `Heartbeat for "${concern}" sent (${up ? "up" : "down"})`);
	}
	catch (e) {
		// A dead heartbeat is a monitoring fault, not a failed run. Kuma notices
		// the silence by itself, so log it and let the run stand.
		app.Logger.error("Cron:Health", `Heartbeat for "${concern}" failed: ${e.message}. That watchdog is blind, check its push URL.`);
	}
};

const describe = (account) => `${account.game?.short ?? account.platform} ${account.uid ?? "?"}`;

/** A concern is down if anything is dead, undecided if anything is inconclusive. */
const verdictFor = (findings) => {
	const dead = findings.filter(f => f.state === "dead");
	if (dead.length !== 0) {
		return { decided: true, up: false, message: dead.map(f => f.line).join(" | ") };
	}

	if (findings.some(f => f.state === "inconclusive")) {
		return { decided: false };
	}

	return { decided: true, up: true, message: `${findings.length} account(s) OK` };
};

module.exports = {
	name: "health",
	expression: "*/30 * * * *",
	description: "Verify each credential class on its own schedule and report each to its own watchdog",
	code: (async function health () {
		const config = app.Config.get("health") ?? {};
		const urls = config.kuma ?? {};
		const accounts = app.HoyoLab.getActiveAccounts({ blacklist: ["honkai", "tot"] });
		if (accounts.length === 0) {
			return;
		}

		const byConcern = { ltoken: [], cookieToken: [] };

		for (const account of accounts) {
			let findings;
			try {
				findings = await CredentialProbe.checkAccount(account);
			}
			catch (e) {
				// Attribute an outright throw to both classes: we learned nothing
				// about either, so neither may be reported healthy.
				const line = `${describe(account)}: probe threw (${e.message})`;
				byConcern.ltoken.push({ state: "inconclusive", line });
				byConcern.cookieToken.push({ state: "inconclusive", line });
				continue;
			}

			for (const finding of findings) {
				const concern = (finding.credential === "ltoken_v2") ? "ltoken" : "cookieToken";
				const line = (finding.state === "dead")
					? `${describe(account)} ${finding.credential} is dead, so ${finding.impact} stop working (${finding.detail})`
					: `${describe(account)} ${finding.credential}: ${finding.detail ?? finding.state}`;

				byConcern[concern].push({ state: finding.state, line });
			}
		}

		for (const [concern, findings] of Object.entries(byConcern)) {
			const verdict = verdictFor(findings);

			for (const finding of findings) {
				if (finding.state === "dead") {
					app.Logger.error("Cron:Health", finding.line);
				}
				else if (finding.state === "inconclusive") {
					app.Logger.warn("Cron:Health", finding.line);
				}
			}

			const url = urls[concern];
			if (!url || url.startsWith("$")) {
				// Unconfigured is legitimate for a local run or a fresh clone. An
				// unrendered "$VAR" means someone added it to the config template but
				// not to the Dockerfile's envsubst list.
				app.Logger.debug("Cron:Health", `No push URL for "${concern}", so its result is logged only`);
				continue;
			}

			if (!verdict.decided) {
				app.Logger.warn("Cron:Health", `"${concern}" undetermined, skipping its heartbeat so the missed beat speaks instead`);
				continue;
			}

			await pushHeartbeat(concern, url, verdict);
		}

		// Liveness is deliberately independent of every credential verdict. It
		// answers "did this process run its loop at all", which is the failure a
		// credential probe cannot see, and which credential failures must not mask.
		const livenessUrl = urls.liveness;
		if (livenessUrl && !livenessUrl.startsWith("$")) {
			await pushHeartbeat("liveness", livenessUrl, {
				up: true,
				message: `health check completed for ${accounts.length} account(s)`
			});
		}
	}),
	CONCERNS,
	verdictFor,
	HEARTBEAT_USER_AGENT
};
