const express = require("express");
const auth = require("../middleware/auth");
const roleCheck = require("../middleware/roleCheck");
const {
	createQuiz,
	assignQuizToClass,
	getAssignedQuizzesForClass,
	getQuizById,
	getMyCreatedQuizzes,
	submitQuizAttempt,
} = require("../controllers/quizController");

const router = express.Router();

router.get("/mine", auth, roleCheck("TEACHER"), getMyCreatedQuizzes);
router.get("/class/:classId/assignments", auth, getAssignedQuizzesForClass);
router.get("/:quizId", auth, getQuizById);
router.post("/", auth, roleCheck("ADMIN", "TEACHER"), createQuiz);
router.post("/assign", auth, roleCheck("ADMIN", "TEACHER"), assignQuizToClass);
router.post("/submit", auth, roleCheck("STUDENT", "ADMIN", "TEACHER"), submitQuizAttempt);

module.exports = router;
