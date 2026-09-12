const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { COMPLETION } = require("../object/deadline-reminder");
const ReminderState = require("../object/reminder-state");
const ReminderStore = require("../object/reminder-store");

class MemoryAdapter {
	constructor (values = new Map()) {
		this.values = values;
	}

	async get (key) {
		return this.values.get(key);
	}

	async set (key, value) {
		this.values.set(key, structuredClone(value));
	}
}

const scope = serverPeriod => ({ game: "starrail", account: "123", task: "dailies", serverPeriod });
const resetAt = Date.parse("2026-01-02T04:00:00Z");

test("delivery is durable only after transport success is committed", async () => {
	const values = new Map();
	const firstProcess = new ReminderState(new MemoryAdapter(values));
	const input = {
		scope: scope("daily:2026-01-01"),
		now: resetAt - 6 * 3_600_000,
		resetAt,
		offsetHours: [20, 12, 7, 4, 2],
		completion: { status: COMPLETION.PENDING }
	};
	const failedSend = await firstProcess.evaluate(input);
	assert.equal(failedSend.rung, 7);

	const restarted = new ReminderState(new MemoryAdapter(values));
	const retry = await restarted.evaluate(input);
	assert.equal(retry.rung, 7);
	await restarted.commitDelivery(retry.delivery);
	assert.equal((await restarted.evaluate(input)).rung, null);
});

test("period key isolates game, account, task, and server period", async () => {
	const state = new ReminderState(new MemoryAdapter());
	const base = {
		now: resetAt - 6 * 3_600_000,
		resetAt,
		offsetHours: [20, 12, 7, 4, 2],
		completion: { status: COMPLETION.PENDING }
	};
	const old = await state.evaluate({ ...base, scope: scope("daily:old") });
	await state.commitDelivery(old.delivery);
	assert.equal((await state.evaluate({ ...base, scope: scope("daily:old") })).rung, null);
	assert.equal((await state.evaluate({ ...base, scope: scope("daily:new") })).rung, 7);
});

test("resolved cancels later rungs while unknown neither resolves nor consumes", async () => {
	const state = new ReminderState(new MemoryAdapter());
	const base = {
		scope: scope("daily:2026-01-01"),
		now: resetAt - 6 * 3_600_000,
		resetAt,
		offsetHours: [20, 12, 7, 4, 2]
	};
	assert.equal((await state.evaluate({ ...base, completion: { status: COMPLETION.UNKNOWN } })).reason, "completion-unknown");
	assert.equal((await state.evaluate({ ...base, completion: { status: COMPLETION.PENDING } })).rung, 7);
	await state.evaluate({ ...base, completion: { status: COMPLETION.RESOLVED } });
	assert.equal((await state.evaluate({ ...base, completion: { status: COMPLETION.PENDING } })).rung, null);
	assert.equal((await state.evaluate({ ...base, offsetHours: [...base.offsetHours, 1], completion: { status: COMPLETION.PENDING } })).rung, null);
});

test("atomic reminder-store writes survive restart and corrupt data fails closed", async (t) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "reminder-state-"));
	t.after(() => fs.rmSync(directory, { recursive: true }));
	const filename = path.join(directory, "cache.json");
	const first = new ReminderStore({ filename });
	await first.set("reminders:test", { handledOffsets: [20]});
	const restarted = new ReminderStore({ filename });
	assert.deepEqual(await restarted.get("reminders:test"), { handledOffsets: [20]});
	fs.writeFileSync(filename, "not json");
	const corrupt = new ReminderStore({ filename });
	await assert.rejects(corrupt.get("reminders:test"), /Cannot read durable reminder state/);
});
