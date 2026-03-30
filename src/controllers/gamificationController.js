const mongoose = require("mongoose");
const { TwinProfile, Achievement, StudentAchievement } = require("../models");

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

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
		twinProfile.last_active = new Date();

		await twinProfile.save();
		return res.status(200).json({ success: true, message: "Twin profile updated", data: twinProfile });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to update twin profile", error: error.message });
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
	awardAchievement,
};
