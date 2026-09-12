const {
	fetchCodes,
	checkAndRedeem,
	buildMessage
} = require("./utils");
const { NotificationClass, dispatchNotification } = require("../../singleton/notification-dispatch.js");

module.exports = {
	name: "code-redeem",
	expression: "* * * * *",
	description: "Check and redeem codes for supported games from HoyoLab.",
	code: async function codeRedeem () {
		const accountData = app.HoyoLab.getActiveAccounts();

		if (accountData.length === 0) {
			app.Logger.info("No active accounts found");
			return;
		}

		const redeemDisabled = accountData.every((i) => i.redeemCode === false);
		if (redeemDisabled) {
			app.Logger.info("CodeRedeem", "All accounts have redeem disabled");

			return;
		}

		const codes = await fetchCodes();
		if (Object.values(codes).every((i) => i.length === 0)) {
			app.Logger.debug("CodeRedeem", {
				message: "No codes found"
			});

			return;
		}

		const result = await checkAndRedeem(codes);
		if (typeof result === "undefined") {
			return;
		}

		const { success, failed, manual } = result;
		if (success.length === 0 && failed.length === 0 && manual.length === 0) {
			return;
		}

		for (const data of success) {
			const message = buildMessage("success", data);
			const escapedMessage = app.Utils.escapeCharacters(message.telegram);
			await dispatchNotification(NotificationClass.Receipt, {
				telegram: escapedMessage,
				webhook: message.embed
			}, data.account);
		}

		for (const data of failed) {
			const message = buildMessage("failed", data);
			const escapedMessage = app.Utils.escapeCharacters(message.telegram);
			await dispatchNotification(NotificationClass.Receipt, {
				telegram: escapedMessage,
				webhook: message.embed
			}, data.account);
		}

		// manual entries are game-level (no account), so send to all platforms
		for (const data of manual) {
			const message = buildMessage("manual", data);
			const escapedMessage = app.Utils.escapeCharacters(message.telegram);
			await dispatchNotification(NotificationClass.Action, {
				telegram: escapedMessage,
				webhook: message.embed
			});
		}
	}
};
