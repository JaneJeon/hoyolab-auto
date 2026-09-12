const test = require("node:test");
const assert = require("node:assert/strict");

let registeredCallback;
class RegionalTaskManager {
	registerTask (name, hour, minute, callback) {
		registeredCallback = callback;
	}

	async executeTasks () {}
}

const now = Date.parse("2026-09-13T21:00:00Z");
const telegram = {
	name: "telegram",
	notificationClasses: ["Action"],
	sent: [],
	async send (message) {
		this.sent.push(message);
		return true;
	}
};
let gamePlatform;
let requestedOptions;
global.app = {
	RegionalTaskManager,
	Date: {
		now: () => now,
		REGION_OFFSETS: {}
	},
	HoyoLab: {
		get: () => gamePlatform,
		getRegion: () => "America"
	},
	Platform: {
		getForAccount: () => [telegram]
	},
	Utils: {
		escapeCharacters: value => value
	}
};

require("../crons/weeklies-reminder/index.js");

const account = type => ({
	platform: type,
	uid: "123",
	nickname: "Jane",
	region: "os_usa",
	timezone: 0,
	weekliesCheck: true,
	discord: {}
});

const installNotes = (type, weeklies, observedAt = now) => {
	requestedOptions = null;
	gamePlatform = {
		type,
		notes: async (target, options) => {
			requestedOptions = options;
			return {
				success: true,
				observedAt,
				data: {
					weeklies,
					assets: { color: 1, author: "HoyoLab", logo: "logo" }
				}
			};
		}
	};
	telegram.sent = [];
};

test("completed canonical HSR weeklies ignore obsolete Divergent Universe fields", async () => {
	installNotes("starrail", {
		weeklyBoss: 0,
		weeklyBossLimit: 3,
		periodScore: 14000,
		periodScoreTarget: 14000,
		tournUnlocked: true,
		tournScore: 0,
		tournMaxScore: 1000
	});

	await registeredCallback(account("starrail"));

	assert.deepEqual(requestedOptions, { fresh: true });
	assert.deepEqual(telegram.sent, []);
});

test("unfinished Ridu Weekly emits one Action after the ZZZ bounty is complete", async () => {
	installNotes("nap", {
		bounty: 2,
		bountyTotal: 2,
		bountyUnlocked: true,
		bountyHidden: false,
		weeklyTaskPoints: 100,
		weeklyTaskTarget: 200,
		weeklyTaskUnlocked: true,
		surveyPoints: 0,
		surveyPointsTotal: 10
	});

	await registeredCallback(account("nap"));

	assert.equal(telegram.sent.length, 1);
	assert.match(telegram.sent[0], /Ridu Weekly/);
	assert.doesNotMatch(telegram.sent[0], /Bounty Commission|Survey Points/);
});

test("unknown weekly evidence sends nothing", async () => {
	installNotes("nap", {
		bounty: null,
		bountyTotal: null,
		weeklyTaskPoints: null,
		weeklyTaskTarget: null
	});

	await registeredCallback(account("nap"));

	assert.deepEqual(telegram.sent, []);
});
