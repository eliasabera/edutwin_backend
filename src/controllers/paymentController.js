const { Subscription, PaymentTransaction } = require("../models");

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

module.exports = {
	createSubscription,
	createPaymentTransaction,
	getMySubscriptions,
	getMyTransactions,
};
