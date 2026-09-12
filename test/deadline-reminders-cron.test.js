const assert = require("node:assert/strict");
const test = require("node:test");

const { COMPLETION } = require("../object/deadline-reminder.js");
const ReminderState = require("../object/reminder-state.js");
const HoyoDate = require("../object/date.js");
const { runAccount, weeklyCompletion, weeklyDetails } = require("../crons/deadline-reminders/index.js");

test("weekly completion only resolves supported valid counters", () => {
	assert.equal(weeklyCompletion("starrail", {
		weeklyBoss: 0,
		weeklyBossLimit: 3,
		rogueScore: 14_000,
		maxScore: 14_000
	}), COMPLETION.UNKNOWN);
	assert.equal(weeklyCompletion("starrail", {
		weeklyBoss: 0,
		weeklyBossLimit: 3,
		rogueScore: 18_000,
		maxScore: 18_000,
		tournUnlocked: true,
		tournScore: 18_000,
		tournMaxScore: 1000,
		gridFightScore: 18_000,
		gridFightTarget: 18_000,
		periodScore: 18_000,
		periodScoreTarget: 18_000
	}), COMPLETION.RESOLVED);
	assert.deepEqual(weeklyDetails("starrail", {
		weeklyBoss: 0,
		weeklyBossLimit: 3,
		rogueScore: 0,
		maxScore: 18_000,
		tournUnlocked: true,
		tournScore: 0,
		tournMaxScore: 1000,
		gridFightScore: 0,
		gridFightTarget: 18_000,
		periodScore: 18_000,
		periodScoreTarget: 18_000
	}), {
		status: COMPLETION.RESOLVED,
		components: [
			{ label: "Echo of War", current: 3, target: 3, status: COMPLETION.RESOLVED },
			{ label: "Cyclical Points", current: 18_000, target: 18_000, applicable: true, status: COMPLETION.RESOLVED }
		]
	});
	assert.equal(weeklyCompletion("starrail", {
		weeklyBoss: 2,
		weeklyBossLimit: 3,
		rogueScore: 14_000,
		maxScore: 14_000
	}), COMPLETION.PENDING);
	assert.equal(weeklyCompletion("starrail", {
		weeklyBoss: 0,
		weeklyBossLimit: 3,
		rogueScore: 14_000,
		maxScore: 14_000,
		tournUnlocked: false,
		tournScore: 0,
		tournMaxScore: 0,
		gridFightScore: 14_000,
		gridFightTarget: 14_000,
		periodScore: 14_000,
		periodScoreTarget: 14_000
	}), COMPLETION.RESOLVED);
	assert.equal(weeklyCompletion("starrail", {
		weeklyBoss: 0,
		weeklyBossLimit: 3,
		rogueScore: 14_000,
		maxScore: 14_000,
		tournUnlocked: true,
		tournScore: 0,
		tournMaxScore: 0
	}), COMPLETION.UNKNOWN);
	assert.equal(weeklyCompletion("nap", {
		bounty: 0,
		bountyTotal: 8000,
		bountyUnlocked: true,
		bountyHidden: false,
		surveyPoints: 0,
		surveyPointsTotal: 0,
		weeklyTaskPoints: 1050,
		weeklyTaskTarget: 2100,
		weeklyTaskUnlocked: true
	}), COMPLETION.PENDING);
	assert.equal(weeklyCompletion("nap", {
		bounty: 8000,
		bountyTotal: 8000,
		bountyUnlocked: true,
		bountyHidden: false,
		surveyPoints: 0,
		surveyPointsTotal: 0,
		weeklyTaskPoints: 2100,
		weeklyTaskTarget: 2100,
		weeklyTaskUnlocked: true
	}), COMPLETION.RESOLVED);
	assert.equal(weeklyCompletion("nap", {
		bounty: 8000,
		bountyTotal: 8000,
		bountyUnlocked: true,
		bountyHidden: false,
		surveyPoints: 4,
		surveyPointsTotal: 4,
		weeklyTaskPoints: 2100,
		weeklyTaskTarget: 2100,
		weeklyTaskUnlocked: true
	}), COMPLETION.RESOLVED);
	assert.equal(weeklyCompletion("nap", {}), COMPLETION.UNKNOWN);
	assert.equal(weeklyCompletion("genshin", {
		resinDiscount: 0, resinDiscountLimit: 3
	}), COMPLETION.RESOLVED);
	assert.deepEqual(weeklyDetails("nap", {
		bounty: 0,
		bountyTotal: 8000,
		bountyUnlocked: true,
		bountyHidden: false,
		weeklyTaskPoints: 1050,
		weeklyTaskTarget: 2100,
		weeklyTaskUnlocked: true
	}), {
		status: COMPLETION.PENDING,
		components: [
			{ label: "Lost Void Bounty", current: 0, target: 8000, applicable: true, status: COMPLETION.PENDING },
			{ label: "Ridu Weekly", current: 1050, target: 2100, applicable: true, status: COMPLETION.PENDING }
		]
	});
});

test("one delivery failure preserves the full snapshot and does not stop later tasks", async (t) => {
	const now = Date.parse("2026-01-02T00:00:00Z");
	const values = new Map();
	const store = {
		get: async key => values.get(key),
		set: async (key, value) => values.set(key, structuredClone(value))
	};
	const deliveries = [];
	const data = {
		stamina: { currentStamina: 10, maxStamina: 240 },
		dailies: { task: 1, maxTask: 5 },
		weeklies: { bounty: 1, bountyTotal: 2, surveyPoints: 1, surveyPointsTotal: 2 },
		cardSign: "Not Completed",
		assets: { game: "ZZZ" }
	};
	const originalApp = global.app;
	global.app = {
		Date: class extends HoyoDate { static now () { return now; } },
		HoyoLab: { get: () => ({ type: "nap", notes: async () => ({ success: true, observedAt: now, data }) }) },
		Logger: { error: () => {} }
	};
	t.after(() => {
		global.app = originalApp;
	});
	const account = {
		platform: "nap",
		uid: "123",
		timezone: "NA",
		nickname: "Test",
		stamina: { threshold: 200, check: false }
	};
	await runAccount(account, { dailyOffsets: [20]}, new ReminderState(store), {
		store,
		deliver: async (_account, _data, title, description) => {
			deliveries.push({ title, description });
			if (title.startsWith("Dailies")) {
				throw new Error("transport failed");
			}
		}
	});
	assert.deepEqual(deliveries.map(({ title }) => title), ["Dailies Reminder", "Howl's News Stand Reminder"]);
	assert.match(deliveries[0].description, /Reset in 9h 0m/);
	const snapshot = values.get("reminders:snapshot:nap:123");
	assert.equal(snapshot.tasks.dailies.status, COMPLETION.PENDING);
	assert.equal(snapshot.tasks.dailies.deliveryFailure.name, "Error");
	assert.equal(snapshot.tasks.scratchCard.status, COMPLETION.PENDING);
	assert.equal(snapshot.tasks.scratchCard.deliveryFailure, null);
});

test("stamina threshold and full persist independently and rearm only after spending", async (t) => {
	let now = Date.parse("2026-01-02T00:00:00Z");
	let currentStamina = 210;
	const values = new Map();
	const store = {
		get: async key => values.get(key),
		set: async (key, value) => values.set(key, structuredClone(value))
	};
	const deliveries = [];
	const originalApp = global.app;
	global.app = {
		Date: class extends HoyoDate { static now () { return now; } },
		HoyoLab: {
			get: () => ({
				type: "starrail",
				notes: async () => ({
					success: true,
					observedAt: now,
					data: {
						stamina: { currentStamina, maxStamina: 240 },
						dailies: { task: 5, maxTask: 5 },
						weeklies: {},
						assets: { game: "Star Rail" }
					}
				})
			})
		},
		Logger: { error: () => {} }
	};
	t.after(() => {
		global.app = originalApp;
	});
	const account = {
		platform: "starrail",
		uid: "456",
		timezone: "NA",
		nickname: "Test",
		dailiesCheck: false,
		weekliesCheck: false,
		stamina: { threshold: 200, check: true }
	};
	const tick = async () => {
		now += 1000;
		await runAccount(account, { dailyOffsets: [20]}, new ReminderState(store), {
			store,
			deliver: async (_account, _data, title) => deliveries.push(title)
		});
	};

	await tick(); // threshold
	currentStamina = 240;
	await tick(); // full
	await tick(); // simulated restart at full: no duplicate
	currentStamina = 220;
	await tick(); // spend above threshold rearms full only
	currentStamina = 240;
	await tick(); // full again
	currentStamina = 100;
	await tick(); // below threshold rearms both
	currentStamina = 210;
	await tick(); // threshold again

	assert.deepEqual(deliveries, [
		"Stamina Reminder",
		"Stamina Full",
		"Stamina Full",
		"Stamina Reminder"
	]);
});
