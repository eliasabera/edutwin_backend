const express = require("express");
const auth = require("../middleware/auth");
const roleCheck = require("../middleware/roleCheck");
const {
  getTeachers,
  getTeacherByUserId,
  getMyTeacherProfile,
  getMyTeacherDashboard,
  updateMyTeacherProfile,
} = require("../controllers/teacherController");

const router = express.Router();

router.get("/me", auth, roleCheck("TEACHER", "ADMIN"), getMyTeacherProfile);
router.get("/me/dashboard", auth, roleCheck("TEACHER"), getMyTeacherDashboard);
router.patch("/me", auth, roleCheck("TEACHER"), updateMyTeacherProfile);
router.put("/me", auth, roleCheck("TEACHER"), updateMyTeacherProfile);
router.get("/", auth, roleCheck("ADMIN"), getTeachers);
router.get("/:userId", auth, roleCheck("ADMIN", "TEACHER"), getTeacherByUserId);

module.exports = router;
