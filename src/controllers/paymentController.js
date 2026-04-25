const axios = require("axios");
const {
	PaymentTransaction,
	StudentProfile,
	Subscription,
	User,
} = require("../models");

const CHAPA_API_BASE = "https://api.chapa.co/v1";
const CHAPA_SECRET_KEY = process.env.CHAPA_SECRET_KEY || "";
const CHAPA_CALLBACK_URL =
	process.env.CHAPA_CALLBACK_URL ||
	"http://localhost:5000/api/payments/chapa/callback";
const CHAPA_RETURN_URL =
	process.env.CHAPA_RETURN_URL || "https://example.com/edutwin/payment/success";

const flattenProviderMessage = (value) => {
	if (!value) return "";
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		return value.map((item) => flattenProviderMessage(item)).filter(Boolean).join(", ");
	}
	if (typeof value === "object") {
		return Object.entries(value)
			.map(([key, item]) => {
				const text = flattenProviderMessage(item);
				return text ? `${key}: ${text}` : "";
			})
			.filter(Boolean)
			.join(" | ");
	}
	return "";
};

const parseAmount = (value, fallback) => {
	const normalized = Number(value);
	if (!Number.isFinite(normalized) || normalized <= 0) return fallback;
	return Number(normalized.toFixed(2));
};

const generateTxRef = (userId, planType) => {
	const normalizedPlan = String(planType || "monthly").toLowerCase();
	const planCode = normalizedPlan === "yearly" ? "y" : "m";
	const userCode = String(userId || "usr").replace(/[^a-zA-Z0-9]/g, "").slice(-8) || "usr";
	const timeCode = Date.now().toString(36);
	const randomCode = Math.random().toString(36).slice(2, 8);
	return `et-${planCode}-${userCode}-${timeCode}${randomCode}`;
};

const normalizePlanAmount = (planType, requestedAmount) => {
	const plan = String(planType || "monthly").toLowerCase();
	if (plan === "monthly") {
		return parseAmount(requestedAmount, 149);
	}

	if (plan === "yearly") {
		return parseAmount(requestedAmount, 1490);
	}

	return parseAmount(requestedAmount, 149);
};

const normalizePlanDurationDays = (planType) => {
	const plan = String(planType || "monthly").toLowerCase();
	if (plan === "yearly") return 365;
	return 30;
};

const createOrUpdateSubscription = async ({ userId, planType, txRef, status }) => {
	const periodDays = normalizePlanDurationDays(planType);
	const periodEnd = new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000);

	return Subscription.findOneAndUpdate(
		{ user_id: userId, plan_type: String(planType || "monthly").toLowerCase() },
		{
			user_id: userId,
			stripe_customer_id: `chapa-${txRef}`,
			plan_type: String(planType || "monthly").toLowerCase(),
			status,
			current_period_end: periodEnd,
		},
		{ upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
	);
};

const createOrUpdateTransaction = async ({ userId, amount, currency, txRef, status }) => {
	const existing = await PaymentTransaction.findOne({ provider_reference: txRef });
	if (existing) {
		existing.status = status;
		existing.amount = Number(amount);
		existing.currency = String(currency || "ETB").toUpperCase();
		await existing.save();
		return existing;
	}

	return PaymentTransaction.create({
		user_id: userId,
		amount: Number(amount),
		currency: String(currency || "ETB").toUpperCase(),
		status,
		provider_reference: txRef,
		created_at: new Date(),
	});
};

const createSubscription = async (req, res) => {
	try {
		const { user_id, stripe_customer_id, plan_type, status, current_period_end } = req.body;
		if (!user_id || !stripe_customer_id || !plan_type || !status || !current_period_end) {
			return res.status(400).json({
				success: false,
				message: "user_id, stripe_customer_id, plan_type, status and current_period_end are required",
			});
		}

		const subscription = await Subscription.create({
			user_id,
			stripe_customer_id,
			plan_type,
			status,
			current_period_end,
		});

		return res.status(201).json({ success: true, message: "Subscription created", data: subscription });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to create subscription", error: error.message });
	}
};

const createPaymentTransaction = async (req, res) => {
	try {
		const { user_id, amount, currency, status, provider_reference } = req.body;
		if (!user_id || amount === undefined || !currency || !status || !provider_reference) {
			return res.status(400).json({
				success: false,
				message: "user_id, amount, currency, status and provider_reference are required",
			});
		}

		const tx = await PaymentTransaction.create({
			user_id,
			amount: Number(amount),
			currency,
			status,
			provider_reference,
			created_at: new Date(),
		});

		return res.status(201).json({ success: true, message: "Payment transaction created", data: tx });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to create transaction", error: error.message });
	}
};

const getMySubscriptions = async (req, res) => {
	try {
		const userId = req.user?.id || req.params.userId;
		if (!userId) return res.status(400).json({ success: false, message: "user id is required" });

		const subscriptions = await Subscription.find({ user_id: userId }).sort({ current_period_end: -1 });
		return res.status(200).json({ success: true, data: subscriptions });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to fetch subscriptions", error: error.message });
	}
};

const getMyTransactions = async (req, res) => {
	try {
		const userId = req.user?.id || req.params.userId;
		if (!userId) return res.status(400).json({ success: false, message: "user id is required" });

		const transactions = await PaymentTransaction.find({ user_id: userId }).sort({ created_at: -1 });
		return res.status(200).json({ success: true, data: transactions });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to fetch transactions", error: error.message });
	}
};

const initializeChapaSubscription = async (req, res) => {
	try {
		if (!CHAPA_SECRET_KEY) {
			return res.status(500).json({
				success: false,
				message: "Chapa secret key is missing on server",
			});
		}

		const userId = req.user?.id;
		if (!userId) {
			return res.status(401).json({ success: false, message: "Unauthorized" });
		}

		const { plan_type, amount, currency } = req.body || {};
		const planType = String(plan_type || "monthly").toLowerCase();
		const normalizedAmount = normalizePlanAmount(planType, amount);
		const normalizedCurrency = String(currency || "ETB").toUpperCase();

		const user = await User.findById(userId).select("email");
		if (!user?.email) {
			return res.status(404).json({ success: false, message: "User not found" });
		}

		const studentProfile = await StudentProfile.findOne({ user_id: userId }).select("full_name phone_number");
		const fullName = String(studentProfile?.full_name || "EduTwin Student").trim();
		const [firstNameRaw, ...rest] = fullName.split(" ").filter(Boolean);
		const firstName = firstNameRaw || "EduTwin";
		const lastName = rest.join(" ") || "Student";
		const txRef = generateTxRef(userId, planType);

		const payload = {
			amount: String(normalizedAmount),
			currency: normalizedCurrency,
			email: user.email,
			first_name: firstName,
			last_name: lastName,
			phone_number: studentProfile?.phone_number || undefined,
			tx_ref: txRef,
			callback_url: CHAPA_CALLBACK_URL,
			return_url: CHAPA_RETURN_URL,
			customization: {
				title: "EduTwin Monthly",
				description: `${planType} plan payment`,
			},
			meta: {
				user_id: String(userId),
				plan_type: planType,
			},
		};

		const chapaResponse = await axios.post(`${CHAPA_API_BASE}/transaction/initialize`, payload, {
			headers: {
				Authorization: `Bearer ${CHAPA_SECRET_KEY}`,
				"Content-Type": "application/json",
			},
			timeout: 20000,
		});

		const checkoutUrl = chapaResponse?.data?.data?.checkout_url;
		if (!checkoutUrl) {
			return res.status(502).json({
				success: false,
				message: "Chapa did not return checkout URL",
				data: chapaResponse?.data || null,
			});
		}

		await createOrUpdateTransaction({
			userId,
			amount: normalizedAmount,
			currency: normalizedCurrency,
			txRef,
			status: "pending",
		});

		return res.status(200).json({
			success: true,
			message: "Chapa checkout initialized",
			data: {
				tx_ref: txRef,
				checkout_url: checkoutUrl,
				plan_type: planType,
				amount: normalizedAmount,
				currency: normalizedCurrency,
			},
		});
	} catch (error) {
		const details = error?.response?.data || null;
		const providerMessage = flattenProviderMessage(details?.message || details?.error);
		return res.status(500).json({
			success: false,
			message: providerMessage
				? `Failed to initialize Chapa payment: ${providerMessage}`
				: "Failed to initialize Chapa payment",
			error: error.message,
			data: details,
		});
	}
};

const verifyChapaSubscription = async (req, res) => {
	try {
		if (!CHAPA_SECRET_KEY) {
			return res.status(500).json({
				success: false,
				message: "Chapa secret key is missing on server",
			});
		}

		const userId = req.user?.id;
		if (!userId) {
			return res.status(401).json({ success: false, message: "Unauthorized" });
		}

		const txRef = String(req.params.txRef || "").trim();
		if (!txRef) {
			return res.status(400).json({ success: false, message: "txRef is required" });
		}

		const chapaResponse = await axios.get(`${CHAPA_API_BASE}/transaction/verify/${encodeURIComponent(txRef)}`, {
			headers: {
				Authorization: `Bearer ${CHAPA_SECRET_KEY}`,
			},
			timeout: 20000,
		});

		const chapaData = chapaResponse?.data?.data || {};
		const chapaStatus = String(chapaData?.status || "").toLowerCase();
		const isSuccessful = chapaStatus === "success";
		const planType = String(chapaData?.meta?.plan_type || "monthly").toLowerCase();
		const paidAmount = parseAmount(chapaData?.amount, normalizePlanAmount(planType));
		const currency = String(chapaData?.currency || "ETB").toUpperCase();

		const tx = await createOrUpdateTransaction({
			userId,
			amount: paidAmount,
			currency,
			txRef,
			status: isSuccessful ? "success" : chapaStatus || "failed",
		});

		let subscription = null;
		if (isSuccessful) {
			subscription = await createOrUpdateSubscription({
				userId,
				planType,
				txRef,
				status: "active",
			});
		}

		return res.status(200).json({
			success: true,
			message: isSuccessful ? "Payment verified" : "Payment not completed",
			data: {
				verified: isSuccessful,
				status: chapaStatus,
				tx_ref: txRef,
				transaction: tx,
				subscription,
				chapa: chapaData,
			},
		});
	} catch (error) {
		const details = error?.response?.data || null;
		return res.status(500).json({
			success: false,
			message: "Failed to verify Chapa payment",
			error: error.message,
			data: details,
		});
	}
};

const chapaCallback = async (req, res) => {
	const txRef = String(req.body?.tx_ref || req.query?.tx_ref || "").trim();
	return res.status(200).json({
		success: true,
		message: "Callback received",
		data: {
			tx_ref: txRef || null,
		},
	});
};

module.exports = {
	createSubscription,
	createPaymentTransaction,
	getMySubscriptions,
	getMyTransactions,
	initializeChapaSubscription,
	verifyChapaSubscription,
	chapaCallback,
};
