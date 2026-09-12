const formatProgress = (current, target) => Number.isFinite(current) && Number.isFinite(target) && target > 0
	? `${current}/${target}`
	: "Unknown";

const formatDuration = seconds => Number.isFinite(seconds) && seconds >= 0
	? app.Utils.formatTime(seconds)
	: "Unknown";

const getNotesEmbedData = async (accounts, game, platformName) => {
	const embedData = [];
	const telegramMessages = [];
	for (const account of accounts) {
		const { stamina, expedition } = account;
		if (!stamina.check && !expedition.check) {
			continue;
		}

		const platform = app.HoyoLab.get(game);
		const notes = await platform.notes(account);
		if (notes.success === false) {
			continue;
		}

		if (platformName === "Discord") {
			const region = app.HoyoLab.getRegion(account.region);
			const { data } = notes;
			const { stamina, dailies, weeklies, expedition, realm } = data;

			const currentStamina = Math.round(stamina.currentStamina);
			const embed = {
				color: data.assets.color,
				author: {
					name: `${region} Server - ${account.nickname}`,
					icon_url: data.assets.logo
				},
				fields: [
					{
						name: `Current Stamina:`,
						value: `${formatProgress(currentStamina, stamina.maxStamina)}`
						+ `\nFull in:\n${formatDuration(stamina.recoveryTime)}`,
						inline: true
					}
				],
				timestamp: new Date(),
				footer: {
					text: `HoyoLab Notes - ${platform.fullName}`,
					icon_url: data.assets.logo
				}
			};

			if (platform.gameId === 2) {
				const { task, maxTask, storedAttendance, storedAttendanceRefresh } = dailies;

				const storedAttendanceText = `Stored Attendance: ${storedAttendance}`;
				const refreshText = `Refresh in: ${app.Utils.formatTime(storedAttendanceRefresh)}`;

				embed.fields.push(
					{
						name: "Dailies",
						value: formatProgress(task, maxTask),
						inline: true
					},
					{
						name: "Stored Attendance",
						value: `${storedAttendanceText}\n${refreshText}`,
						inline: true
					},
					{
						name: "Weekly Boss:",
						value: formatProgress(weeklies.resinDiscount, weeklies.resinDiscountLimit),
						inline: true
					},
					{
						name: "Realm Currency",
						value: `${formatProgress(realm.currentCoin, realm.maxCoin)}\nCapped in: ${app.Utils.formatTime(realm.recoveryTime)}`,
						inline: true
					},
					{
						name: "Expedition Status",
						value: expedition.list.map((i, idx) => `**Account ${idx + 1}** - ${app.Utils.formatTime(i.remaining_time)}`).join("\n"),
						inline: true
					}
				);
			}
			else if (platform.gameId === 6) {
				embed.fields.push(
					{
						name: "Dailies",
						value: formatProgress(dailies.task, dailies.maxTask),
						inline: true
					},
					{
						name: "Weekly Status:",
						value: `Echo of War claims remaining: ${formatProgress(weeklies.weeklyBoss, weeklies.weeklyBossLimit)}`
							+ `\nCyclical Points: ${formatProgress(weeklies.periodScore, weeklies.periodScoreTarget)}`,
						inline: false
					},
					{
						name: "Expedition Status",
						value: expedition.list.map((i, idx) => `**Account ${idx + 1}** - ${app.Utils.formatTime(i.remaining_time)}`).join("\n"),
						inline: true
					}
				);
			}
			else if (platform.gameId === 8) {
				embed.fields.push(
					{
						name: "Dailies",
						value: formatProgress(dailies.task, dailies.maxTask),
						inline: true
					},
					{
						name: "Shop Status",
						value: data.shop.state,
						inline: true
					},
					{
						name: "Weeklies",
						value: `Lost Void Bounty: ${formatProgress(weeklies.bounty, weeklies.bountyTotal)}`
							+ `\nRidu Weekly: ${formatProgress(weeklies.weeklyTaskPoints, weeklies.weeklyTaskTarget)}`,
						inline: true
					},
					{
						name: "Scratch Card",
						value: data.cardSign,
						inline: true
					}
				);
			}

			embedData.push(embed);
		}
		else if (platformName === "Telegram") {
			const { data } = notes;
			const { stamina, dailies, weeklies, expedition } = data;
			let message = "";
			if (platform.gameId === 2) {
				const { task, maxTask, storedAttendance, storedAttendanceRefresh } = dailies;

				const currentStamina = Math.floor(stamina.currentStamina);
				message = [
					`${account.nickname} - ${account.uid}`,
					`Current Stamina: ${formatProgress(currentStamina, stamina.maxStamina)}`
					+ `\nFull in: ${formatDuration(stamina.recoveryTime)}`,
					"Expedition Status",
					expedition.list.map((i, idx) => `Account ${idx + 1} - ${app.Utils.formatTime(i.remaining_time)}`).join("\n"),
					`Dailies: ${formatProgress(task, maxTask)}`,
					`Stored Attendance: ${storedAttendance}`,
					`Refresh in: ${app.Utils.formatTime(storedAttendanceRefresh)}`,
					`Weekly Boss Chance Remaining: ${formatProgress(weeklies.resinDiscount, weeklies.resinDiscountLimit)}`
				].join("\n");
			}
			else if (platform.gameId === 6) {
				message = [
					`${account.nickname} - ${account.uid}`,
					`Current Stamina: ${formatProgress(stamina.currentStamina, stamina.maxStamina)}`
					+ `\nFull in: ${formatDuration(stamina.recoveryTime)}`,
					"Expedition Status",
					expedition.list.map((i, idx) => `Account ${idx + 1} - ${app.Utils.formatTime(i.remaining_time)}`).join("\n"),
					`Dailies: ${formatProgress(dailies.task, dailies.maxTask)}`,
					"Weekly Status:",
					`Echo of War claims remaining: ${formatProgress(weeklies.weeklyBoss, weeklies.weeklyBossLimit)}`
					+ `\nCyclical Points: ${formatProgress(weeklies.periodScore, weeklies.periodScoreTarget)}`
				].join("\n");
			}
			else if (platform.gameId === 8) {
				message = [
					`${account.nickname} - ${account.uid}`,
					`Current Stamina: ${formatProgress(stamina.currentStamina, stamina.maxStamina)}`
					+ `\nFull in: ${formatDuration(stamina.recoveryTime)}`,
					`Dailies: ${formatProgress(dailies.task, dailies.maxTask)}`,
					`Lost Void Bounty: ${formatProgress(weeklies.bounty, weeklies.bountyTotal)}`,
					`Ridu Weekly: ${formatProgress(weeklies.weeklyTaskPoints, weeklies.weeklyTaskTarget)}`,
					`Shop Status: ${data.shop.state}`,
					`Howl Scratch Card: ${data.cardSign}`
				].join("\n");
			}

			telegramMessages.push(message);
		}
	}

	return { embedData, telegramMessages };
};

module.exports = {
	name: "notes",
	description: "Check your HoyoLab notes.",
	params: [
		{
			name: "game",
			description: "The game you want to check notes for.",
			type: "string",
			choices: [
				{ name: "Genshin Impact", value: "genshin" },
				{ name: "Honkai: Star Rail", value: "starrail" },
				{ name: "Zenless Zone Zero", value: "nap" }
			],
			required: true
		},
		{
			name: "account",
			description: "Select the account you want to check notes for. If not specified, will check all accounts.",
			type: "string",
			required: false,
			accounts: true
		}
	],
	run: (async function notes (context, game, uid) {
		const { interaction } = context;

		const supportedGames = app.HoyoLab.supportedGames({ blacklist: [
			"honkai",
			"tot"
		]});

		if (supportedGames.length === 0) {
			const message = "There are no accounts available for checking notes.";
			return interaction
				? interaction.reply({ content: message, ephemeral: true })
				: { success: false, reply: message };
		}

		if (!game) {
			const message = `Please specify a game. Supported games are: ${supportedGames.join(", ")}`;
			return interaction
				? interaction.reply({ content: message, ephemeral: true })
				: { success: false, reply: message.replace(/nap/, "zenless") };
		}

		game = game.toLowerCase() === "zenless" || game.toLowerCase() === "zzz" ? "nap" : game.toLowerCase();

		if (!supportedGames.includes(game)) {
			const message = `Invalid game specified. Supported games are: ${supportedGames.join(", ")}`;
			return interaction
				? interaction.reply({ content: message, ephemeral: true })
				: { success: false, reply: message.replace(/nap/, "zenless") };
		}

		const accounts = app.HoyoLab.getActiveAccounts({ whitelist: game, uid });
		if (accounts.length === 0) {
			const message = "You don't have any accounts for that game.";
			return interaction
				? interaction.reply({ content: message, ephemeral: true })
				: { success: false, reply: message };
		}

		if (accounts.length === 1) {
			const [account] = accounts;
			const { stamina, expedition } = account;

			if (!stamina.check && !expedition.check) {
				const message = "This account has no notes to check.";
				return interaction
					? interaction.reply({ content: message, ephemeral: true })
					: { success: false, reply: message };
			}
		}

		const { embedData, telegramMessages } = await getNotesEmbedData(accounts, game, context.platform.name);

		if (interaction) {
			await interaction.reply({ embeds: embedData, ephemeral: true });
		}
		else {
			return { success: true, reply: telegramMessages.join("\n\n") };
		}
	})
};
