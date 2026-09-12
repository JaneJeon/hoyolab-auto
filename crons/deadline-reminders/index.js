const {
	COMPLETION,
	classifyCompletion,
	getPeriod
} = require("../../object/deadline-reminder.js");
const ReminderState = require("../../object/reminder-state.js");
const reminderStore = require("../../singleton/reminder-store.js");
const { NotificationClass, dispatchNotification } = require("../../singleton/notification-dispatch.js");

const TWO_MINUTES = 120_000;
let running = false;

const cacheAdapter = reminderStore;

const serverOffset = (account) => {
	const configured = account.serverRegion ?? account.timezone;
	const offset = typeof configured === "string"
		? app.Date.REGION_OFFSETS[configured.toUpperCase()]
		: Number(configured);
	if (!Number.isFinite(offset)) {
		throw new TypeError(`No valid server region for ${account.platform}/${account.uid}`);
	}
	return offset;
};

const validProgress = (current, maximum) => typeof current === "number"
	&& typeof maximum === "number" && Number.isFinite(current)
	&& Number.isFinite(maximum) && maximum > 0 && current >= 0 && current <= maximum;

const freshStatus = (status, observedAt, now, period) => observedAt >= period.startAt.getTime()
	&& observedAt <= now && now - observedAt <= TWO_MINUTES
	? status
	: COMPLETION.UNKNOWN;

const weeklyCompletion = (type, weeklies) => {
	if (!weeklies || typeof weeklies !== "object") {
		return COMPLETION.UNKNOWN;
	}
	if (type === "starrail") {
		if (typeof weeklies.tournUnlocked !== "boolean") {
			return COMPLETION.UNKNOWN;
		}
		const bossValid = validProgress(weeklies.weeklyBoss, weeklies.weeklyBossLimit);
		const rogueValid = validProgress(weeklies.rogueScore, weeklies.maxScore);
		if (!bossValid || !rogueValid) {
			return COMPLETION.UNKNOWN;
		}
		const results = [Number(weeklies.weeklyBoss) === 0, Number(weeklies.rogueScore) === Number(weeklies.maxScore)];
		if (weeklies.tournUnlocked === true) {
			if (!validProgress(weeklies.tournScore, weeklies.tournMaxScore)) {
				return COMPLETION.UNKNOWN;
			}
			results.push(Number(weeklies.tournScore) === Number(weeklies.tournMaxScore));
		}
		return results.every(Boolean) ? COMPLETION.RESOLVED : COMPLETION.PENDING;
	}
	if (type === "nap") {
		if (!validProgress(weeklies.bounty, weeklies.bountyTotal)
			|| !validProgress(weeklies.surveyPoints, weeklies.surveyPointsTotal)) {
			return COMPLETION.UNKNOWN;
		}
		return Number(weeklies.bounty) === Number(weeklies.bountyTotal)
			&& Number(weeklies.surveyPoints) === Number(weeklies.surveyPointsTotal)
			? COMPLETION.RESOLVED
			: COMPLETION.PENDING;
	}
	if (type === "genshin") {
		return validProgress(weeklies.resinDiscount, weeklies.resinDiscountLimit)
			? (Number(weeklies.resinDiscount) === 0 ? COMPLETION.RESOLVED : COMPLETION.PENDING)
			: COMPLETION.UNKNOWN;
	}
	return COMPLETION.UNKNOWN;
};

const sendAction = async (account, data, title, description, fields = []) => {
	const region = app.HoyoLab.getRegion(account.region);
	const message = [
		`📢 ${title}`,
		`🎮 **Game**: ${data.assets.game}`,
		`🆔 **UID**: ${account.uid} ${account.nickname}`,
		`🌍 **Region**: ${region}`,
		description,
		...fields
	].join("\n");
	const embed = {
		color: data.assets.color,
		title,
		description,
		fields: fields.map((value, index) => ({ name: `Status ${index + 1}`, value, inline: true })),
		timestamp: new Date(),
		footer: { text: title, icon_url: data.assets.logo }
	};
	const results = await dispatchNotification(NotificationClass.Action, {
		telegram: app.Utils.escapeCharacters(message),
		webhook: {
			message: embed,
			options: webhook => ({
				content: webhook.createUserMention(account.discord),
				author: data.assets.author,
				icon: data.assets.logo
			})
		}
	}, account);
	if (!Array.isArray(results) || results.length === 0 || results.some(result => result !== true)) {
		throw new Error("No Action platform confirmed notification delivery");
	}
};

const evaluateTask = async ({ state, account, data, now, task, period, offsets, completion, description, fields, deliver = sendAction }) => {
	const outcome = await state.evaluate({
		scope: { game: account.platform, account: String(account.uid), task, serverPeriod: period.id },
		now,
		resetAt: period.resetAt,
		offsetHours: offsets,
		completion
	});
	if (outcome.rung === null) {
		return;
	}
	await deliver(account, data, `${task} Reminder (T-${outcome.rung}h)`, description, fields);
	await state.commitDelivery(outcome.delivery);
};

const updateStamina = async ({ account, data, observedAt, now, store = cacheAdapter, deliver = sendAction }) => {
	const stamina = data.stamina;
	const current = stamina?.currentStamina;
	const maximum = stamina?.maxStamina;
	const threshold = account.stamina?.threshold;
	if (typeof current !== "number" || typeof maximum !== "number" || typeof threshold !== "number"
		|| !Number.isFinite(current) || !Number.isFinite(maximum) || maximum <= 0
		|| current < 0 || current > maximum || !Number.isFinite(threshold)) {
		return;
	}
	if (!Number.isFinite(observedAt) || observedAt > now || now - observedAt > TWO_MINUTES) {
		return;
	}
	const key = `stamina-reminder:${JSON.stringify([account.platform, String(account.uid)])}`;
	const stored = await store.get(key) ?? { thresholdArmed: true, fullArmed: true };
	const state = { ...stored };
	if (current < threshold) {
		state.thresholdArmed = true;
	}
	if (current < maximum) {
		state.fullArmed = true;
	}
	await store.set(key, state);

	if (account.stamina?.check === false) {
		return;
	}
	if (current === maximum && state.fullArmed) {
		await deliver(account, data, "Stamina Full", "Your stamina is full.", [`🔋 ${Math.floor(current)}/${maximum}`]);
		state.fullArmed = false;
		state.thresholdArmed = false;
		await store.set(key, state);
	}
	else if (current >= threshold && state.thresholdArmed) {
		await deliver(account, data, "Stamina Reminder", "Your stamina reached its threshold.", [`🔋 ${Math.floor(current)}/${maximum}`]);
		state.thresholdArmed = false;
		await store.set(key, state);
	}
};

const runAccount = async (account, reminders, state, { store = cacheAdapter, deliver = sendAction } = {}) => {
	const platform = app.HoyoLab.get(account.platform);
	const notes = await platform.notes(account, { fresh: true });
	if (notes.success !== true || !Number.isFinite(notes.observedAt)) {
		throw new Error("Fresh notes were unavailable");
	}
	const { data, observedAt } = notes;
	const now = app.Date.now();
	const dailyPeriod = getPeriod({ now, serverOffsetMinutes: serverOffset(account), kind: "daily" });
	const weeklyPeriod = getPeriod({ now, serverOffsetMinutes: serverOffset(account), kind: "weekly" });
	const dailyCompletion = classifyCompletion({
		current: data.dailies?.task,
		maximum: data.dailies?.maxTask,
		observedAt,
		now,
		maxAgeMs: TWO_MINUTES,
		minObservedAt: dailyPeriod.startAt
	});
	const scratchStatus = account.platform === "nap"
		? freshStatus(data.cardSign === "Completed"
			? COMPLETION.RESOLVED
			: (data.cardSign === "Not Completed" ? COMPLETION.PENDING : COMPLETION.UNKNOWN), observedAt, now, dailyPeriod)
		: null;
	const weeklyStatus = freshStatus(weeklyCompletion(platform.type, data.weeklies), observedAt, now, weeklyPeriod);
	const snapshot = {
		observedAt,
		lastAttemptAt: now,
		lastFailure: null,
		stamina: data.stamina && {
			current: data.stamina.currentStamina,
			maximum: data.stamina.maxStamina,
			deliveryFailure: null
		},
		tasks: {}
	};
	if (account.dailiesCheck !== false) {
		snapshot.tasks.dailies = {
			period: dailyPeriod.id,
			deadline: dailyPeriod.resetAt.toISOString(),
			status: dailyCompletion.status,
			deliveryFailure: null
		};
	}
	if (account.platform === "nap") {
		snapshot.tasks.scratchCard = {
			period: dailyPeriod.id,
			deadline: dailyPeriod.resetAt.toISOString(),
			status: scratchStatus,
			deliveryFailure: null
		};
	}
	if (account.weekliesCheck !== false) {
		snapshot.tasks.weeklies = {
			period: weeklyPeriod.id,
			deadline: weeklyPeriod.resetAt.toISOString(),
			status: weeklyStatus,
			deliveryFailure: null
		};
	}
	const snapshotKey = `reminders:snapshot:${account.platform}:${account.uid}`;
	await store.set(snapshotKey, snapshot);

	const attempt = async (task, operation) => {
		try {
			await operation();
		}
		catch (e) {
			const target = task === "stamina" ? snapshot.stamina : snapshot.tasks[task];
			if (target) {
				target.deliveryFailure = { name: e.name ?? "Error", code: e.code ?? null };
			}
			app.Logger.error("Cron:DeadlineReminders", `Account ${account.platform}/${account.uid} ${task} delivery failed`);
		}
	};

	await attempt("stamina", async () => await updateStamina({ account, data, observedAt, now, store, deliver }));
	if (account.dailiesCheck !== false) {
		await attempt("dailies", async () => await evaluateTask({
			state,
			account,
			data,
			task: "Dailies",
			now,
			period: dailyPeriod,
			offsets: reminders.dailyOffsets,
			completion: dailyCompletion,
			description: "Complete your dailies before reset.",
			fields: [`📅 ${data.dailies?.task}/${data.dailies?.maxTask}`],
			deliver
		}));
	}
	if (account.platform === "nap") {
		await attempt("scratchCard", async () => await evaluateTask({
			state,
			account,
			data,
			task: "Howl's News Stand",
			now,
			period: dailyPeriod,
			offsets: reminders.dailyOffsets,
			completion: { status: scratchStatus },
			description: "Scratch today's News Stand card.",
			deliver
		}));
	}
	if (Array.isArray(reminders.weeklyOffsets) && account.weekliesCheck !== false) {
		await attempt("weeklies", async () => await evaluateTask({
			state,
			account,
			data,
			task: "Weeklies",
			now,
			period: weeklyPeriod,
			offsets: reminders.weeklyOffsets,
			completion: { status: weeklyStatus },
			description: "Complete your weeklies before Monday reset.",
			deliver
		}));
	}
	await store.set(snapshotKey, snapshot);
};

const run = async () => {
	const reminders = app.Config.get("reminders");
	if (reminders?.enabled !== true || running) {
		return;
	}
	running = true;
	try {
		const dailyOffsets = reminders.dailyOffsets ?? [20, 12, 7, 4, 2];
		const config = { ...reminders, dailyOffsets };
		const state = new ReminderState(cacheAdapter);
		// eslint-disable-next-line object-curly-spacing
		const accounts = app.HoyoLab.getActiveAccounts({ blacklist: ["honkai", "tot"] });
		for (const account of accounts) {
			try {
				await runAccount(account, config, state);
			}
			catch (e) {
				app.Logger.error("Cron:DeadlineReminders", `Account ${account.platform}/${account.uid} failed during reminder evaluation`);
				const snapshotKey = `reminders:snapshot:${account.platform}:${account.uid}`;
				const previous = await cacheAdapter.get(snapshotKey) ?? {};
				await cacheAdapter.set(snapshotKey, {
					...previous,
					lastAttemptAt: app.Date.now(),
					lastFailure: {
						name: e.name ?? "Error",
						code: e.code ?? null
					}
				});
			}
		}
	}
	finally {
		running = false;
	}
};

module.exports = {
	name: "deadline-reminders",
	expression: "*/2 * * * *",
	description: "Checks fresh game state and sends deadline-relative reminders.",
	code: run,
	runAccount,
	reminderStore,
	serverOffset,
	weeklyCompletion
};
