const mongoose = require("mongoose");
const { User, StudentProfile, TeacherProfile } = require("../models");

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const getUsers = async (_req, res) => {
	try {
		const users = await User.find().select("_id email role created_at").sort({ created_at: -1 });
		return res.status(200).json({ success: true, data: users });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to fetch users", error: error.message });
	}
};

const getUserById = async (req, res) => {
	try {
		const { userId } = req.params;
		if (!isValidId(userId)) return res.status(400).json({ success: false, message: "Invalid user id" });

		const user = await User.findById(userId).select("_id email role created_at");
		if (!user) return res.status(404).json({ success: false, message: "User not found" });

		const profile =
			user.role === "STUDENT"
				? await StudentProfile.findOne({ user_id: user._id })
				: user.role === "TEACHER"
					? await TeacherProfile.findOne({ user_id: user._id })
					: null;

		return res.status(200).json({ success: true, data: { user, profile } });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to fetch user", error: error.message });
	}
};

const updateUser = async (req, res) => {
	try {
		const { userId } = req.params;
		const { email, role } = req.body;
		if (!isValidId(userId)) return res.status(400).json({ success: false, message: "Invalid user id" });

		const update = {};
		if (email) update.email = String(email).trim().toLowerCase();
		if (role) update.role = String(role).trim().toUpperCase();

		const user = await User.findByIdAndUpdate(userId, update, { new: true, runValidators: true }).select(
			"_id email role created_at"
		);
		if (!user) return res.status(404).json({ success: false, message: "User not found" });

		return res.status(200).json({ success: true, message: "User updated", data: user });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to update user", error: error.message });
	}
};

const deleteUser = async (req, res) => {
	try {
		const { userId } = req.params;
		if (!isValidId(userId)) return res.status(400).json({ success: false, message: "Invalid user id" });

		const user = await User.findById(userId);
		if (!user) return res.status(404).json({ success: false, message: "User not found" });

		await StudentProfile.deleteOne({ user_id: user._id });
		await TeacherProfile.deleteOne({ user_id: user._id });
		await User.findByIdAndDelete(user._id);

		return res.status(200).json({ success: true, message: "User deleted" });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to delete user", error: error.message });
	}
};

module.exports = {
	getUsers,
	getUserById,
	updateUser,
	deleteUser,
};
