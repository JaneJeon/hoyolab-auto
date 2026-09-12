const NotificationClass = Object.freeze({
	Action: "Action",
	Receipt: "Receipt"
});

const isNotificationClass = notificationClass => Object.values(NotificationClass).includes(notificationClass);

const platformAccepts = (platform, notificationClass) => {
	if (!isNotificationClass(notificationClass)) {
		throw new TypeError(`Unknown notification class: ${notificationClass}`);
	}

	return platform.notificationClasses === null
		|| platform.notificationClasses === undefined
		|| platform.notificationClasses.includes(notificationClass);
};

const selectPlatforms = (platforms, notificationClass) => platforms.filter(
	platform => platformAccepts(platform, notificationClass)
);

const sendPayload = async (platform, payload) => {
	const platformPayload = payload[platform.name];
	if (platformPayload === null || platformPayload === undefined) {
		return false;
	}

	if (typeof platformPayload === "object" && Object.hasOwn(platformPayload, "message")) {
		const options = typeof platformPayload.options === "function"
			? platformPayload.options(platform)
			: platformPayload.options ?? {};
		const sent = await platform.send(platformPayload.message, options);
		if (sent !== true) {
			throw new Error(`${platform.name} did not confirm notification delivery.`);
		}
	}
	else {
		const sent = await platform.send(platformPayload);
		if (sent !== true) {
			throw new Error(`${platform.name} did not confirm notification delivery.`);
		}
	}

	return true;
};

const dispatchNotification = async (notificationClass, payload, account) => {
	if (!isNotificationClass(notificationClass)) {
		throw new TypeError(`Unknown notification class: ${notificationClass}`);
	}
	if (!payload || typeof payload !== "object") {
		throw new TypeError("Notification payload must be an object.");
	}

	const platforms = selectPlatforms(app.Platform.getForAccount(account), notificationClass)
		.filter(platform => payload[platform.name] !== null && payload[platform.name] !== undefined);
	return Promise.all(platforms.map(platform => sendPayload(platform, payload)));
};

module.exports = {
	NotificationClass,
	dispatchNotification,
	isNotificationClass,
	platformAccepts,
	selectPlatforms,
	sendPayload
};
