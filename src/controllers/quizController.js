const mongoose = require("mongoose");
const { Quiz, QuizAssignment, Question, QuizAttempt, StudentAnswer, TeacherProfile } = require("../models");

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const isTransactionUnsupportedError = (error) => {
	const message = String(error?.message || "");
	return message.includes("Transaction numbers are only allowed") || message.includes("replica set");
};

const createQuiz = async (req, res) => {
	try {
		const {
			subject_id,
			creator_type,
			teacher_id,
			student_id,
			topic,
			title,
			questions,
			status,
			duration_minutes,
			passing_score,
			total_score_possible,
		} = req.body;
		if (!subject_id || !creator_type) {
			return res.status(400).json({ success: false, message: "subject_id and creator_type are required" });
		}

		const normalizedCreatorType = String(creator_type).toUpperCase();
		if (!["AI", "TEACHER"].includes(normalizedCreatorType)) {
			return res.status(400).json({ success: false, message: "creator_type must be AI or TEACHER" });
		}

		if (normalizedCreatorType === "TEACHER" && !teacher_id) {
			return res.status(400).json({ success: false, message: "teacher_id is required for TEACHER-created quizzes" });
		}

		if (normalizedCreatorType === "AI" && teacher_id) {
			return res.status(400).json({ success: false, message: "teacher_id must be null for AI-created quizzes" });
		}

		if (Array.isArray(questions) && questions.length > 0) {
			for (let i = 0; i < questions.length; i += 1) {
				const q = questions[i];
				if (!q.question_type || !q.question_text || q.correct_answer === undefined || !q.explanation) {
					return res.status(400).json({
						success: false,
						message: `Invalid question payload at index ${i}`,
					});
				}

				if (q.question_type === "MCQ" && (!Array.isArray(q.options) || q.options.length < 2)) {
					return res.status(400).json({
						success: false,
						message: `MCQ question at index ${i} must include at least 2 options`,
					});
				}
			}
		}

		const normalizedQuestions = Array.isArray(questions)
			? questions.map((q, index) => ({
					question_type: q.question_type,
					question_text: q.question_text,
					options:
						q.question_type === "TRUE_FALSE"
							? q.options || ["TRUE", "FALSE"]
							: Array.isArray(q.options)
								? q.options
								: undefined,
					correct_answer: q.correct_answer,
					points: q.points !== undefined ? Number(q.points) : 1,
					order_index: q.order_index !== undefined ? Number(q.order_index) : index + 1,
					hint: q.hint || null,
					explanation: q.explanation,
				}))
			: [];

		const calculatedTotalPossible = normalizedQuestions.reduce((sum, q) => sum + Number(q.points || 0), 0);
		const quizPayload = {
			subject_id,
			creator_type: normalizedCreatorType,
			teacher_id: normalizedCreatorType === "TEACHER" ? teacher_id : null,
			student_id: student_id || null,
			topic: topic || null,
			title: title || null,
			status: status || "DRAFT",
			duration_minutes: duration_minutes || null,
			passing_score: passing_score || null,
			total_score_possible:
				total_score_possible !== undefined ? Number(total_score_possible) : calculatedTotalPossible,
		};

		let quiz = null;
		let createdQuestions = [];

		const session = await mongoose.startSession();
		try {
			await session.withTransaction(async () => {
				const createdQuiz = await Quiz.create([quizPayload], { session });
				quiz = createdQuiz[0];

				if (normalizedQuestions.length > 0) {
					createdQuestions = await Question.insertMany(
						normalizedQuestions.map((q) => ({
							quiz_id: quiz._id,
							question_type: q.question_type,
							question_text: q.question_text,
							options: q.options,
							correct_answer: q.correct_answer,
							points: q.points,
							order_index: q.order_index,
							hint: q.hint,
							explanation: q.explanation,
						})),
						{ session }
					);
				}
			});
		} catch (txError) {
			if (!isTransactionUnsupportedError(txError)) {
				throw txError;
			}

			// Fallback for standalone MongoDB where transactions are not supported.
			quiz = await Quiz.create(quizPayload);
			try {
				if (normalizedQuestions.length > 0) {
					createdQuestions = await Question.insertMany(
						normalizedQuestions.map((q) => ({
							quiz_id: quiz._id,
							question_type: q.question_type,
							question_text: q.question_text,
							options: q.options,
							correct_answer: q.correct_answer,
							points: q.points,
							order_index: q.order_index,
							hint: q.hint,
							explanation: q.explanation,
						}))
					);
				}
			} catch (questionError) {
				await Quiz.findByIdAndDelete(quiz._id);
				throw questionError;
			}
		} finally {
			await session.endSession();
		}

		return res.status(201).json({ success: true, message: "Quiz created", data: { quiz, questions: createdQuestions } });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to create quiz", error: error.message });
	}
};

const assignQuizToClass = async (req, res) => {
	try {
		const { quiz_id, class_id, due_date } = req.body;
		if (!quiz_id || !class_id) return res.status(400).json({ success: false, message: "quiz_id and class_id are required" });

		const assignment = await QuizAssignment.create({
			quiz_id,
			class_id,
			due_date: due_date || null,
		});

		return res.status(201).json({ success: true, message: "Quiz assigned", data: assignment });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to assign quiz", error: error.message });
	}
};

const getAssignedQuizzesForClass = async (req, res) => {
	try {
		const { classId } = req.params;
		if (!isValidId(classId)) return res.status(400).json({ success: false, message: "Invalid class id" });

		const assignments = await QuizAssignment.find({ class_id: classId }).sort({ assigned_at: -1 });
		return res.status(200).json({ success: true, data: assignments });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to fetch assignments", error: error.message });
	}
};

const getQuizById = async (req, res) => {
	try {
		const { quizId } = req.params;
		if (!isValidId(quizId)) return res.status(400).json({ success: false, message: "Invalid quiz id" });

		const quiz = await Quiz.findById(quizId);
		if (!quiz) return res.status(404).json({ success: false, message: "Quiz not found" });

		const questions = await Question.find({ quiz_id: quiz._id }).sort({ order_index: 1, _id: 1 });
		return res.status(200).json({ success: true, data: { quiz, questions } });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to fetch quiz", error: error.message });
	}
};

const getMyCreatedQuizzes = async (req, res) => {
	try {
		if (!req.user?.id) {
			return res.status(401).json({ success: false, message: "Unauthorized" });
		}

		if (!isValidId(req.user.id)) {
			return res.status(401).json({
				success: false,
				message: "Invalid session token. Please login again.",
			});
		}

		const teacherProfile = await TeacherProfile.findOne({ user_id: req.user.id });
		if (!teacherProfile) {
			return res.status(200).json({ success: true, data: [] });
		}

		const teacherIds = [teacherProfile._id.toString()];
		if (isValidId(req.user.id) && req.user.id !== teacherProfile._id.toString()) {
			// Backward compatibility: some old records may have stored user id instead of teacher profile id.
			teacherIds.push(req.user.id);
		}

		const quizzes = await Quiz.find({
			creator_type: "TEACHER",
			teacher_id: { $in: teacherIds },
		}).sort({ created_at: -1 });

		return res.status(200).json({ success: true, data: quizzes });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to fetch created quizzes", error: error.message });
	}
};

const submitQuizAttempt = async (req, res) => {
	try {
		const { quiz_id, student_id, answers } = req.body;
		if (!quiz_id || !student_id || !Array.isArray(answers)) {
			return res.status(400).json({ success: false, message: "quiz_id, student_id and answers are required" });
		}

		const attempt = await QuizAttempt.create({
			quiz_id,
			student_id,
			started_at: new Date(),
			completed_at: new Date(),
		});

		let correctCount = 0;
		let earnedPoints = 0;
		let totalPossiblePoints = 0;
		const answerDocs = [];

		for (const entry of answers) {
			const question = await Question.findById(entry.question_id);
			if (!question) continue;

			const provided = String(entry.provided_answer || "").trim();
			const expected = String(question.correct_answer || "").trim();
			const isCorrect = provided.toLowerCase() === expected.toLowerCase();
			const points = Number(question.points || 1);
			totalPossiblePoints += points;
			if (isCorrect) correctCount += 1;
			if (isCorrect) earnedPoints += points;

			answerDocs.push({
				attempt_id: attempt._id,
				question_id: question._id,
				provided_answer: provided,
				is_correct: isCorrect,
				ai_feedback: null,
			});
		}

		if (answerDocs.length > 0) {
			await StudentAnswer.insertMany(answerDocs);
		}

		const quiz = await Quiz.findById(quiz_id).select("total_score_possible passing_score");
		const maxScore = Number(quiz?.total_score_possible || totalPossiblePoints || 0);
		const totalScore = maxScore === 0 ? 0 : (earnedPoints / maxScore) * 100;
		attempt.total_score = totalScore;
		await attempt.save();

		const passingScore = quiz?.passing_score !== null && quiz?.passing_score !== undefined ? Number(quiz.passing_score) : null;
		const passed = passingScore === null ? null : totalScore >= passingScore;

		return res.status(200).json({
			success: true,
			message: "Quiz submitted",
			data: {
				attempt,
				total_questions: answerDocs.length,
				correct_answers: correctCount,
				earned_points: earnedPoints,
				total_possible_points: maxScore,
				total_score: totalScore,
				passed,
			},
		});
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to submit quiz", error: error.message });
	}
};

module.exports = {
	createQuiz,
	assignQuizToClass,
	getAssignedQuizzesForClass,
	getQuizById,
	getMyCreatedQuizzes,
	submitQuizAttempt,
};
