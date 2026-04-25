const express = require("express");
const auth = require("../middleware/auth");
const roleCheck = require("../middleware/roleCheck");
const {
	getStudentGamification,
	updateTwinProgress,
	updateMyTwinProgress,
	redeemLabBonusUnlock,
	awardAchievement,
} = require("../controllers/gamificationController");

const router = express.Router();

router.get("/student/:studentId", auth, roleCheck("ADMIN", "TEACHER", "STUDENT"), getStudentGamification);
router.put("/student/:studentId/progress", auth, roleCheck("ADMIN", "TEACHER"), updateTwinProgress);
router.put("/me/progress", auth, roleCheck("STUDENT", "ADMIN", "TEACHER"), updateMyTwinProgress);
router.post("/me/redeem-lab-bonus", auth, roleCheck("STUDENT", "ADMIN", "TEACHER"), redeemLabBonusUnlock);
router.post("/achievements/award", auth, roleCheck("ADMIN", "TEACHER"), awardAchievement);

module.exports = router;
