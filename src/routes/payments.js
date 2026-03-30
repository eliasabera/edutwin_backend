const express = require("express");
const auth = require("../middleware/auth");
const roleCheck = require("../middleware/roleCheck");
const {
	createSubscription,
	createPaymentTransaction,
	getMySubscriptions,
	getMyTransactions,
} = require("../controllers/paymentController");

const router = express.Router();

router.get("/subscriptions", auth, getMySubscriptions);
router.get("/transactions", auth, getMyTransactions);
router.post("/subscriptions", auth, roleCheck("ADMIN", "TEACHER", "STUDENT"), createSubscription);
router.post("/transactions", auth, roleCheck("ADMIN", "TEACHER", "STUDENT"), createPaymentTransaction);

module.exports = router;
