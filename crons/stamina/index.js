const { NotificationClass, dispatchNotification } = require("../../singleton/notification-dispatch.js");

module.exports = {
	name: "stamina",
	expression: "0 */30 * * * *",
	description: "Check for your stamina and notify you when it's within the set threshold.",
	code: (async function stamina () {
		// eslint-disable-next-line object-curly-spacing
		const accountsList = app.HoyoLab.getActiveAccounts({ blacklist: ["honkai", "tot"] });
		if (accountsList.length === 0) {
			app.Logger.warn("Cron:Stamina", "No active accounts found to run stamina check for.");
			return;
		}

		const activeGameAccounts = app.HoyoLab.getActivePlatform();
		for (const name of activeGameAccounts) {
			const platform = app.HoyoLab.get(name);
			const accounts = accountsList.filter(account => account.platform === name);

			for (const account of accounts) {
				const staminaCheck = account.stamina.check;
				if (staminaCheck === false) {
					continue;
				}

				const notes = await platform.notes(account);
				if (notes.success === false) {
					continue;
				}

				const { fired, persistent } = account.stamina;
				if (fired && !persistent) {
					continue;
				}

				const { data } = notes;
				const stamina = data.stamina;

				const current = Math.floor(stamina.currentStamina);
				if (current < account.stamina.threshold) {
					account.stamina.fired = false;
					platform.update(account);
					continue;
				}

				const max = stamina.maxStamina;
				const delta = app.Utils.formatTime(stamina.recoveryTime);

				account.stamina.fired = true;
				platform.update(account);

				const description = (stamina.currentStamina === stamina.maxStamina)
					? "Your stamina is full!"
					: "Your stamina is within the set threshold!";
				const event = (stamina.currentStamina === stamina.maxStamina)
					? "full"
					: "threshold";

				const embed = {
					color: data.assets.color,
					title: "Stamina Reminder",
					author: {
						name: data.assets.author,
						icon_url: data.assets.logo
					},
					description,
					fields: [
						{ name: "UID", value: account.uid, inline: true },
						{ name: "Username", value: account.nickname, inline: true },
						{ name: "Region", value: app.HoyoLab.getRegion(account.region), inline: true },
						{ name: "Stamina", value: `${current}/${max}`, inline: true },
						{ name: "Recovery Time", value: delta, inline: true }
					],
					timestamp: new Date(),
					footer: {
						text: `Stamina Reminder (${event})`,
						icon_url: data.assets.logo
					}
				};

				const messageText = [
					`📢 Stamina Reminder, ${description}`,
					`🎮 **Game**: ${data.assets.game}`,
					`🆔 **UID**: ${account.uid} ${account.nickname}`,
					`🌍 **Region**: ${app.HoyoLab.getRegion(account.region)}`,
					`🔋 **Stamina**: ${current}/${max}`,
					`🕒 **Recovery Time**: ${delta}`
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
			}
		}
	})
};
