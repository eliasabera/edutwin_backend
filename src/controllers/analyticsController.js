const mongoose = require("mongoose");
const { StudentEnrollment, QuizAssignment, QuizAttempt, StudentProfile, Class } = require("../models");

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const getClassAnalytics = async (req, res) => {
	try {
		const { classId } = req.params;
		if (!isValidId(classId)) return res.status(400).json({ success: false, message: "Invalid class id" });

		const enrolled = await StudentEnrollment.find({ class_id: classId });
		const assignments = await QuizAssignment.find({ class_id: classId });

		const studentIds = enrolled.map((e) => e.student_id);
		const quizIds = assignments.map((a) => a.quiz_id);

		const attempts = await QuizAttempt.find({
			student_id: { $in: studentIds },
			quiz_id: { $in: quizIds },
		});

		const avgScore =
			attempts.length === 0
				? 0
				: attempts.reduce((sum, item) => sum + Number(item.total_score || 0), 0) / attempts.length;

		return res.status(200).json({
			success: true,
			data: {
				class_id: classId,
				enrolled_students: enrolled.length,
				assigned_quizzes: assignments.length,
				attempts: attempts.length,
				average_score: Number(avgScore.toFixed(2)),
			},
		});
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to fetch class analytics", error: error.message });
	}
};

const getStudentAnalytics = async (req, res) => {
	try {
		const { studentId } = req.params;
		if (!isValidId(studentId)) return res.status(400).json({ success: false, message: "Invalid student id" });

		const student = await StudentProfile.findById(studentId);
		if (!student) return res.status(404).json({ success: false, message: "Student not found" });

		const attempts = await QuizAttempt.find({ student_id: studentId }).sort({ completed_at: -1 });
		const avgScore =
			attempts.length === 0
				? 0
				: attempts.reduce((sum, item) => sum + Number(item.total_score || 0), 0) / attempts.length;

		const classes = await StudentEnrollment.find({ student_id: studentId });

		return res.status(200).json({
			success: true,
			data: {
				student_id: studentId,
				attempts: attempts.length,
				average_score: Number(avgScore.toFixed(2)),
				enrolled_classes: classes.length,
			},
		});
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to fetch student analytics", error: error.message });
	}
};

module.exports = {
	getClassAnalytics,
	getStudentAnalytics,
};
