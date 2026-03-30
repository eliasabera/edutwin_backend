const mongoose = require("mongoose");
const { Textbook, InteractiveMetadata } = require("../models");

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const createTextbook = async (req, res) => {
	try {
		const { subject_id, title, pdf_url } = req.body;
		if (!subject_id || !title || !pdf_url) {
			return res.status(400).json({ success: false, message: "subject_id, title and pdf_url are required" });
		}

		const textbook = await Textbook.create({ subject_id, title: String(title).trim(), pdf_url });
		return res.status(201).json({ success: true, message: "Textbook created", data: textbook });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to create textbook", error: error.message });
	}
};

const getTextbooks = async (_req, res) => {
	try {
		const textbooks = await Textbook.find().sort({ title: 1 });
		return res.status(200).json({ success: true, data: textbooks });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to fetch textbooks", error: error.message });
	}
};

const getTextbookById = async (req, res) => {
	try {
		const { textbookId } = req.params;
		if (!isValidId(textbookId)) return res.status(400).json({ success: false, message: "Invalid textbook id" });

		const textbook = await Textbook.findById(textbookId);
		if (!textbook) return res.status(404).json({ success: false, message: "Textbook not found" });

		return res.status(200).json({ success: true, data: textbook });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to fetch textbook", error: error.message });
	}
};

const updateTextbook = async (req, res) => {
	try {
		const { textbookId } = req.params;
		const { subject_id, title, pdf_url } = req.body;
		if (!isValidId(textbookId)) return res.status(400).json({ success: false, message: "Invalid textbook id" });

		const textbook = await Textbook.findByIdAndUpdate(
			textbookId,
			{
				...(subject_id ? { subject_id } : {}),
				...(title ? { title: String(title).trim() } : {}),
				...(pdf_url ? { pdf_url } : {}),
			},
			{ new: true, runValidators: true }
		);

		if (!textbook) return res.status(404).json({ success: false, message: "Textbook not found" });
		return res.status(200).json({ success: true, message: "Textbook updated", data: textbook });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to update textbook", error: error.message });
	}
};

const deleteTextbook = async (req, res) => {
	try {
		const { textbookId } = req.params;
		if (!isValidId(textbookId)) return res.status(400).json({ success: false, message: "Invalid textbook id" });

		const textbook = await Textbook.findByIdAndDelete(textbookId);
		if (!textbook) return res.status(404).json({ success: false, message: "Textbook not found" });

		await InteractiveMetadata.deleteMany({ textbook_id: textbook._id });
		return res.status(200).json({ success: true, message: "Textbook deleted" });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to delete textbook", error: error.message });
	}
};

const addInteractiveMetadata = async (req, res) => {
	try {
		const { textbookId } = req.params;
		const { page_number, interaction_type, resource_id, parameters } = req.body;
		if (!isValidId(textbookId)) return res.status(400).json({ success: false, message: "Invalid textbook id" });
		if (!page_number || !interaction_type || !resource_id) {
			return res.status(400).json({ success: false, message: "page_number, interaction_type and resource_id are required" });
		}

		const metadata = await InteractiveMetadata.create({
			textbook_id: textbookId,
			page_number,
			interaction_type,
			resource_id,
			parameters: parameters || null,
		});

		return res.status(201).json({ success: true, message: "Interactive metadata added", data: metadata });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to add interactive metadata", error: error.message });
	}
};

module.exports = {
	createTextbook,
	getTextbooks,
	getTextbookById,
	updateTextbook,
	deleteTextbook,
	addInteractiveMetadata,
};
