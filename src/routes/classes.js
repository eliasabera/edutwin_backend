const express = require("express");
const auth = require("../middleware/auth");
const roleCheck = require("../middleware/roleCheck");
const {
	createClass,
	getClasses,
	getClassById,
	updateClass,
	deleteClass,
	enrollStudent,
} = require("../controllers/classController");

const router = express.Router();

router.get("/", auth, getClasses);
router.get("/:classId", auth, getClassById);
router.post("/", auth, roleCheck("ADMIN", "TEACHER"), createClass);
router.put("/:classId", auth, roleCheck("ADMIN", "TEACHER"), updateClass);
router.delete("/:classId", auth, roleCheck("ADMIN", "TEACHER"), deleteClass);
router.post("/:classId/enroll", auth, roleCheck("ADMIN", "TEACHER"), enrollStudent);

module.exports = router;
