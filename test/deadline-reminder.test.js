const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const {
	COMPLETION,
	classifyCompletion,
	coverageForZones,
	getPeriod,
	rungInstants,
	selectDueRung
} = require("../object/deadline-reminder");

test("completion is tri-state and rejects the ZZZ 0/0 false completion", () => {
	const now = Date.parse("2026-01-01T00:00:00Z");
	assert.equal(classifyCompletion({ current: 0, maximum: 0, observedAt: now, now, maxAgeMs: 120_000 }).status, COMPLETION.UNKNOWN);
	assert.equal(classifyCompletion({ current: null, maximum: 5, observedAt: now, now, maxAgeMs: 120_000 }).status, COMPLETION.UNKNOWN);
	assert.equal(classifyCompletion({ current: "", maximum: 5, observedAt: now, now, maxAgeMs: 120_000 }).status, COMPLETION.UNKNOWN);
	assert.equal(classifyCompletion({ current: 5, maximum: 5, observedAt: now, now, maxAgeMs: 120_000 }).status, COMPLETION.RESOLVED);
	assert.equal(classifyCompletion({ current: 4, maximum: 5, observedAt: now, now, maxAgeMs: 120_000 }).status, COMPLETION.PENDING);
	assert.equal(classifyCompletion({ current: 5, maximum: 5, observedAt: now - 120_001, now, maxAgeMs: 120_000 }).status, COMPLETION.UNKNOWN);
	assert.equal(classifyCompletion({ current: 5, maximum: 5, observedAt: now - 60_000, now, maxAgeMs: 120_000, minObservedAt: now - 30_000 }).status, COMPLETION.UNKNOWN);
	assert.equal(classifyCompletion({ current: 5, maximum: 5, observedAt: now, now, maxAgeMs: null }).status, COMPLETION.UNKNOWN);
});

test("daily period is anchored to the server's 04:00 boundary", () => {
	const before = getPeriod({ now: Date.parse("2026-07-01T08:59:00Z"), serverOffsetMinutes: -300, kind: "daily" });
	const after = getPeriod({ now: Date.parse("2026-07-01T09:01:00Z"), serverOffsetMinutes: -300, kind: "daily" });
	assert.equal(before.resetAt.toISOString(), "2026-07-01T09:00:00.000Z");
	assert.equal(after.resetAt.toISOString(), "2026-07-02T09:00:00.000Z");
});

test("weekly period resets Monday 04:00 server-local for NA and EU", () => {
	const sunday = Date.parse("2026-09-06T12:00:00Z");
	const na = getPeriod({ now: sunday, serverOffsetMinutes: -300, kind: "weekly" });
	const eu = getPeriod({ now: sunday, serverOffsetMinutes: 60, kind: "weekly" });
	assert.equal(na.resetAt.toISOString(), "2026-09-07T09:00:00.000Z");
	assert.equal(eu.resetAt.toISOString(), "2026-09-07T03:00:00.000Z");
	for (const period of [na, eu]) {
		for (const rung of rungInstants({ resetAt: period.resetAt, offsetHours: [27, 20, 12, 7, 3]})) {
			assert.notEqual(new Date(rung.at.getTime() + (period === na ? -300 : 60) * 60_000).getUTCDay(), 6);
		}
	}
});

test("late evaluation emits only the newest crossed rung", () => {
	const resetAt = Date.parse("2026-01-02T04:00:00Z");
	assert.deepEqual(selectDueRung({
		now: resetAt - 6 * 3_600_000,
		resetAt,
		offsetHours: [20, 12, 7, 4, 2]
	}), { rung: 7, crossedOffsets: [20, 12, 7]});
});

test("coverage uses IANA zone DST and active hours only for reporting", () => {
	const winter = coverageForZones({
		resetAt: Date.parse("2026-01-05T09:00:00Z"),
		offsetHours: [20, 12, 7, 4, 2],
		timezones: ["America/Los_Angeles", "America/New_York", "Asia/Seoul"],
		activeHours: { from: "09:00", to: "21:00" }
	});
	assert.deepEqual(winter, {
		"America/Los_Angeles": { reachable: 2, total: 5 },
		"America/New_York": { reachable: 1, total: 5 },
		"Asia/Seoul": { reachable: 3, total: 5 }
	});
});

test("container TZ cannot change server reset arithmetic", () => {
	const script = `const { getPeriod } = require('./object/deadline-reminder');
		process.stdout.write(getPeriod({ now: Date.parse('2026-09-06T12:00:00Z'), serverOffsetMinutes: -300, kind: 'weekly' }).resetAt.toISOString());`;
	const run = TZ => execFileSync(process.execPath, ["-e", script], {
		cwd: require("node:path").resolve(__dirname, ".."),
		env: { ...process.env, TZ },
		encoding: "utf8"
	});
	assert.equal(run("UTC"), run("Asia/Shanghai"));
});
