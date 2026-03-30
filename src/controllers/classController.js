const mongoose = require("mongoose");
const { Class, StudentEnrollment } = require("../models");

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const createClass = async (req, res) => {
	try {
		const { school_id, teacher_id, subject_id, name } = req.body;
		if (!school_id || !teacher_id || !subject_id || !name) {
			return res.status(400).json({ success: false, message: "school_id, teacher_id, subject_id and name are required" });
		}

		const classItem = await Class.create({ school_id, teacher_id, subject_id, name: String(name).trim() });
		return res.status(201).json({ success: true, message: "Class created", data: classItem });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to create class", error: error.message });
	}
};

const getClasses = async (_req, res) => {
	try {
		const classes = await Class.find().sort({ name: 1 });
		return res.status(200).json({ success: true, data: classes });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to fetch classes", error: error.message });
	}
};

const getClassById = async (req, res) => {
	try {
		const { classId } = req.params;
		if (!isValidId(classId)) return res.status(400).json({ success: false, message: "Invalid class id" });

		const classItem = await Class.findById(classId);
		if (!classItem) return res.status(404).json({ success: false, message: "Class not found" });

		return res.status(200).json({ success: true, data: classItem });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to fetch class", error: error.message });
	}
};

const updateClass = async (req, res) => {
	try {
		const { classId } = req.params;
		const { school_id, teacher_id, subject_id, name } = req.body;
		if (!isValidId(classId)) return res.status(400).json({ success: false, message: "Invalid class id" });

		const classItem = await Class.findByIdAndUpdate(
			classId,
			{
				...(school_id ? { school_id } : {}),
				...(teacher_id ? { teacher_id } : {}),
				...(subject_id ? { subject_id } : {}),
				...(name ? { name: String(name).trim() } : {}),
			},
			{ new: true, runValidators: true }
		);

		if (!classItem) return res.status(404).json({ success: false, message: "Class not found" });
		return res.status(200).json({ success: true, message: "Class updated", data: classItem });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to update class", error: error.message });
	}
};

const deleteClass = async (req, res) => {
	try {
		const { classId } = req.params;
		if (!isValidId(classId)) return res.status(400).json({ success: false, message: "Invalid class id" });

		const classItem = await Class.findByIdAndDelete(classId);
		if (!classItem) return res.status(404).json({ success: false, message: "Class not found" });

		await StudentEnrollment.deleteMany({ class_id: classItem._id });
		return res.status(200).json({ success: true, message: "Class deleted" });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to delete class", error: error.message });
	}
};

const enrollStudent = async (req, res) => {
	try {
		const { classId } = req.params;
		const { student_id } = req.body;
		if (!isValidId(classId) || !student_id || !isValidId(student_id)) {
			return res.status(400).json({ success: false, message: "Valid classId and student_id are required" });
		}

		const exists = await StudentEnrollment.findOne({ class_id: classId, student_id });
		if (exists) return res.status(409).json({ success: false, message: "Student already enrolled" });

		const enrollment = await StudentEnrollment.create({ class_id: classId, student_id });
		return res.status(201).json({ success: true, message: "Student enrolled", data: enrollment });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to enroll student", error: error.message });
	}
};

module.exports = {
	createClass,
	getClasses,
	getClassById,
	updateClass,
	deleteClass,
	enrollStudent,
};
