const mongoose = require("mongoose");
const { School } = require("../models");

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const createSchool = async (req, res) => {
	try {
		const { name } = req.body;
		if (!name) return res.status(400).json({ success: false, message: "name is required" });

		const school = await School.create({ name: String(name).trim() });
		return res.status(201).json({ success: true, message: "School created", data: school });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to create school", error: error.message });
	}
};

const getSchools = async (_req, res) => {
	try {
		const schools = await School.find().sort({ name: 1 });
		return res.status(200).json({ success: true, data: schools });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to fetch schools", error: error.message });
	}
};

const getSchoolById = async (req, res) => {
	try {
		const { schoolId } = req.params;
		if (!isValidId(schoolId)) return res.status(400).json({ success: false, message: "Invalid school id" });

		const school = await School.findById(schoolId);
		if (!school) return res.status(404).json({ success: false, message: "School not found" });

		return res.status(200).json({ success: true, data: school });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to fetch school", error: error.message });
	}
};

const updateSchool = async (req, res) => {
	try {
		const { schoolId } = req.params;
		const { name } = req.body;
		if (!isValidId(schoolId)) return res.status(400).json({ success: false, message: "Invalid school id" });

		const school = await School.findByIdAndUpdate(
			schoolId,
			{ ...(name ? { name: String(name).trim() } : {}) },
			{ new: true, runValidators: true }
		);
		if (!school) return res.status(404).json({ success: false, message: "School not found" });

		return res.status(200).json({ success: true, message: "School updated", data: school });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to update school", error: error.message });
	}
};

const deleteSchool = async (req, res) => {
	try {
		const { schoolId } = req.params;
		if (!isValidId(schoolId)) return res.status(400).json({ success: false, message: "Invalid school id" });

		const school = await School.findByIdAndDelete(schoolId);
		if (!school) return res.status(404).json({ success: false, message: "School not found" });

		return res.status(200).json({ success: true, message: "School deleted" });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to delete school", error: error.message });
	}
};

module.exports = {
	createSchool,
	getSchools,
	getSchoolById,
	updateSchool,
	deleteSchool,
};
