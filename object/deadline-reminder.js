const COMPLETION = Object.freeze({
	PENDING: "pending",
	RESOLVED: "resolved",
	UNKNOWN: "unknown"
});

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const assertFinite = (value, name) => {
	if (!Number.isFinite(value)) {
		throw new TypeError(`${name} must be a finite number`);
	}
};

const classifyCompletion = ({ current, maximum, observedAt, now = Date.now(), maxAgeMs, minObservedAt }) => {
	if ((typeof current !== "number" && typeof current !== "string")
		|| (typeof maximum !== "number" && typeof maximum !== "string")
		|| (typeof current === "string" && current.trim() === "")
		|| (typeof maximum === "string" && maximum.trim() === "")) {
		return { status: COMPLETION.UNKNOWN, reason: "invalid" };
	}
	const observed = observedAt instanceof Date ? observedAt.getTime() : observedAt;
	const minimum = minObservedAt instanceof Date ? minObservedAt.getTime() : minObservedAt;
	const currentValue = Number(current);
	const maximumValue = Number(maximum);
	const ageLimit = maxAgeMs;

	if (!Number.isFinite(currentValue) || !Number.isFinite(maximumValue) || maximumValue <= 0
		|| currentValue < 0 || currentValue > maximumValue) {
		return { status: COMPLETION.UNKNOWN, reason: "invalid" };
	}
	if (!Number.isFinite(observed) || !Number.isFinite(now) || typeof ageLimit !== "number"
		|| !Number.isFinite(ageLimit) || ageLimit < 0 || observed > now || now - observed > ageLimit
		|| (minObservedAt !== undefined && (!Number.isFinite(minimum) || observed < minimum))) {
		return { status: COMPLETION.UNKNOWN, reason: "stale" };
	}

	return {
		status: currentValue === maximumValue ? COMPLETION.RESOLVED : COMPLETION.PENDING,
		reason: currentValue === maximumValue ? "complete" : "incomplete"
	};
};

const getPeriod = ({ now = Date.now(), serverOffsetMinutes, kind }) => {
	const instant = now instanceof Date ? now.getTime() : now;
	assertFinite(instant, "now");
	assertFinite(serverOffsetMinutes, "serverOffsetMinutes");
	if (kind !== "daily" && kind !== "weekly") {
		throw new TypeError("kind must be daily or weekly");
	}

	const offsetMs = serverOffsetMinutes * 60_000;
	const serverNow = new Date(instant + offsetMs);
	const boundary = Date.UTC(
		serverNow.getUTCFullYear(),
		serverNow.getUTCMonth(),
		serverNow.getUTCDate(),
		4
	);
	let currentBoundary = boundary;
	if (serverNow.getTime() < boundary) {
		currentBoundary -= DAY_MS;
	}

	if (kind === "weekly") {
		const weekday = new Date(currentBoundary).getUTCDay();
		const daysSinceMonday = (weekday + 6) % 7;
		currentBoundary -= daysSinceMonday * DAY_MS;
	}

	const periodMs = kind === "daily" ? DAY_MS : 7 * DAY_MS;
	const startAt = new Date(currentBoundary - offsetMs);
	const resetAt = new Date(currentBoundary + periodMs - offsetMs);
	return {
		id: `${kind}:${startAt.toISOString()}`,
		startAt,
		resetAt
	};
};

const rungInstants = ({ resetAt, offsetHours }) => {
	const reset = resetAt instanceof Date ? resetAt.getTime() : resetAt;
	assertFinite(reset, "resetAt");
	return offsetHours.map((offset) => {
		assertFinite(offset, "offsetHours entry");
		if (offset <= 0) {
			throw new RangeError("offsetHours entries must be positive");
		}
		return { offsetHours: offset, at: new Date(reset - offset * HOUR_MS) };
	}).sort((a, b) => a.at - b.at);
};

const selectDueRung = ({ now = Date.now(), resetAt, offsetHours, handledOffsets = []}) => {
	const instant = now instanceof Date ? now.getTime() : now;
	const reset = resetAt instanceof Date ? resetAt.getTime() : resetAt;
	assertFinite(instant, "now");
	assertFinite(reset, "resetAt");
	if (instant >= reset) {
		return { rung: null, crossedOffsets: []};
	}

	const handled = new Set(handledOffsets);
	const crossedOffsets = rungInstants({ resetAt: reset, offsetHours })
		.filter(({ at, offsetHours: offset }) => at.getTime() <= instant && !handled.has(offset))
		.map(({ offsetHours: offset }) => offset);
	return {
		rung: crossedOffsets.length === 0 ? null : Math.min(...crossedOffsets),
		crossedOffsets
	};
};

const parseClock = (value) => {
	const match = /^(\d{2}):(\d{2})$/.exec(value);
	if (!match) {
		throw new TypeError("active hour must use HH:MM");
	}
	const minutes = Number(match[1]) * 60 + Number(match[2]);
	if (Number(match[1]) > 23 || Number(match[2]) > 59) {
		throw new RangeError("active hour is outside a day");
	}
	return minutes;
};

const localClockMinutes = (instant, timeZone) => {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23"
	}).formatToParts(instant);
	const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
	return Number(values.hour) * 60 + Number(values.minute);
};

const coverageForZones = ({ resetAt, offsetHours, timezones, activeHours }) => {
	const from = parseClock(activeHours.from);
	const to = parseClock(activeHours.to);
	const isActive = minutes => from <= to
		? minutes >= from && minutes < to
		: minutes >= from || minutes < to;
	const rungs = rungInstants({ resetAt, offsetHours });

	return Object.fromEntries(timezones.map((timeZone) => {
		const reachable = rungs.filter(({ at }) => isActive(localClockMinutes(at, timeZone))).length;
		return [timeZone, { reachable, total: rungs.length }];
	}));
};

module.exports = {
	COMPLETION,
	classifyCompletion,
	coverageForZones,
	getPeriod,
	rungInstants,
	selectDueRung
};
