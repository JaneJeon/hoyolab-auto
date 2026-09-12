const { NotificationClass } = require("../singleton/notification-dispatch.js");

const RECEIPT_FIELDS = [
	"tasksClaimed",
	"freeItemsClaimed",
	"itemsExchanged",
	"codesRedeemed",
	"lotteryDraws",
	"errors"
];

const splitAutomationReport = (data) => {
	const parts = [];
	if (RECEIPT_FIELDS.some(field => data[field]?.length > 0)) {
		parts.push({ notificationClass: NotificationClass.Receipt });
	}
	if (data.codesObtained?.length > 0) {
		parts.push({
			notificationClass: NotificationClass.Action,
			codes: [...data.codesObtained]
		});
	}

	return parts;
};

module.exports = { splitAutomationReport };
