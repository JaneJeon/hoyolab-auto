const { NotificationClass, dispatchNotification } = require("../../singleton/notification-dispatch.js");
const RegionalTaskManager = new app.RegionalTaskManager();

RegionalTaskManager.registerTask("HowlScratchCard", 21, 0, async (account) => {
	const platform = app.HoyoLab.get(account.platform);
	const notes = await platform.notes(account);
	if (notes.success === false) {
		return;
	}

	const { data } = notes;
	const scratchCard = data.cardSign;
	if (scratchCard === "Completed") {
		return;
	}

	const region = app.HoyoLab.getRegion(account.region);
	const embed = {
		color: data.assets.color,
		title: "Howl's News Stand",
		author: {
			name: `${region} Server - ${account.nickname}`,
			icon_url: data.assets.logo
		},
		description: "You haven't scratched the card at Howl's News Stand yet!",
		thumbnail: {
			url: data.assets.logo
		},
		timestamp: new Date(),
		footer: {
			text: "Howl's News Stand",
			icon_url: data.assets.logo
		}
	};

	const messageText = [
		`${region} Server - ${account.nickname}`,
		`📰 Howl's News Stand`,
		`You haven't scratched the card at Howl's News Stand yet!`
	].join("\n");

	const escapedMessage = app.Utils.escapeCharacters(messageText);
	await dispatchNotification(NotificationClass.Action, {
		telegram: escapedMessage,
		webhook: {
			message: embed,
			options: webhook => ({
				content: webhook.createUserMention(account.discord),
				author: data.assets.author,
				icon: data.assets.logo
			})
		}
	}, account);
});

module.exports = {
	name: "howl-scratch-card",
	expression: "*/5 * * * *",
	description: "Reminds you if you haven't scratched the card at Howl's News Stand.",
	code: (async function howlScratchCard () {
		await RegionalTaskManager.executeTasks({ whitelist: "nap" });
	})
};
