const express = require("express");
const auth = require("../middleware/auth");
const roleCheck = require("../middleware/roleCheck");
const {
	createSchool,
	getSchools,
	getSchoolById,
	updateSchool,
	deleteSchool,
} = require("../controllers/schoolController");

const router = express.Router();

router.get("/", auth, getSchools);
router.get("/:schoolId", auth, getSchoolById);
router.post("/", auth, roleCheck("ADMIN"), createSchool);
router.put("/:schoolId", auth, roleCheck("ADMIN"), updateSchool);
router.delete("/:schoolId", auth, roleCheck("ADMIN"), deleteSchool);

module.exports = router;
