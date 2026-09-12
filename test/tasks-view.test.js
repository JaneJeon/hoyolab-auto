const test = require("node:test");
const assert = require("node:assert/strict");
const { renderAccount } = require("../commands/tasks/index.js");

test("task view hides resolved work only while evidence remains current in its period", () => {
	const now = Date.parse("2026-09-12T02:00:00Z");
	const input = {
		account: { platform: "starrail", uid: "test" },
		now,
		timezones: ["America/Los_Angeles", "Asia/Seoul"],
		snapshot: {
			observedAt: now,
			tasks: { dailies: { status: "resolved", deadline: "2026-09-12T03:00:00Z" } }
		}
	};
	assert.match(renderAccount(input), /All tracked chores are complete/);
	assert.match(renderAccount({ ...input, now: now + 6 * 60_000 }), /Dailies: unknown/);
	assert.match(renderAccount({ ...input, snapshot: { ...input.snapshot, lastFailure: { name: "Error" } } }), /Dailies: unknown/);
	input.snapshot.observedAt = now + 3_600_000;
	assert.match(renderAccount({ ...input, now: now + 3_600_000 }), /Waiting for evidence for the new period/);
});

test("task view shows pending work in display zones and delivery uncertainty independently", () => {
	const now = Date.parse("2026-09-12T02:00:00Z");
	const text = renderAccount({
		account: { platform: "nap", uid: "test" },
		now,
		timezones: ["America/Los_Angeles", "Asia/Seoul"],
		snapshot: {
			observedAt: now,
			tasks: { dailies: {
				status: "pending", deadline: "2026-09-12T09:00:00Z", deliveryFailure: { name: "Error" }
			} }
		}
	});
	assert.match(text, /Dailies: unfinished/);
	assert.match(text, /reminder delivery failed/);
	assert.match(text, /2:00 AM PDT/);
	assert.match(text, /6:00 PM/);
});
