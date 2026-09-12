const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const configPath = path.join(os.tmpdir(), `hoyolab-notification-test-${process.pid}.json5`);
fs.writeFileSync(configPath, "{ crons: { mimoJitter: 0, hilichurlJitter: 0 } }");
process.env.CONFIG_PATH = configPath;

const { NotificationClass } = require("../singleton/notification-dispatch.js");
const mimoCron = require("../crons/mimo/index.js");
const hilichurlCron = require("../crons/hilichurl/index.js");

test.after(() => {
	fs.unlinkSync(configPath);
});

const destination = notificationClass => ({
	name: "telegram",
	notificationClasses: [notificationClass],
	sent: [],
	async send (message) {
		this.sent.push(message);
		return true;
	}
});

const logger = {
	debug () {},
	info () {},
	warn () {},
	error () {}
};

const resultData = overrides => ({
	tasksClaimed: [{ name: "Daily task", points: 10 }],
	freeItemsClaimed: [],
	itemsExchanged: [],
	codesRedeemed: [],
	codesObtained: ["MANUAL-CODE"],
	lotteryDraws: [],
	errors: [],
	points: 10,
	shopStatus: [],
	assets: {
		color: 123,
		logo: "logo",
		author: "author"
	},
	...overrides
});

const account = game => ({
	uid: "123",
	nickname: "Jane",
	region: "os_usa",
	game: { name: game, short: game },
	mimo: { check: true },
	hilichurl: { check: true },
	discord: {}
});

const installCronApp = ({ gameKey, gameAccount, run }) => {
	const action = destination(NotificationClass.Action);
	const receipt = destination(NotificationClass.Receipt);
	global.app = {
		Logger: logger,
		Platform: {
			getForAccount: () => [action, receipt]
		},
		HoyoLab: {
			getActiveAccounts: ({ whitelist }) => whitelist === gameKey ? [gameAccount] : [],
			get: () => run,
			getRegion: () => "America"
		},
		Utils: {
			escapeCharacters: value => value
		}
	};
	return { action, receipt };
};

test("the Mimo cron sends mixed output as one Receipt and one Action", async () => {
	const gameAccount = account("Star Rail");
	const destinations = installCronApp({
		gameKey: "starrail",
		gameAccount,
		run: { mimo: async () => ({ success: true, data: resultData() }) }
	});

	await mimoCron.code();

	assert.equal(destinations.receipt.sent.length, 1);
	assert.equal(destinations.action.sent.length, 1);
	assert.doesNotMatch(destinations.receipt.sent[0], /MANUAL-CODE/);
	assert.match(destinations.action.sent[0], /MANUAL-CODE/);
});

test("the Hilichurl cron sends mixed output as one Receipt and one Action", async () => {
	const gameAccount = account("Genshin Impact");
	const destinations = installCronApp({
		gameKey: "genshin",
		gameAccount,
		run: { hilichurl: async () => ({ success: true, data: resultData() }) }
	});

	await hilichurlCron.code();

	assert.equal(destinations.receipt.sent.length, 1);
	assert.equal(destinations.action.sent.length, 1);
	assert.doesNotMatch(destinations.receipt.sent[0], /MANUAL-CODE/);
	assert.match(destinations.action.sent[0], /MANUAL-CODE/);
});

test("a failed Hilichurl run emits one Receipt and no Action", async () => {
	const gameAccount = account("Genshin Impact");
	const destinations = installCronApp({
		gameKey: "genshin",
		gameAccount,
		run: { hilichurl: async () => ({ success: false, message: "vendor failure" }) }
	});

	await hilichurlCron.code();

	assert.equal(destinations.receipt.sent.length, 1);
	assert.match(destinations.receipt.sent[0], /vendor failure/);
	assert.equal(destinations.action.sent.length, 0);
});
