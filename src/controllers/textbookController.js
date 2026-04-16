const mongoose = require("mongoose");
const { Textbook, InteractiveMetadata, Subject } = require("../models");
const textbookCatalog = require("../config/textbookCatalog");

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const canonicalSubjectName = (value = "") => {
	const normalized = String(value || "").trim().toLowerCase();
	if (!normalized) return "";
	if (normalized === "math" || normalized === "maths" || normalized === "mathematics") {
		return "math";
	}
	if (normalized === "biology" || normalized === "chemistry" || normalized === "physics") {
		return normalized;
	}
	return normalized;
};

const subjectNameForDatabase = (canonical = "") => {
	if (canonical === "math") return "Math";
	if (canonical === "biology") return "Biology";
	if (canonical === "chemistry") return "Chemistry";
	if (canonical === "physics") return "Physics";
	return canonical ? canonical.charAt(0).toUpperCase() + canonical.slice(1) : "";
};

const parseGradeLevel = (value) => {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return null;
	return Math.trunc(parsed);
};

const syncCatalogToDatabase = async () => {
	const synced = [];

	for (const entry of textbookCatalog) {
		const canonicalSubject = canonicalSubjectName(entry.subject);
		const grade = parseGradeLevel(entry.grade);
		if (!canonicalSubject || !grade || !entry.pdf_url || !entry.title) {
			continue;
		}

		const dbSubjectName = subjectNameForDatabase(canonicalSubject);
		const subject = await Subject.findOneAndUpdate(
			{ name: dbSubjectName, grade_level: grade },
			{ name: dbSubjectName, grade_level: grade },
			{ upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
		);

		const textbook = await Textbook.findOneAndUpdate(
			{ subject_id: subject._id, title: String(entry.title).trim() },
			{ subject_id: subject._id, title: String(entry.title).trim(), pdf_url: String(entry.pdf_url).trim() },
			{ upsert: true, returnDocument: "after", setDefaultsOnInsert: true, runValidators: true }
		);

		synced.push({
			subject: canonicalSubject,
			grade,
			title: textbook.title,
			pdf_url: textbook.pdf_url,
		});
	}

	return synced;
};

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
			{ returnDocument: "after", runValidators: true }
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

const getTextbookCatalog = async (req, res) => {
	try {
		const requestedSubject = canonicalSubjectName(req.query.subject || "");
		const requestedGrade = parseGradeLevel(req.query.grade);

		const items = textbookCatalog
			.filter((entry) => {
				const entrySubject = canonicalSubjectName(entry.subject);
				const entryGrade = parseGradeLevel(entry.grade);

				if (requestedSubject && entrySubject !== requestedSubject) {
					return false;
				}
				if (requestedGrade && entryGrade !== requestedGrade) {
					return false;
				}
				return true;
			})
			.sort((a, b) => {
				const subjectOrder = canonicalSubjectName(a.subject).localeCompare(canonicalSubjectName(b.subject));
				if (subjectOrder !== 0) return subjectOrder;
				return parseGradeLevel(a.grade) - parseGradeLevel(b.grade);
			});

		return res.status(200).json({ success: true, data: items });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to load textbook catalog", error: error.message });
	}
};

const syncTextbookCatalog = async (_req, res) => {
	try {
		const synced = await syncCatalogToDatabase();
		return res.status(200).json({
			success: true,
			message: "Textbook catalog synced to database",
			count: synced.length,
			data: synced,
		});
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to sync textbook catalog", error: error.message });
	}
};

const resolveTextbook = async (req, res) => {
	try {
		await syncCatalogToDatabase();

		const requestedSubject = canonicalSubjectName(req.query.subject || "");
		const requestedGrade = parseGradeLevel(req.query.grade);

		if (!requestedSubject || !requestedGrade) {
			return res.status(400).json({
				success: false,
				message: "subject and grade query params are required",
			});
		}

		const dbSubjectName = subjectNameForDatabase(requestedSubject);
		const exactSubject = await Subject.findOne({
			name: dbSubjectName,
			grade_level: requestedGrade,
		});

		if (exactSubject) {
			const exactTextbook = await Textbook.findOne({ subject_id: exactSubject._id }).sort({ title: 1 });
			if (exactTextbook) {
				return res.status(200).json({
					success: true,
					data: {
						subject: requestedSubject,
						grade_requested: requestedGrade,
						grade_served: requestedGrade,
						title: exactTextbook.title,
						textbook_url: exactTextbook.pdf_url,
						source: "database",
					},
				});
			}
		}

		const subjectEntries = textbookCatalog.filter(
			(entry) => canonicalSubjectName(entry.subject) === requestedSubject
		);

		if (!subjectEntries.length) {
			return res.status(404).json({ success: false, message: "No textbook found for subject" });
		}

		const resolved = subjectEntries.find((entry) => parseGradeLevel(entry.grade) === requestedGrade);

		if (!resolved) {
			return res.status(404).json({ success: false, message: "No textbook found for subject and grade" });
		}

		const servedGrade = parseGradeLevel(resolved.grade);
		return res.status(200).json({
			success: true,
			data: {
				subject: requestedSubject,
				grade_requested: requestedGrade,
				grade_served: servedGrade,
				title: resolved.title,
				textbook_url: resolved.pdf_url,
				source: "catalog",
			},
		});
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to resolve textbook", error: error.message });
	}
};

module.exports = {
	createTextbook,
	getTextbooks,
	getTextbookById,
	updateTextbook,
	deleteTextbook,
	addInteractiveMetadata,
	getTextbookCatalog,
	syncTextbookCatalog,
	resolveTextbook,
};
