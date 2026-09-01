let version;

const fetchData = async () => {
	if (typeof version === "undefined") {
		try {
			const { execSync } = require("child_process");
			const hash = execSync("git rev-parse --short HEAD").toString().trim();

			version = `HoyoLabAuto@${hash}`;
		}
		catch {
			version = "HoyoLabAuto";
		}
	}

	const res = await app.Got("API", {
		url: "https://api.ennead.cc/mihoyo/zenless/codes",
		responseType: "json",
		throwHttpErrors: false,
		headers: {
			"User-Agent": version
		}
	});

	// null, not [], so the caller can tell a broken source from a quiet day.
	// Both used to yield [], which made a dead feed look exactly like "no new
	// codes today" and let redemption stop silently and indefinitely.
	if (res.statusCode !== 200) {
		app.Logger.debug("ZenlessAPI", {
			statusCode: res.statusCode
		});

		return null;
	}

	const codes = res.body.active;
	if (!Array.isArray(codes)) {
		app.Logger.debug("ZenlessAPI", {
			message: "API returned malformed data",
			body: res.body
		});

		return null;
	}

	return codes.map((i) => ({
		code: i.code,
		rewards: i.rewards,
		source: "zenless-api"
	}));
};

const redeemCodes = async (accountData, code) => {
	const Cookie = app.HoyoLab.parseCookie(accountData.cookie, {
		whitelist: ["cookie_token_v2", "account_mid_v2", "account_id_v2", "cookie_token", "account_id"]
	});

	const res = await app.Got("HoYoLab", {
		url: "https://public-operation-nap.hoyoverse.com/common/apicdkey/api/webExchangeCdkey",
		searchParams: {
			uid: accountData.uid,
			region: accountData.region,
			lang: "en",
			cdkey: code.code,
			game_biz: "nap_global",
			t: app.Date.now()
		},
		headers: { Cookie }
	});

	if (res.statusCode !== 200) {
		throw new app.Error({
			message: "API returned non-200 status code",
			args: {
				statusCode: res.statusCode,
				body: res.body
			}
		});
	}

	// The retcode is logged and returned, not just branched on. Telling a dead
	// credential apart from an already-used code needs the number: the vendor's
	// message is a localised human string, and matching on it is the antipattern
	// that makes Mimo's credential detection unreliable. Nobody has recorded
	// which retcodes this endpoint actually returns, so logging it is what
	// builds that inventory out of real traffic.
	const retcode = res.body.retcode;
	if (retcode === -2001 || retcode === -2003) {
		app.Logger.log(`CodeRedeem:Zenless:${accountData.uid}`, {
			code: code.code,
			retcode,
			message: "Expired or invalid code"
		});

		return {
			success: false,
			retcode,
			reason: "Expired or invalid code"
		};
	}

	if (retcode !== 0) {
		app.Logger.info(`CodeRedeem:Zenless:${accountData.uid}`, `${code.code} - retcode ${retcode}: ${res.body.message}`);
		return {
			success: false,
			retcode,
			reason: res.body.message
		};
	}

	app.Logger.info(`CodeRedeem:Zenless:${accountData.uid}`, `${code.code} - Redeemed`);
	return {
		success: true,
		retcode
	};
};

module.exports = {
	fetchData,
	redeemCodes
};
