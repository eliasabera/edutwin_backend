const mongoose = require("mongoose");
const { ChatSession, ChatMessage } = require("../models");

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

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

		const aiReplyText = "I understand your question. AI response pipeline is ready for integration.";
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
};
