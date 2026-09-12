const assert = require("node:assert/strict");
const test = require("node:test");

const notesCommand = require("../commands/notes/index.js");

test("notes renders missing ZZZ progress and recovery as unknown", async (t) => {
	const account = {
		uid: "123",
		nickname: "Test",
		region: "os_usa",
		stamina: { check: true },
		expedition: { check: false }
	};
	const data = {
		stamina: { currentStamina: undefined, maxStamina: 240, recoveryTime: undefined },
		dailies: { task: undefined, maxTask: 400 },
		weeklies: {
			bounty: undefined,
			bountyTotal: undefined,
			weeklyTaskPoints: 1050,
			weeklyTaskTarget: 2100,
			surveyPoints: undefined,
			surveyPointsTotal: undefined
		},
		shop: { state: "Unknown" },
		cardSign: "Unknown",
		assets: { color: 0, logo: "logo" }
	};
	const originalApp = global.app;
	global.app = {
		HoyoLab: {
			supportedGames: () => ["nap"],
			getActiveAccounts: () => [account],
			getRegion: () => "America",
			get: () => ({ gameId: 8, fullName: "Zenless Zone Zero", notes: async () => ({ success: true, data }) })
		},
		Utils: { formatTime: seconds => `${seconds}s` }
	};
	t.after(() => {
		global.app = originalApp;
	});

	const telegram = await notesCommand.run({ platform: { name: "Telegram" } }, "nap");
	assert.match(telegram.reply, /Current Stamina: Unknown/);
	assert.match(telegram.reply, /Full in: Unknown/);
	assert.match(telegram.reply, /Dailies: Unknown/);
	assert.match(telegram.reply, /Ridu Weekly: 1050\/2100/);
	assert.match(telegram.reply, /Lost Void Bounty: Unknown/);
	assert.doesNotMatch(telegram.reply, /Investigation Points/);
	assert.doesNotMatch(telegram.reply, /undefined|NaN/);

	let reply;
	await notesCommand.run({
		platform: { name: "Discord" },
		interaction: { reply: async value => { reply = value; } }
	}, "nap");
	const rendered = JSON.stringify(reply.embeds);
	assert.match(rendered, /Current Stamina:/);
	assert.match(rendered, /Full in:\\nUnknown/);
	assert.match(rendered, /Lost Void Bounty: Unknown/);
	assert.doesNotMatch(rendered, /undefined|NaN/);
});
