const assert = require("node:assert/strict");
const test = require("node:test");

const { COMPLETION, classifyCompletion, getPeriod } = require("../object/deadline-reminder.js");

const resetAt = Date.parse("2026-01-02T09:00:00Z");
const requestStartedAt = resetAt - 1;
const responseReceivedAt = resetAt + 1;

const fixtures = [{
	name: "genshin",
	Notes: require("../hoyolab-modules/genshin/notes.js"),
	body: {
		current_resin: 0,
		max_resin: 200,
		resin_recovery_time: 0,
		daily_task: { finished_num: 4, total_num: 4 },
		remain_resin_discount_num: 0,
		resin_discount_num_limit: 3,
		current_home_coin: 0,
		max_home_coin: 2400,
		home_coin_recovery_time: 0,
		expeditions: []
	}
}, {
	name: "starrail",
	Notes: require("../hoyolab-modules/starrail/notes.js"),
	body: {
		current_stamina: 0,
		max_stamina: 300,
		stamina_recover_time: 0,
		current_reserve_stamina: 0,
		is_reserve_stamina_full: false,
		current_train_score: 500,
		max_train_score: 500,
		weekly_cocoon_cnt: 0,
		weekly_cocoon_limit: 3,
		current_rogue_score: 14_000,
		max_rogue_score: 14_000,
		rogue_tourn_weekly_cur: 0,
		rogue_tourn_weekly_max: 0,
		rogue_tourn_weekly_unlocked: false,
		expeditions: []
	}
}, {
	name: "nap",
	Notes: require("../hoyolab-modules/zenless/notes.js"),
	body: {
		card_sign: "CardSignDone",
		energy: { progress: { current: 0, max: 240 }, restore: 0 },
		vitality: { current: 400, max: 400 },
		bounty_commission: { num: 4, total: 4, unlock: true, hide: false },
		survey_points: { num: 8000, total: 8000 },
		weekly_task: { cur_point: 1050, max_point: 2100, unlock: true }
	}
}];

for (const fixture of fixtures) {
	test(`${fixture.name} timestamps fresh notes at request start across reset`, async () => {
		let now = requestStartedAt;
		global.app = {
			Date: { now: () => now },
			Got: async () => {
				now = responseReceivedAt;
				return { statusCode: 200, body: { retcode: 0, data: fixture.body } };
			},
			HoyoLab: { parseCookie: () => "cookie" },
			Logger: { log: () => {}, warn: () => {} },
			Utils: { generateDS: () => "ds" }
		};
		const instance = {
			config: { assets: {}, url: { notes: "https://example.test/notes" } },
			dataCache: { get: async () => null, set: async () => {} },
			fullName: fixture.name,
			name: fixture.name
		};
		const account = {
			cookie: "secret",
			nickname: "Traveler",
			region: "os_usa",
			stamina: { threshold: 100 },
			uid: "123"
		};

		const result = await new fixture.Notes(instance).notes(account, { fresh: true });
		assert.equal(result.observedAt, requestStartedAt);

		const period = getPeriod({ now: responseReceivedAt, serverOffsetMinutes: -300, kind: "daily" });
		assert.equal(classifyCompletion({
			current: result.data.dailies.task,
			maximum: result.data.dailies.maxTask,
			observedAt: result.observedAt,
			now: responseReceivedAt,
			maxAgeMs: 120_000,
			minObservedAt: period.startAt
		}).status, COMPLETION.UNKNOWN);
	});
}

test("ZZZ keeps missing counters and unrecognized scratch-card state unknown", async () => {
	const fixture = fixtures.find(item => item.name === "nap");
	let body = {
		...fixture.body,
		card_sign: "FutureCardState",
		energy: { progress: { max: 240 } },
		vitality: { max: 400 },
		bounty_commission: null,
		survey_points: null
	};
	global.app = {
		Date: { now: () => responseReceivedAt },
		Got: async () => ({ statusCode: 200, body: { retcode: 0, data: body } }),
		HoyoLab: { parseCookie: () => "cookie" },
		Logger: { log: () => {}, warn: () => {} },
		Utils: { generateDS: () => "ds" }
	};
	const notes = new fixture.Notes({
		config: { assets: {}, url: { notes: "https://example.test/notes" } },
		dataCache: { get: async () => null, set: async () => {} }
	});
	const account = { stamina: { threshold: 100 }, cookie: "secret", uid: "test" };
	const result = await notes.notes(account, { fresh: true });
	assert.equal(result.data.cardSign, "Unknown");
	assert.equal(result.data.stamina.currentStamina, undefined);
	assert.equal(result.data.weeklies.bounty, undefined);
	assert.equal(result.data.weeklies.surveyPoints, undefined);
	assert.equal(classifyCompletion({
		current: result.data.dailies.task,
		maximum: result.data.dailies.maxTask,
		observedAt: result.observedAt,
		now: responseReceivedAt,
		maxAgeMs: 120_000
	}).status, COMPLETION.UNKNOWN);
	body = { ...fixture.body, card_sign: "CardSignNo" };
	const valid = await notes.notes(account, { fresh: true });
	assert.equal(valid.data.cardSign, "Not Completed");
	assert.equal(valid.data.weeklies.weeklyTaskPoints, 1050);
	assert.equal(valid.data.weeklies.weeklyTaskTarget, 2100);
	assert.equal(valid.data.weeklies.weeklyTaskUnlocked, true);
	assert.equal(valid.data.weeklies.bountyHidden, false);
});
