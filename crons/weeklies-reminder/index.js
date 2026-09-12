const { COMPLETION, getPeriod } = require("../../object/deadline-reminder.js");
const { weeklyDetails } = require("../deadline-reminders/index.js");
const { NotificationClass, dispatchNotification } = require("../../singleton/notification-dispatch.js");

const TWO_MINUTES = 120_000;
const RegionalTaskManager = new app.RegionalTaskManager();

const serverOffset = (account) => {
	const configured = account.serverRegion ?? account.timezone;
	const offset = typeof configured === "string"
		? app.Date.REGION_OFFSETS[configured.toUpperCase()]
		: Number(configured);
	return Number.isFinite(offset) ? offset : null;
};

const progressValue = component => component.status === COMPLETION.UNKNOWN
	? "unknown"
	: `${component.current}/${component.target}`;

RegionalTaskManager.registerTask("WeekliesReminder", 21, 0, async (account) => {
	if (account.weekliesCheck === false) {
		return;
	}

	const platform = app.HoyoLab.get(account.platform);
	const notes = await platform.notes(account, { fresh: true });
	if (notes.success !== true || !Number.isFinite(notes.observedAt)) {
		return;
	}

	const now = app.Date.now();
	const offset = serverOffset(account);
	if (!Number.isFinite(offset)) {
		return;
	}
	const period = getPeriod({ now, serverOffsetMinutes: offset, kind: "weekly" });
	if (notes.observedAt < period.startAt.getTime()
		|| notes.observedAt > now
		|| now - notes.observedAt > TWO_MINUTES) {
		return;
	}

	const weekly = weeklyDetails(platform.type, notes.data.weeklies);
	if (weekly.status !== COMPLETION.PENDING) {
		return;
	}

	const visibleComponents = weekly.components.filter(component => component.status !== COMPLETION.RESOLVED);
	const region = app.HoyoLab.getRegion(account.region);
	const fields = visibleComponents.map(component => ({
		name: component.label,
		value: progressValue(component),
		inline: true
	}));
	const message = [
		"📅 **Weeklies Reminder**",
		"",
		"👤 **Account**",
		`- **UID**: ${account.uid}`,
		`- **Username**: ${account.nickname}`,
		`- **Region**: ${region}`,
		"",
		"📊 **Progress**",
		...visibleComponents.map(component => `- **${component.label}**: ${progressValue(component)}`)
	].join("\n");
	const embed = {
		color: notes.data.assets.color,
		title: "Weeklies Reminder",
		author: {
			name: notes.data.assets.author,
			icon_url: notes.data.assets.logo
		},
		description: "Don't forget to complete your weeklies!",
		fields: [
			{ name: "UID", value: account.uid, inline: true },
			{ name: "Username", value: account.nickname, inline: true },
			{ name: "Region", value: region, inline: true },
			...fields
		],
		timestamp: new Date(),
		footer: {
			text: "Weeklies Reminder",
			icon_url: notes.data.assets.logo
		}
	};

	await dispatchNotification(NotificationClass.Action, {
		telegram: app.Utils.escapeCharacters(message),
		webhook: {
			message: embed,
			options: webhook => ({
				content: webhook.createUserMention(account.discord),
				author: notes.data.assets.author,
				icon: notes.data.assets.logo
			})
		}
	}, account);
});

module.exports = {
	name: "weeklies-reminder",
	expression: "*/5 * * * 0",
	description: "Reminds you to complete your weeklies.",
	code: (async function weekliesReminder () {
		// eslint-disable-next-line object-curly-spacing
		await RegionalTaskManager.executeTasks();
	})
};
