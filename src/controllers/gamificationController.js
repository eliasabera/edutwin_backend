const mongoose = require("mongoose");
const { TwinProfile, Achievement, StudentAchievement, StudentProfile } = require("../models");

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const toDateKey = (value) => {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	const year = date.getFullYear();
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");
	return `${year}-${month}-${day}`;
};

const getYesterdayKey = (todayKey) => {
	const date = new Date(`${todayKey}T00:00:00`);
	date.setDate(date.getDate() - 1);
	return toDateKey(date);
};

const normalizeSubject = (subject) => {
	const value = String(subject || "").trim().toLowerCase();
	if (["biology", "chemistry", "physics", "math"].includes(value)) {
		return value;
	}
	return null;
};

const normalizeSubjectList = (items) => {
	if (!Array.isArray(items)) return [];
	return items
		.map((item) => normalizeSubject(item))
		.filter(Boolean);
};

const ensureTwinProfile = async (studentId, updates = {}) => {
	let twinProfile = await TwinProfile.findOne({ student_id: studentId });
	if (!twinProfile) {
		twinProfile = await TwinProfile.create({
			student_id: studentId,
			performance_band: updates.performance_band || "medium",
			mastery_percentage: updates.mastery_percentage || 0,
			strong_subjects: Array.isArray(updates.strong_subjects) ? updates.strong_subjects : [],
			support_subjects: Array.isArray(updates.support_subjects) ? updates.support_subjects : [],
			subject_scores: updates.subject_scores && typeof updates.subject_scores === "object" ? updates.subject_scores : {},
			xp: 0,
			streak: updates.streak || 0,
		});
	} else if (!twinProfile.subject_scores || typeof twinProfile.subject_scores !== "object") {
		twinProfile.subject_scores = {};
	}
	return twinProfile;
};

const normalizeSubjectHistory = (value) => {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return value;
};

const updateSubjectHistory = (currentHistory, subject, completionPercent) => {
	const history = { ...normalizeSubjectHistory(currentHistory) };
	if (!subject || completionPercent === null || completionPercent === undefined) {
		return history;
	}

	const previous = history[subject] && typeof history[subject] === "object" ? history[subject] : {};
	const attempts = Number(previous.attempts || 0) + 1;
	const lastScore = Number(completionPercent);
	const previousAverage = typeof previous.average === "number" ? previous.average : lastScore;
	const average = Math.round((previousAverage * Math.max(0, attempts - 1) + lastScore) / attempts);

	history[subject] = {
		average,
		attempts,
		last_score: lastScore,
		updated_at: new Date(),
	};

	return history;
};

const deriveSubjectsFromHistory = (subjectHistory) => {
	const entries = Object.entries(normalizeSubjectHistory(subjectHistory))
		.map(([subject, details]) => ({
			subject,
			average: typeof details?.average === "number" ? details.average : null,
			attempts: Number(details?.attempts || 0),
		}))
		.filter((item) => item.average !== null);

	const strong = [];
	const support = [];

	for (const item of entries) {
		if (item.average >= 80 && item.attempts >= 1) {
			strong.push(item.subject);
		} else if (item.average <= 55 && item.attempts >= 1) {
			support.push(item.subject);
		}
	}

	return {
		strong_subjects: strong,
		support_subjects: support,
	};
};

const applyTwinUpdate = async (twinProfile, payload = {}) => {
	const todayKey = toDateKey(new Date());
	const lastActiveKey = twinProfile.last_active ? toDateKey(twinProfile.last_active) : null;

	const xpDelta = Number(payload.xp_delta || 0);
	twinProfile.xp = Math.max(0, Number(twinProfile.xp || 0) + xpDelta);

	if (lastActiveKey !== todayKey) {
		twinProfile.streak =
			lastActiveKey === getYesterdayKey(todayKey)
				? Number(twinProfile.streak || 0) + 1
				: 1;
	}

	const subject = normalizeSubject(payload.subject);
	const score = payload.score !== undefined ? Number(payload.score) : null;
	const totalQuestions = payload.totalQuestions !== undefined ? Number(payload.totalQuestions) : null;
	const completionPercent =
		score !== null && totalQuestions && totalQuestions > 0
			? Math.round((score / totalQuestions) * 100)
			: null;

	if (typeof payload.mastery_percentage === "number") {
		twinProfile.mastery_percentage = payload.mastery_percentage;
	} else if (completionPercent !== null) {
		twinProfile.mastery_percentage = Math.max(
			Number(twinProfile.mastery_percentage || 0),
			completionPercent,
		);
	}

	if (payload.performance_band) {
		twinProfile.performance_band = payload.performance_band;
	} else if (completionPercent !== null) {
		twinProfile.performance_band =
			completionPercent >= 80 ? "top" : completionPercent <= 55 ? "support" : "medium";
	}

	const strongSubjects = new Set(
		Array.isArray(twinProfile.strong_subjects) ? twinProfile.strong_subjects : [],
	);
	const supportSubjects = new Set(
		Array.isArray(twinProfile.support_subjects) ? twinProfile.support_subjects : [],
	);

	const payloadStrong = normalizeSubjectList(payload.strong_subjects);
	const payloadSupport = normalizeSubjectList(payload.support_subjects);
	for (const item of payloadStrong) {
		strongSubjects.add(item);
		supportSubjects.delete(item);
	}
	for (const item of payloadSupport) {
		supportSubjects.add(item);
		strongSubjects.delete(item);
	}

	if (subject) {
		if (completionPercent !== null) {
			twinProfile.subject_scores = updateSubjectHistory(twinProfile.subject_scores, subject, completionPercent);
			if (completionPercent >= 80) {
				strongSubjects.add(subject);
				supportSubjects.delete(subject);
			} else if (completionPercent <= 55) {
				supportSubjects.add(subject);
				strongSubjects.delete(subject);
			}
		}
	}

	const derived = deriveSubjectsFromHistory(twinProfile.subject_scores);
	for (const item of derived.strong_subjects) {
		strongSubjects.add(item);
		supportSubjects.delete(item);
	}
	for (const item of derived.support_subjects) {
		supportSubjects.add(item);
		strongSubjects.delete(item);
	}

	twinProfile.strong_subjects = Array.from(strongSubjects);
	twinProfile.support_subjects = Array.from(supportSubjects);
	twinProfile.last_active = new Date();

	await twinProfile.save();
	return twinProfile;
};

const getStudentGamification = async (req, res) => {
	try {
		const { studentId } = req.params;
		if (!isValidId(studentId)) return res.status(400).json({ success: false, message: "Invalid student id" });

		const twinProfile = await TwinProfile.findOne({ student_id: studentId });
		const achievements = await StudentAchievement.find({ student_id: studentId }).sort({ unlocked_at: -1 });

		return res.status(200).json({
			success: true,
			data: {
				twin_profile: twinProfile,
				unlocked_achievements: achievements,
			},
		});
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to fetch gamification data", error: error.message });
	}
};

const updateTwinProgress = async (req, res) => {
	try {
		const { studentId } = req.params;
		const { xp_delta = 0, streak, mastery_percentage, performance_band, support_subjects, strong_subjects } = req.body;
		if (!isValidId(studentId)) return res.status(400).json({ success: false, message: "Invalid student id" });

		let twinProfile = await TwinProfile.findOne({ student_id: studentId });
		if (!twinProfile) {
			twinProfile = await TwinProfile.create({
				student_id: studentId,
				performance_band: performance_band || "PROFICIENT",
				mastery_percentage: mastery_percentage || 0,
				strong_subjects: strong_subjects || [],
				support_subjects: support_subjects || [],
				subject_scores: {},
				xp: 0,
				streak: streak || 0,
			});
		}

		twinProfile.xp = Math.max(0, Number(twinProfile.xp || 0) + Number(xp_delta || 0));
		if (streak !== undefined) twinProfile.streak = Number(streak);
		if (mastery_percentage !== undefined) twinProfile.mastery_percentage = Number(mastery_percentage);
		if (performance_band) twinProfile.performance_band = performance_band;
		if (Array.isArray(support_subjects)) twinProfile.support_subjects = support_subjects;
		if (Array.isArray(strong_subjects)) twinProfile.strong_subjects = strong_subjects;
		if (req.body && typeof req.body.subject_scores === "object") twinProfile.subject_scores = req.body.subject_scores;
		twinProfile.last_active = new Date();

		await twinProfile.save();
		return res.status(200).json({ success: true, message: "Twin profile updated", data: twinProfile });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to update twin profile", error: error.message });
	}
};

const updateMyTwinProgress = async (req, res) => {
	try {
		if (!req.user?.id || !isValidId(req.user.id)) {
			return res.status(401).json({ success: false, message: "Unauthorized" });
		}

		const studentProfile = await require("../models").StudentProfile.findOne({ user_id: req.user.id }).select("_id");
		if (!studentProfile?._id) {
			return res.status(404).json({ success: false, message: "Student profile not found" });
		}

		const twinProfile = await ensureTwinProfile(studentProfile._id, req.body);
		const updated = await applyTwinUpdate(twinProfile, req.body);
		return res.status(200).json({ success: true, message: "Twin profile updated", data: updated });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to update twin profile", error: error.message });
	}
};

const redeemLabBonusUnlock = async (req, res) => {
	try {
		if (!req.user?.id || !isValidId(req.user.id)) {
			return res.status(401).json({ success: false, message: "Unauthorized" });
		}

		const studentProfile = await StudentProfile.findOne({ user_id: req.user.id }).select("_id");
		if (!studentProfile?._id) {
			return res.status(404).json({ success: false, message: "Student profile not found" });
		}

		let twinProfile = await TwinProfile.findOne({ student_id: studentProfile._id });
		if (!twinProfile) {
			twinProfile = await ensureTwinProfile(studentProfile._id, {});
		}

		if (twinProfile.lab_bonus_unlock) {
			return res.status(200).json({
				success: true,
				message: "Lab bonus already unlocked",
				data: twinProfile,
			});
		}

		const currentXp = Number(twinProfile.xp || 0);
		if (currentXp < 2000) {
			return res.status(400).json({
				success: false,
				message: "At least 2000 XP is required to unlock the lab bonus",
			});
		}

		twinProfile.lab_bonus_unlock = true;
		twinProfile.xp = 0;
		twinProfile.last_active = new Date();
		await twinProfile.save();

		return res.status(200).json({
			success: true,
			message: "Lab bonus unlocked",
			data: twinProfile,
		});
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to redeem lab bonus", error: error.message });
	}
};

const awardAchievement = async (req, res) => {
	try {
		const { student_id, achievement_id } = req.body;
		if (!student_id || !achievement_id) {
			return res.status(400).json({ success: false, message: "student_id and achievement_id are required" });
		}

		const achievement = await Achievement.findById(achievement_id);
		if (!achievement) return res.status(404).json({ success: false, message: "Achievement not found" });

		const existing = await StudentAchievement.findOne({ student_id, achievement_id });
		if (existing) return res.status(409).json({ success: false, message: "Achievement already unlocked" });

		const unlocked = await StudentAchievement.create({ student_id, achievement_id, unlocked_at: new Date() });
		return res.status(201).json({ success: true, message: "Achievement unlocked", data: unlocked });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to award achievement", error: error.message });
	}
};

module.exports = {
	getStudentGamification,
	updateTwinProgress,
	updateMyTwinProgress,
	redeemLabBonusUnlock,
	awardAchievement,
};
