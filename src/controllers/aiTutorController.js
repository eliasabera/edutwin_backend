const mongoose = require("mongoose");
const axios = require("axios");
const { ChatSession, ChatMessage, Subject, StudentProfile } = require("../models");

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const AI_SERVICE_BASE_URL = process.env.AI_SERVICE_BASE_URL || "http://127.0.0.1:8000";
const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toQuestion = (body = {}) => body.question || body.message_text;

const toNumericGrade = (value) => {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};

const buildAiPayload = (body = {}) => ({
	question: toQuestion(body),
	subject: body.subject || body.subject_id || null,
	history: Array.isArray(body.history) ? body.history : [],
	student_profile: body.student_profile || null,
	grade: body.grade || body.student_profile?.grade || body.student_profile?.grade_level || null,
});

const persistMessages = async (session, question, answer) => {
	if (!session) return;

	await ChatMessage.create({
		session_id: session._id,
		sender: "USER",
		message_text: question,
		timestamp: new Date(),
	});

	await ChatMessage.create({
		session_id: session._id,
		sender: "AI",
		message_text: answer,
		timestamp: new Date(),
	});
};

const generateAiReply = async (body = {}) => {
	const payload = buildAiPayload(body);
	const question = payload.question;

	if (!question) {
		return { success: false, status: 400, message: "question is required" };
	}

	try {
		const { data } = await axios.post(`${AI_SERVICE_BASE_URL}/chat`, payload, { timeout: 30000 });
		const responseText = typeof data?.response === "string" ? data.response : null;

		if (!responseText) {
			return {
				success: false,
				status: 502,
				message: "AI service returned an invalid response",
			};
		}

		return { success: true, response: responseText, source: "ai-service" };
	} catch (error) {
		const fallback = "I understand your question. AI response pipeline is ready for integration.";
		return {
			success: true,
			response: fallback,
			source: "fallback",
			warning: error.message,
		};
	}
};

const streamAiReply = async (body = {}) => {
	const payload = buildAiPayload(body);
	const question = payload.question;

	if (!question) {
		return { success: false, status: 400, message: "question is required" };
	}

	try {
		const upstream = await axios.post(`${AI_SERVICE_BASE_URL}/chat/stream`, payload, {
			timeout: 120000,
			responseType: "stream",
		});

		return { success: true, stream: upstream.data, source: "ai-service" };
	} catch (error) {
		return {
			success: false,
			status: error?.response?.status || 502,
			message: error.message || "Failed to connect to AI stream",
		};
	}
};

const resolveSessionForCompat = async (body = {}) => {
	const subjectFromBody = body.subject || body.subject_id || null;
	const explicitStudentId = body.student_id;
	const userId = body.user_id;
	let resolvedStudentId = null;

	if (explicitStudentId && isValidId(explicitStudentId)) {
		resolvedStudentId = explicitStudentId;
	} else if (userId && isValidId(userId)) {
		const studentByUser = await StudentProfile.findOne({ user_id: userId }).select("_id");
		resolvedStudentId = studentByUser?._id ? String(studentByUser._id) : null;
	}

	let resolvedSubjectId = null;
	if (subjectFromBody && isValidId(subjectFromBody)) {
		resolvedSubjectId = subjectFromBody;
	} else if (typeof subjectFromBody === "string" && subjectFromBody.trim()) {
		const subjectName = subjectFromBody.trim();
		const gradeFromBody =
			toNumericGrade(body.grade) ||
			toNumericGrade(body.student_profile?.grade) ||
			toNumericGrade(body.student_profile?.grade_level);

		let subjectDoc = await Subject.findOne({ name: new RegExp(`^${escapeRegex(subjectName)}$`, "i") });
		if (!subjectDoc) {
			subjectDoc = await Subject.create({
				name: subjectName,
				grade_level: gradeFromBody || 1,
			});
		}
		resolvedSubjectId = String(subjectDoc._id);
	}

	if (body.session_id && isValidId(body.session_id)) {
		const existing = await ChatSession.findById(body.session_id);
		if (existing) return existing;
	}

	if (resolvedStudentId && resolvedSubjectId && isValidId(resolvedStudentId) && isValidId(resolvedSubjectId)) {
		const existingCompatSession = await ChatSession.findOne({
			student_id: resolvedStudentId,
			subject_id: resolvedSubjectId,
		}).sort({ started_at: -1 });

		if (existingCompatSession) return existingCompatSession;

		return ChatSession.create({
			student_id: resolvedStudentId,
			subject_id: resolvedSubjectId,
			started_at: new Date(),
		});
	}

	return null;
};

const startChatSession = async (req, res) => {
	try {
		const { student_id, subject_id } = req.body;
		if (!student_id || !subject_id) {
			return res.status(400).json({ success: false, message: "student_id and subject_id are required" });
		}

		const session = await ChatSession.create({
			student_id,
			subject_id,
			started_at: new Date(),
		});

		return res.status(201).json({ success: true, message: "Chat session started", data: session });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to start chat session", error: error.message });
	}
};

const sendMessage = async (req, res) => {
	try {
		const { session_id, message_text } = req.body;
		if (!session_id || !message_text) {
			return res.status(400).json({ success: false, message: "session_id and message_text are required" });
		}

		if (!isValidId(session_id)) {
			return res.status(400).json({ success: false, message: "Invalid session id" });
		}

		const session = await ChatSession.findById(session_id);
		if (!session) return res.status(404).json({ success: false, message: "Session not found" });

		const userMessage = await ChatMessage.create({
			session_id,
			sender: "USER",
			message_text,
			timestamp: new Date(),
		});

		const aiResult = await generateAiReply({
			question: message_text,
			subject_id: String(session.subject_id),
			history: [],
		});

		if (!aiResult.success) {
			return res.status(aiResult.status || 500).json({ success: false, message: aiResult.message });
		}

		const aiReplyText = aiResult.response;
		const aiMessage = await ChatMessage.create({
			session_id,
			sender: "AI",
			message_text: aiReplyText,
			timestamp: new Date(),
		});

		return res.status(200).json({
			success: true,
			message: "Messages saved",
			data: { user_message: userMessage, ai_message: aiMessage },
		});
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to send message", error: error.message });
	}
};

const chat = async (req, res) => {
	try {
		const question = toQuestion(req.body);
		if (!question) {
			return res.status(400).json({ success: false, message: "question is required" });
		}

		const aiResult = await generateAiReply(req.body);
		if (!aiResult.success) {
			return res.status(aiResult.status || 500).json({ success: false, message: aiResult.message });
		}

		const session = await resolveSessionForCompat({
			...req.body,
			user_id: req.user?.id,
		});
		await persistMessages(session, question, aiResult.response);

		return res.status(200).json({
			success: true,
			response: aiResult.response,
			session_id: session ? String(session._id) : null,
			source: aiResult.source,
		});
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to process chat", error: error.message });
	}
};

const chatStream = async (req, res) => {
	try {
		const question = toQuestion(req.body);
		if (!question) {
			return res.status(400).json({ success: false, message: "question is required" });
		}

		const session = await resolveSessionForCompat({
			...req.body,
			user_id: req.user?.id,
		});

		const streamResult = await streamAiReply(req.body);
		if (!streamResult.success) {
			const fallbackResult = await generateAiReply(req.body);
			if (!fallbackResult.success) {
				return res.status(fallbackResult.status || streamResult.status || 500).json({
					success: false,
					message: fallbackResult.message || streamResult.message,
				});
			}

			res.setHeader("Content-Type", "text/plain; charset=utf-8");
			res.setHeader("Cache-Control", "no-cache");
			res.setHeader("Connection", "keep-alive");
			if (session) {
				res.setHeader("X-Session-Id", String(session._id));
			}

			const chunkSize = 32;
			for (let i = 0; i < fallbackResult.response.length; i += chunkSize) {
				res.write(fallbackResult.response.slice(i, i + chunkSize));
			}
			await persistMessages(session, question, fallbackResult.response);
			return res.end();
		}

		res.setHeader("Content-Type", "text/plain; charset=utf-8");
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Connection", "keep-alive");
		if (session) {
			res.setHeader("X-Session-Id", String(session._id));
		}

		let fullText = "";

		streamResult.stream.on("data", (chunk) => {
			const textChunk = chunk.toString("utf8");
			fullText += textChunk;
			res.write(textChunk);
		});

		streamResult.stream.on("end", async () => {
			try {
				await persistMessages(session, question, fullText);
			} catch (_) {
				// Do not fail stream completion if persistence fails.
			}
			res.end();
		});

		streamResult.stream.on("error", async () => {
			if (fullText.trim()) {
				try {
					await persistMessages(session, question, fullText);
				} catch (_) {
					// Best-effort persistence.
				}
			}
			res.end();
		});

		return;
	} catch (error) {
		if (!res.headersSent) {
			return res.status(500).json({ success: false, message: "Failed to stream chat", error: error.message });
		}
		res.write("\n");
		return res.end();
	}
};

const getChatHistory = async (req, res) => {
	try {
		const { sessionId } = req.params;
		if (!isValidId(sessionId)) {
			return res.status(400).json({ success: false, message: "Invalid session id" });
		}

		const messages = await ChatMessage.find({ session_id: sessionId }).sort({ timestamp: 1 });
		return res.status(200).json({ success: true, data: messages });
	} catch (error) {
		return res.status(500).json({ success: false, message: "Failed to fetch chat history", error: error.message });
	}
};

module.exports = {
	startChatSession,
	sendMessage,
	getChatHistory,
	chat,
	chatStream,
};
