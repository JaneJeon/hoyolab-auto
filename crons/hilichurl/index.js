const { setTimeout: sleep } = require("node:timers/promises");
const config = require("../../config.js");
const { NotificationClass, dispatchNotification } = require("../../singleton/notification-dispatch.js");
const { splitAutomationReport } = require("../../object/notification-report.js");

module.exports = {
	name: "hilichurl",
	expression: "0 0 11 * * *",
	description: "This will run the Hilichurl Machine Workshop automation for Genshin Impact - completing tasks, claiming rewards, and exchanging for Primogems.",
	code: (async function hilichurl () {
		const jitterSeconds = config.crons?.hilichurlJitter ?? 0;
		if (jitterSeconds > 0) {
			const jitterMs = Math.floor(Math.random() * jitterSeconds * 1000);
			app.Logger.info("Cron:Hilichurl", `Applying ${(jitterMs / 1000).toFixed(1)}s jitter before starting...`);
			await sleep(jitterMs);
		}

		const accounts = app.HoyoLab.getActiveAccounts({ whitelist: "genshin" });
		if (accounts.length === 0) {
			app.Logger.debug("Cron:Hilichurl", "No active Genshin accounts found");
			return;
		}

		const platform = app.HoyoLab.get("genshin");
		if (!platform || typeof platform.hilichurl !== "function") {
			app.Logger.warn("Cron:Hilichurl", "Hilichurl method not found on Genshin platform");
			return;
		}

		for (const account of accounts) {
			if (account.hilichurl?.check === false) {
				app.Logger.debug("Cron:Hilichurl", `(${account.uid}) Hilichurl check disabled, skipping`);
				continue;
			}

			app.Logger.info("Cron:Hilichurl", `(${account.uid}) Running Hilichurl automation...`);

			try {
				const result = await platform.hilichurl(account);
				if (!result.success) {
					app.Logger.warn("Cron:Hilichurl", {
						message: "Hilichurl automation failed",
						uid: account.uid,
						error: result.message
					});
					const region = app.HoyoLab.getRegion(account.region);
					const failureText = [
						"🔧 *Hilichurl Workshop Run Failed*",
						`Region: ${region} | UID: ${account.uid}`,
						`Player: ${account.nickname}`,
						"",
						`❌ *Error:* ${result.message}`
					].join("\n");
					await dispatchNotification(NotificationClass.Receipt, {
						telegram: app.Utils.escapeCharacters(failureText),
						webhook: {
							color: 0xFF0000,
							title: "🔧 Hilichurl Workshop Run Failed",
							description: result.message,
							timestamp: new Date()
						}
					}, account);
					continue;
				}

				const { data } = result;

				const reportParts = splitAutomationReport(data);
				const hasActivity = reportParts.length > 0;
				const hasReceiptActivity = reportParts.some(part => part.notificationClass === NotificationClass.Receipt);

				if (!hasActivity) {
					app.Logger.debug("Cron:Hilichurl", `(${account.uid}) Genshin Impact: No new Hilichurl activity.`);
					continue;
				}

				const region = app.HoyoLab.getRegion(account.region);
				if (hasReceiptActivity) {
					const fields = [];

					if (data.tasksClaimed.length > 0) {
						const totalPoints = data.tasksClaimed.reduce((sum, t) => sum + t.points, 0);
						fields.push({
							name: "🎯 Tasks Claimed",
							value: data.tasksClaimed.map(t => `• ${t.name} (+${t.points})`).join("\n").slice(0, 1024),
							inline: false
						}, {
							name: "💰 Points Earned",
							value: `+${totalPoints} pts`,
							inline: true
						});
					}

					if (data.freeItemsClaimed?.length > 0) {
						fields.push({
							name: "🆓 Free Items Claimed",
							value: data.freeItemsClaimed.map(i => `• ${i}`).join("\n").slice(0, 1024),
							inline: false
						});
					}

					if (data.itemsExchanged.length > 0) {
						fields.push({
							name: "🎁 Items Exchanged",
							value: data.itemsExchanged.map(i => `• ${i.name} (-${i.cost} pts)`).join("\n").slice(0, 1024),
							inline: false
						});
					}

					if (data.codesRedeemed.length > 0) {
						fields.push({
							name: "✅ Codes Redeemed",
							value: data.codesRedeemed.join(", ").slice(0, 1024),
							inline: false
						});
					}

					fields.push({
						name: "💎 Current Points",
						value: `${data.points} pts`,
						inline: true
					});

					const currencyItem = data.shopStatus.find(i => i.name.toLowerCase().includes("primogem"));
					if (currencyItem && currencyItem.nextRefreshTime > 0) {
						const restockDate = new Date(Date.now() + (currencyItem.nextRefreshTime * 1000));
						fields.push({
							name: "⏰ Next Primogem Restock",
							value: `<t:${Math.floor(restockDate.getTime() / 1000)}:R>`,
							inline: true
						});
					}

					const embed = {
						color: data.assets.color,
						title: "🔧 Hilichurl Machine Workshop - Genshin Impact",
						author: {
							name: `${region} Server - ${account.nickname}`,
							icon_url: data.assets.logo
						},
						fields,
						thumbnail: {
							url: data.assets.logo
						},
						timestamp: new Date(),
						footer: {
							text: "Hilichurl Workshop Automation",
							icon_url: data.assets.logo
						}
					};

					const hasSignificantActivity = data.freeItemsClaimed?.length > 0
						|| data.itemsExchanged.length > 0
						|| data.codesRedeemed.length > 0;
					await dispatchNotification(NotificationClass.Receipt, {
						webhook: {
							message: embed,
							options: webhook => ({
								...(hasSignificantActivity && { content: webhook.createUserMention(account.discord) }),
								author: data.assets.author,
								icon: data.assets.logo
							})
						}
					}, account);
				}

				if (hasReceiptActivity) {
					const lines = [
						"🔧 *Hilichurl Machine Workshop* - Genshin Impact",
						`Region: ${region} | UID: ${account.uid}`,
						`Player: ${account.nickname}`,
						""
					];

					if (data.tasksClaimed.length > 0) {
						const totalPoints = data.tasksClaimed.reduce((sum, t) => sum + t.points, 0);
						lines.push(`🎯 Tasks Claimed: ${data.tasksClaimed.length} (+${totalPoints} pts)`);
					}

					if (data.freeItemsClaimed?.length > 0) {
						lines.push(`🆓 Free Items: ${data.freeItemsClaimed.length} claimed`);
					}

					if (data.itemsExchanged.length > 0) {
						lines.push(`🎁 Items Exchanged: ${data.itemsExchanged.map(i => i.name).join(", ")}`);
					}

					if (data.codesRedeemed.length > 0) {
						lines.push(`✅ Codes Redeemed: ${data.codesRedeemed.join(", ")}`);
					}

					lines.push(`💎 Current Points: ${data.points}`);

					const escapedMessage = app.Utils.escapeCharacters(lines.join("\n"));
					await dispatchNotification(NotificationClass.Receipt, { telegram: escapedMessage }, account);
				}

				if (data.codesObtained?.length > 0) {
					const actionLines = [
						"🎫 *Hilichurl Codes Need Manual Redemption* - Genshin Impact",
						`Region: ${region} | UID: ${account.uid}`,
						`Player: ${account.nickname}`,
						"",
						...data.codesObtained.map(code => `\`${code}\``)
					];
					await dispatchNotification(NotificationClass.Action, {
						telegram: app.Utils.escapeCharacters(actionLines.join("\n")),
						webhook: {
							message: {
								color: data.assets.color,
								title: "🎫 Hilichurl Codes Need Manual Redemption - Genshin Impact",
								description: data.codesObtained.map(code => `\`${code}\``).join("\n"),
								timestamp: new Date()
							},
							options: webhook => ({
								content: webhook.createUserMention(account.discord),
								author: data.assets.author,
								icon: data.assets.logo
							})
						}
					}, account);
				}

				app.Logger.info("Cron:Hilichurl", `(${account.uid}) Genshin Impact: Hilichurl automation completed.`);
			}
			catch (e) {
				app.Logger.error("Cron:Hilichurl", {
					message: "Error running Hilichurl automation",
					uid: account.uid,
					error: e.message
				});
			}
		}
	})
};
