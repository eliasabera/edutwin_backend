const express = require("express");
const auth = require("../middleware/auth");
const roleCheck = require("../middleware/roleCheck");
const {
	createQuiz,
	assignQuizToClass,
	getAssignedQuizzesForClass,
	getQuizById,
	getMyCreatedQuizzes,
	getAdminGeneratedQuizzes,
	getMyPracticeQuizzes,
	getPracticeLibraryQuizzes,
	submitQuizAttempt,
	generateAiPracticeQuiz,
	approveQuiz,
} = require("../controllers/quizController");

const router = express.Router();

router.get("/mine", auth, roleCheck("TEACHER"), getMyCreatedQuizzes);
router.get("/admin/generated", auth, roleCheck("ADMIN"), getAdminGeneratedQuizzes);
router.get("/library", auth, roleCheck("STUDENT", "ADMIN", "TEACHER"), getPracticeLibraryQuizzes);
router.get("/my-practice", auth, roleCheck("STUDENT", "ADMIN", "TEACHER"), getMyPracticeQuizzes);
router.get("/class/:classId/assignments", auth, getAssignedQuizzesForClass);
router.get("/:quizId", auth, getQuizById);
router.post("/generate/ai-practice", auth, roleCheck("STUDENT", "ADMIN", "TEACHER"), generateAiPracticeQuiz);
router.post("/", auth, roleCheck("ADMIN", "TEACHER"), createQuiz);
router.post("/assign", auth, roleCheck("ADMIN", "TEACHER"), assignQuizToClass);
router.patch("/:quizId/approve", auth, roleCheck("ADMIN"), approveQuiz);
router.post("/submit", auth, roleCheck("STUDENT", "ADMIN", "TEACHER"), submitQuizAttempt);

module.exports = router;
