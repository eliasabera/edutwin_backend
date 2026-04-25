const express = require("express");
const auth = require("../middleware/auth");
const roleCheck = require("../middleware/roleCheck");
const {
	createSubscription,
	createPaymentTransaction,
	getMySubscriptions,
	getMyTransactions,
	initializeChapaSubscription,
	verifyChapaSubscription,
	chapaCallback,
} = require("../controllers/paymentController");

const router = express.Router();

router.post("/chapa/callback", chapaCallback);
router.get("/chapa/callback", chapaCallback);
router.get("/subscriptions", auth, getMySubscriptions);
router.get("/transactions", auth, getMyTransactions);
router.post("/chapa/initialize", auth, roleCheck("ADMIN", "TEACHER", "STUDENT"), initializeChapaSubscription);
router.get("/chapa/verify/:txRef", auth, roleCheck("ADMIN", "TEACHER", "STUDENT"), verifyChapaSubscription);
router.post("/subscriptions", auth, roleCheck("ADMIN", "TEACHER", "STUDENT"), createSubscription);
router.post("/transactions", auth, roleCheck("ADMIN", "TEACHER", "STUDENT"), createPaymentTransaction);

module.exports = router;
