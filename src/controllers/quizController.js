const mongoose = require("mongoose");
const axios = require("axios");
const { Quiz, QuizAssignment, Question, QuizAttempt, StudentAnswer, TeacherProfile, Subject, StudentProfile } = require("../models");

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const isTransactionUnsupportedError = (error) => {
	const message = String(error?.message || "");
	return message.includes("Transaction numbers are only allowed") || message.includes("replica set");
};
const AI_SERVICE_BASE_URL = process.env.AI_SERVICE_BASE_URL || "http://127.0.0.1:8000";

const normalizeAiQuestionType = (value) => {
	const raw = String(value || "").trim().toUpperCase().replace(/-/g, "_");
	if (raw === "MCQ") return "MCQ";
	if (raw === "TRUE_FALSE" || raw === "TRUEFALSE") return "TRUE_FALSE";
	if (raw === "SHORT" || raw === "SHORT_ANSWER") return "SHORT_ANSWER";
	return null;
};

const toNumericGrade = (value) => {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};

const resolveStudentProfileForRequest = async (req, body = {}) => {
	if (body.student_id && isValidId(body.student_id)) {
		const profile = await StudentProfile.findById(body.student_id);
		if (profile) return profile;
	}

	if (req.user?.id && isValidId(req.user.id)) {
		const profile = await StudentProfile.findOne({ user_id: req.user.id });
		if (profile) return profile;
	}

	return null;
};

const resolveStudentIdForAttempt = async (req, body = {}) => {
	if (body.student_id && isValidId(body.student_id)) {
		return body.student_id;
	}

	if (req.user?.id && isValidId(req.user.id)) {
		const profile = await StudentProfile.findOne({ user_id: req.user.id }).select("_id");
		if (profile?._id) {
			return String(profile._id);
		}
	}

	return null;
};

const resolveSubjectForRequest = async (body = {}) => {
	if (body.subject_id && isValidId(body.subject_id)) {
		const byId = await Subject.findById(body.subject_id);
		if (byId) return byId;
	}

	if (typeof body.subject === "string" && body.subject.trim()) {
		const subjectName = body.subject.trim();
		const existing = await Subject.findOne({ name: new RegExp(`^${subjectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
		if (existing) return existing;

		const gradeLevel = toNumericGrade(body.grade) || 1;
		return Subject.create({ name: subjectName, grade_level: gradeLevel });
	}

	return null;
};

const normalizeQuestionsPayload = (questions = []) =>
	Array.isArray(questions)
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

const dedupeByQuestionText = (questions = []) => {
	const seen = new Set();
	const deduped = [];

	for (const item of questions) {
		const key = String(item?.question_text || "").trim().toLowerCase();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		deduped.push(item);
	}

	return deduped;
};

const normalizeComparableText = (value = "") =>
	String(value)
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

const persistQuizWithQuestions = async (quizPayload, normalizedQuestions) => {
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

	return { quiz, createdQuestions };
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

		const normalizedQuestions = normalizeQuestionsPayload(questions);

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

		const { quiz, createdQuestions } = await persistQuizWithQuestions(quizPayload, normalizedQuestions);

		return res.status(201).json({ success: true, message: "Quiz created", data: { quiz, questions: createdQuestions } });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to create quiz", error: error.message });
	}
};

const generateAiPracticeQuiz = async (req, res) => {
	try {
		const {
			subject,
			subject_id,
			topic,
			num_questions,
			types,
			grade,
			student_profile,
			title,
			status,
			duration_minutes,
			passing_score,
		} = req.body;

		const subjectDoc = await resolveSubjectForRequest({ subject, subject_id, grade });
		if (!subjectDoc) {
			return res.status(400).json({
				success: false,
				message: "subject or valid subject_id is required",
			});
		}

		const studentProfile = await resolveStudentProfileForRequest(req, req.body);
		if (req.user?.role === "STUDENT" && !studentProfile) {
			return res.status(400).json({
				success: false,
				message: "Student profile is required to generate and save practice quizzes",
			});
		}

		const requestedCount = Math.max(1, Math.min(30, Number(num_questions) > 0 ? Number(num_questions) : 5));
		const requestedTypes = Array.isArray(types) && types.length > 0 ? types : ["mcq", "true_false", "short"];

		const baseAiPayload = {
			subject: subject || subjectDoc.name,
			topic: topic || subjectDoc.name,
			num_questions: requestedCount,
			types: requestedTypes,
			grade: grade || studentProfile?.grade_level || subjectDoc.grade_level || 9,
			student_profile:
				student_profile ||
				(studentProfile
					? {
						full_name: studentProfile.full_name,
						grade: String(studentProfile.grade_level || grade || 9),
					}
					: undefined),
		};

		const collectedAiQuestions = [];
		let lastAiData = null;
		let lastAiError = null;
		const maxAttempts = 2;
		let attemptsUsed = 0;

		for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
			if (collectedAiQuestions.length >= requestedCount) break;

			const remaining = requestedCount - collectedAiQuestions.length;
			const aiPayload = {
				...baseAiPayload,
				num_questions: remaining,
			};

			const timeoutMs = attempt === 0 ? 45000 : 35000;

			try {
				const { data } = await axios.post(`${AI_SERVICE_BASE_URL}/practice`, aiPayload, { timeout: timeoutMs });
				lastAiData = data;
				attemptsUsed += 1;
				const batch = Array.isArray(data?.questions) ? data.questions : [];
				if (batch.length === 0) continue;
				collectedAiQuestions.push(...batch);
			} catch (aiError) {
				lastAiError = aiError;
				continue;
			}
		}

		if (collectedAiQuestions.length === 0) {
			return res.status(502).json({
				success: false,
				message: "AI service did not return practice questions",
				error: lastAiError?.message || lastAiData?.error || "AI service unavailable",
				data: { raw: lastAiData || null },
			});
		}

		const normalizedQuestions = normalizeQuestionsPayload(
			collectedAiQuestions
				.map((q, index) => {
					const rawType = normalizeAiQuestionType(q.type);
					const questionText =
						typeof q.question === "string" && q.question.trim()
							? q.question.trim()
							: (typeof q.question_text === "string" ? q.question_text.trim() : "");
					const correctAnswer =
						typeof q.answer === "string" && q.answer.trim()
							? q.answer.trim()
							: (typeof q.correct_answer === "string" ? q.correct_answer.trim() : "");
					const explanationText =
						typeof q.explanation === "string" && q.explanation.trim()
							? q.explanation.trim()
							: "Review the chapter concept and compare your answer with the expected reasoning.";

					let questionType = rawType;
					let options = Array.isArray(q.options)
						? q.options.map((item) => String(item || "").trim()).filter(Boolean)
						: [];

					if (questionType === "TRUE_FALSE") {
						options = ["TRUE", "FALSE"];
					}

					if (questionType === "MCQ" && options.length < 2) {
						questionType = "SHORT_ANSWER";
						options = [];
					}

					return {
						question_type: questionType,
						question_text: questionText,
						options,
						correct_answer: correctAnswer,
						explanation: explanationText,
						points: 1,
						order_index: index + 1,
						hint:
							normalizeComparableText(
								typeof q.hint === "string" && q.hint.trim() ? q.hint.trim() : ""
							) === normalizeComparableText(explanationText)
								? null
								: (typeof q.hint === "string" && q.hint.trim() ? q.hint.trim() : null),
					};
				})
				.filter((q) => q.question_type && q.question_text && q.correct_answer !== undefined && q.explanation)
		);

		const dedupedQuestions = dedupeByQuestionText(normalizedQuestions)
			.slice(0, requestedCount)
			.map((question, index) => ({
				...question,
				order_index: index + 1,
			}));

		if (dedupedQuestions.length === 0) {
			return res.status(422).json({
				success: false,
				message: "AI response did not contain valid quiz question format",
				data: { raw: lastAiData || null },
			});
		}

		const calculatedTotalPossible = dedupedQuestions.reduce((sum, q) => sum + Number(q.points || 0), 0);
		const quizPayload = {
			subject_id: subjectDoc._id,
			creator_type: "AI",
			teacher_id: null,
			student_id: studentProfile?._id || null,
			topic: topic || subjectDoc.name,
			title: title || `${String(subjectDoc.name).toUpperCase()} AI Practice`,
			status: status || "DRAFT",
			duration_minutes: duration_minutes || null,
			passing_score: passing_score || null,
			total_score_possible: calculatedTotalPossible,
		};

		const { quiz, createdQuestions } = await persistQuizWithQuestions(quizPayload, dedupedQuestions);

		return res.status(201).json({
			success: true,
			message: "AI practice quiz generated",
			data: {
				quiz,
				questions: createdQuestions,
				ai_meta: {
					subject: baseAiPayload.subject,
					topic: baseAiPayload.topic,
					requested_questions: requestedCount,
					num_questions: dedupedQuestions.length,
					attempts_used: attemptsUsed,
				},
			},
		});
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to generate AI practice quiz", error: error.message });
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
		let subject = null;
		if (quiz.subject_id && isValidId(quiz.subject_id)) {
			const subjectDoc = await Subject.findById(quiz.subject_id).select("name");
			subject = subjectDoc?.name || null;
		}

		return res.status(200).json({ success: true, data: { quiz, subject, questions } });
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

const getMyPracticeQuizzes = async (req, res) => {
	try {
		if (!req.user?.id || !isValidId(req.user.id)) {
			return res.status(401).json({ success: false, message: "Unauthorized" });
		}

		const studentProfile = await StudentProfile.findOne({ user_id: req.user.id }).select("_id");
		if (!studentProfile) {
			return res.status(200).json({ success: true, data: [] });
		}

		const quizzes = await Quiz.find({
			creator_type: "AI",
			student_id: studentProfile._id,
		})
			.populate("subject_id", "name")
			.sort({ created_at: -1 })
			.lean();

		const quizIds = quizzes.map((item) => item._id);
		const counts = await Question.aggregate([
			{ $match: { quiz_id: { $in: quizIds } } },
			{ $group: { _id: "$quiz_id", count: { $sum: 1 } } },
		]);
		const countMap = new Map(counts.map((item) => [String(item._id), item.count]));

		const data = quizzes.map((item) => ({
			...item,
			subject_name: item?.subject_id?.name || null,
			question_count: countMap.get(String(item._id)) || 0,
		}));

		return res.status(200).json({ success: true, data });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to fetch practice quizzes", error: error.message });
	}
};

const getPracticeLibraryQuizzes = async (_req, res) => {
	try {
		const quizzes = await Quiz.find({
			creator_type: "TEACHER",
			status: "PUBLISHED",
		})
			.populate("subject_id", "name")
			.sort({ created_at: -1 })
			.limit(100)
			.lean();

		const quizIds = quizzes.map((item) => item._id);
		const counts = await Question.aggregate([
			{ $match: { quiz_id: { $in: quizIds } } },
			{ $group: { _id: "$quiz_id", count: { $sum: 1 } } },
		]);
		const countMap = new Map(counts.map((item) => [String(item._id), item.count]));

		const data = quizzes.map((item) => ({
			...item,
			subject_name: item?.subject_id?.name || null,
			question_count: countMap.get(String(item._id)) || 0,
		}));

		return res.status(200).json({ success: true, data });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to fetch practice library", error: error.message });
	}
};

const submitQuizAttempt = async (req, res) => {
	try {
		const { quiz_id, student_id, answers } = req.body;
		if (!quiz_id || !Array.isArray(answers)) {
			return res.status(400).json({ success: false, message: "quiz_id and answers are required" });
		}

		const resolvedStudentId = await resolveStudentIdForAttempt(req, { student_id });
		if (!resolvedStudentId) {
			return res.status(400).json({ success: false, message: "student_id is required or you must be logged in as a student" });
		}

		const attempt = await QuizAttempt.create({
			quiz_id,
			student_id: resolvedStudentId,
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
	getMyPracticeQuizzes,
	getPracticeLibraryQuizzes,
	submitQuizAttempt,
	generateAiPracticeQuiz,
};
