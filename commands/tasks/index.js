const labels = { dailies: "Dailies", scratchCard: "Scratch card", weeklies: "Weeklies" };

const renderAccount = ({ account, snapshot, now, timezones }) => {
	const title = `${account.game?.name ?? account.platform} — ${account.uid}`;
	if (!snapshot || !Number.isFinite(snapshot.observedAt)) {
		return `${title}\nState unknown: no successful observation yet.`;
	}
	const stale = now - snapshot.observedAt > 5 * 60_000 || snapshot.observedAt > now;
	const lines = [title, `Observed ${new Date(snapshot.observedAt).toISOString()}`];
	if (stale || snapshot.lastFailure) {
		lines.push("State may be stale: the latest check could not establish current progress.");
	}
	let outstanding = 0;
	for (const [key, task] of Object.entries(snapshot.tasks ?? {})) {
		const deadline = new Date(task.deadline);
		const expired = !Number.isFinite(deadline.getTime()) || deadline.getTime() <= now;
		const status = stale || snapshot.lastFailure || expired ? "unknown" : task.status;
		if (task.deliveryFailure) {
			lines.push(`${labels[key] ?? key}: reminder delivery failed.`);
		}
		if (status === "resolved") {
			continue;
		}
		outstanding++;
		lines.push(`${labels[key] ?? key}: ${status === "pending" ? "unfinished" : "unknown"}`);
		if (expired) {
			lines.push("Waiting for evidence for the new period.");
		}
		else {
			for (const timeZone of timezones) {
				const local = new Intl.DateTimeFormat("en-US", {
					timeZone, weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short"
				}).format(deadline);
				lines.push(`Reset: ${local}`);
			}
		}
	}
	if (Object.keys(snapshot.tasks ?? {}).length === 0) {
		lines.push("No chore state is available.");
	}
	else if (outstanding === 0) {
		lines.push("All tracked chores are complete.");
	}
	if (snapshot.stamina?.deliveryFailure) {
		lines.push("Stamina reminder delivery failed.");
	}
	return lines.join("\n");
};

module.exports = {
	name: "tasks",
	description: "Show outstanding game chores, deadlines, and evidence freshness.",
	params: [],
	renderAccount,
	async run (context) {
		const reminders = app.Config.get("reminders");
		let reply;
		if (reminders?.enabled !== true) {
			reply = "The current task view requires deadline reminders to be enabled.";
		}
		else {
			const reminderStore = require("../../singleton/reminder-store.js");
			// eslint-disable-next-line object-curly-spacing
			const accounts = app.HoyoLab.getActiveAccounts({ blacklist: ["honkai", "tot"] });
			const views = [];
			for (const account of accounts) {
				const snapshot = await reminderStore.readSnapshot(account.platform, account.uid);
				views.push(renderAccount({
					account,
					snapshot,
					now: app.Date.now(),
					timezones: reminders.displayTimezones ?? ["UTC"]
				}));
			}
			reply = views.join("\n\n") || "No supported accounts are configured.";
		}
		return context.interaction
			? context.interaction.reply({ content: reply, ephemeral: true })
			: { success: true, reply };
	}
};
