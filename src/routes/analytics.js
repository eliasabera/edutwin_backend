const express = require("express");
const auth = require("../middleware/auth");
const roleCheck = require("../middleware/roleCheck");
const { getClassAnalytics, getStudentAnalytics } = require("../controllers/analyticsController");

const router = express.Router();

router.get("/class/:classId", auth, roleCheck("ADMIN", "TEACHER"), getClassAnalytics);
router.get("/student/:studentId", auth, roleCheck("ADMIN", "TEACHER", "STUDENT"), getStudentAnalytics);

module.exports = router;
