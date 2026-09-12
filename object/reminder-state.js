const { COMPLETION, selectDueRung } = require("./deadline-reminder");

module.exports = class ReminderState {
	#adapter;
	#namespace;

	constructor (adapter, { namespace = "deadline-reminder" } = {}) {
		if (typeof adapter?.get !== "function" || typeof adapter?.set !== "function") {
			throw new TypeError("adapter must provide async get and set methods");
		}
		this.#adapter = adapter;
		this.#namespace = namespace;
	}

	async evaluate ({ scope, now = Date.now(), resetAt, offsetHours, completion }) {
		const key = this.#key(scope);
		const stored = await this.#adapter.get(key);
		const handledOffsets = Array.isArray(stored?.handledOffsets) ? stored.handledOffsets : [];

		if (completion?.status === COMPLETION.RESOLVED) {
			const state = { handledOffsets: [...new Set(offsetHours)], resolved: true };
			await this.#adapter.set(key, state);
			return { rung: null, delivery: null, ...state };
		}
		if (completion?.status !== COMPLETION.PENDING) {
			return { rung: null, delivery: null, handledOffsets, resolved: false, reason: "completion-unknown" };
		}
		if (stored?.resolved === true) {
			return { rung: null, delivery: null, handledOffsets, resolved: true };
		}

		const due = selectDueRung({ now, resetAt, offsetHours, handledOffsets });
		if (due.crossedOffsets.length === 0) {
			return { rung: null, delivery: null, handledOffsets, resolved: false };
		}
		return {
			rung: due.rung,
			delivery: {
				key,
				crossedOffsets: due.crossedOffsets
			},
			handledOffsets,
			resolved: false
		};
	}

	async commitDelivery (delivery) {
		if (typeof delivery?.key !== "string" || !Array.isArray(delivery.crossedOffsets)) {
			throw new TypeError("delivery must be returned by evaluate");
		}
		const stored = await this.#adapter.get(delivery.key);
		const handledOffsets = Array.isArray(stored?.handledOffsets) ? stored.handledOffsets : [];
		const state = {
			handledOffsets: [...new Set([...handledOffsets, ...delivery.crossedOffsets])].sort((a, b) => b - a),
			resolved: Boolean(stored?.resolved)
		};
		await this.#adapter.set(delivery.key, state);
		return state;
	}

	#key (scope) {
		const required = ["game", "account", "task", "serverPeriod"];
		for (const field of required) {
			if (typeof scope?.[field] !== "string" || scope[field].length === 0) {
				throw new TypeError(`scope.${field} must be a non-empty string`);
			}
		}
		return `${this.#namespace}:${JSON.stringify(required.map(field => scope[field]))}`;
	}
};
