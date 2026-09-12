const fs = require("node:fs/promises");
const path = require("node:path");

module.exports = class ReminderStore {
	#filename;
	#loaded = false;
	#queue = Promise.resolve();
	#values = {};

	constructor ({ filename = "./data/reminders.json" } = {}) {
		this.#filename = filename;
	}

	async get (key) {
		await this.#queue;
		await this.#load();
		return structuredClone(this.#values[key]);
	}

	async set (key, value) {
		const operation = this.#queue.then(async () => {
			await this.#load();
			const nextValues = { ...this.#values, [key]: structuredClone(value) };
			await this.#save(nextValues);
			this.#values = nextValues;
		});
		this.#queue = operation.catch(() => {});
		return await operation;
	}

	async readSnapshot (platform, uid) {
		return await this.get(`reminders:snapshot:${platform}:${uid}`);
	}

	async #load () {
		if (this.#loaded) {
			return;
		}
		try {
			const parsed = JSON.parse(await fs.readFile(this.#filename, "utf8"));
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new TypeError("Reminder state root must be an object");
			}
			this.#values = parsed;
		}
		catch (e) {
			if (e.code !== "ENOENT") {
				throw new Error(`Cannot read durable reminder state: ${e.message}`, { cause: e });
			}
		}
		this.#loaded = true;
	}

	async #save (values) {
		const directory = path.dirname(this.#filename);
		await fs.mkdir(directory, { recursive: true });
		const temporary = path.join(directory, `.${path.basename(this.#filename)}.${process.pid}.${Date.now()}.tmp`);
		let handle;
		try {
			handle = await fs.open(temporary, "wx", 0o600);
			await handle.writeFile(JSON.stringify(values));
			await handle.sync();
			await handle.close();
			handle = null;
			await fs.rename(temporary, this.#filename);
			const directoryHandle = await fs.open(directory, "r");
			try {
				await directoryHandle.sync();
			}
			finally {
				await directoryHandle.close();
			}
		}
		finally {
			if (handle) {
				await handle.close();
			}
			await fs.rm(temporary, { force: true });
		}
	}
};
