const test = require("node:test");
const assert = require("node:assert/strict");

const {
	NotificationClass,
	dispatchNotification,
	selectPlatforms
} = require("../singleton/notification-dispatch.js");
const { splitAutomationReport } = require("../object/notification-report.js");
const { buildMessage, classifyRedeemFailure } = require("../crons/code-redeem/utils.js");
const Telegram = require("../platforms/telegram.js");
const Command = require("../classes/command.js");
const notesCommand = require("../commands/notes/index.js");
const checkinCommand = require("../commands/checkin/index.js");

const platform = (notificationClasses, name = "telegram") => ({
	name,
	notificationClasses,
	sent: [],
	async send (message, options) {
		this.sent.push({ message, options });
		return true;
	}
});

test("a class routes only to platforms that accept it", async () => {
	const action = platform([NotificationClass.Action]);
	const receipt = platform([NotificationClass.Receipt]);
	global.app = { Platform: { getForAccount: () => [action, receipt] }};

	await dispatchNotification(NotificationClass.Action, { telegram: "act" }, { id: 1 });

	assert.deepEqual(action.sent, [{ message: "act", options: undefined }]);
	assert.deepEqual(receipt.sent, []);
});

test("a platform with no class filter accepts both classes", () => {
	const legacy = platform(undefined);
	assert.deepEqual(selectPlatforms([legacy], NotificationClass.Action), [legacy]);
	assert.deepEqual(selectPlatforms([legacy], NotificationClass.Receipt), [legacy]);
});

test("an accountless action still routes by class", async () => {
	const action = platform([NotificationClass.Action]);
	let receivedAccount = "not called";
	global.app = { Platform: { getForAccount: account => {
		receivedAccount = account;
		return [action];
	} } };

	await dispatchNotification(NotificationClass.Action, { telegram: "manual code" });

	assert.equal(receivedAccount, undefined);
	assert.equal(action.sent.length, 1);
});

test("dispatch exposes no delivery and rejects an unconfirmed transport", async () => {
	const telegram = platform([NotificationClass.Action]);
	global.app = { Platform: { getForAccount: () => [telegram] }};
	assert.deepEqual(await dispatchNotification(NotificationClass.Action, { webhook: "unused" }), []);

	telegram.send = async () => false;
	await assert.rejects(
		dispatchNotification(NotificationClass.Action, { telegram: "message" }),
		/did not confirm notification delivery/
	);
});

test("a mixed automation result becomes a receipt and a separate action", () => {
	const parts = splitAutomationReport({
		tasksClaimed: [{ name: "task" }],
		codesObtained: ["CODE"]
	});

	assert.deepEqual(parts, [
		{ notificationClass: NotificationClass.Receipt },
		{
			notificationClass: NotificationClass.Action,
			codes: ["CODE"]
		}
	]);
});

test("only evidenced invalid-code retcodes receive the routine treatment", () => {
	assert.equal(classifyRedeemFailure(-2001), "known-code");
	assert.equal(classifyRedeemFailure(-2003), "known-code");
	assert.equal(classifyRedeemFailure(-99999), "unexpected");
	assert.equal(classifyRedeemFailure(undefined), "unexpected");
	const code = { code: "TEST", rewards: []};
	assert.match(buildMessage("failed", { code, retcode: -2001, reason: "used" }).telegram, /Code Not Redeemed/);
	assert.match(buildMessage("failed", { code, retcode: -99999, reason: "unknown" }).telegram, /Unexpected Code Redemption Failure/);
});

const telegramBot = (id) => {
	const bot = platform(undefined);
	bot.id = id;
	bot.prepareMessage = message => message;
	bot.handleCommand = data => Telegram.prototype.handleCommand.call(bot, data);
	bot.messageListeners = [];
	return bot;
};

const processTelegramCommand = (bot, text, chatId) => Telegram.prototype.processMessageUpdates.call(bot, [{
	message: {
		text,
		chat: { id: chatId, title: "source" },
		from: { id: 1, first_name: "Jane" }
	}
}]);

test("the real Notes command replies only through the ID 4 bot and source chat", async () => {
	const bot2 = telegramBot(2);
	const bot4 = telegramBot(4);
	Command.data = [new Command(notesCommand)];
	global.app = {
		Command,
		HoyoLab: {
			supportedGames: () => ["starrail"],
			getActiveAccounts: () => [{
				uid: "123",
				nickname: "Jane",
				region: "os_usa",
				stamina: { check: true },
				expedition: { check: true }
			}],
			getRegion: () => "America",
			get: () => ({
				gameId: 6,
				notes: async () => ({
					success: true,
					data: {
						stamina: { currentStamina: 100, maxStamina: 300, recoveryTime: 60 },
						dailies: { task: 2, maxTask: 5 },
						weeklies: {
							weeklyBoss: 1,
							weeklyBossLimit: 3,
							rogueScore: 100,
							maxScore: 14000,
							tournUnlocked: false
						},
						expedition: { list: [{ remaining_time: 30 }] }
					}
				})
			})
		},
		Utils: { formatTime: seconds => `${seconds}s` },
		Logger: { log () {} }
	};

	await processTelegramCommand(bot4, "/notes starrail", 987);

	assert.equal(bot4.sent.length, 1);
	assert.equal(bot4.sent[0].options.chat_id, 987);
	assert.match(bot4.sent[0].message, /Current Stamina/);
	assert.deepEqual(bot2.sent, []);
});

test("the real Check-In command replies only through the ID 2 bot and source chat", async () => {
	const bot2 = telegramBot(2);
	const bot4 = telegramBot(4);
	Command.data = [new Command(checkinCommand)];
	global.app = {
		Command,
		HoyoLab: {
			getActivePlatform: () => ["starrail"],
			get: () => ({
				checkIn: async () => [{
					uid: "123",
					username: "Jane",
					region: "America",
					rank: 70,
					award: { name: "Jade", count: 1 },
					total: 10,
					result: "Checked in",
					platform: "starrail",
					assets: { game: "Star Rail" }
				}]
			})
		},
		Logger: { error () {}, log () {} }
	};

	await processTelegramCommand(bot2, "/checkin starrail", 654);

	assert.equal(bot2.sent.length, 1);
	assert.equal(bot2.sent[0].options.chat_id, 654);
	assert.match(bot2.sent[0].message, /Manual Check-In/);
	assert.deepEqual(bot4.sent, []);
});

test("Telegram callback input ignores a message from another chat", async () => {
	const origin = {
		messageListeners: [],
		addMessageListener: Telegram.prototype.addMessageListener,
		removeMessageListener: Telegram.prototype.removeMessageListener
	};
	const input = Telegram.prototype.waitForUserInput.call(origin, 42, 987);
	const [listener] = origin.messageListeners;

	await listener({ message: { from: { id: 42 }, chat: { id: 654 }, text: "WRONG" } });
	assert.equal(origin.messageListeners.length, 1);
	await listener({ message: { from: { id: 42 }, chat: { id: 987 }, text: "RIGHT" } });

	assert.equal(await input, "RIGHT");
	assert.equal(origin.messageListeners.length, 0);
});
