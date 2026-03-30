const express = require("express");
const auth = require("../middleware/auth");
const roleCheck = require("../middleware/roleCheck");
const { startChatSession, sendMessage, getChatHistory, chat, chatStream } = require("../controllers/aiTutorController");

const router = express.Router();

router.post("/chat", auth, roleCheck("STUDENT", "ADMIN", "TEACHER"), chat);
router.post("/chat/stream", auth, roleCheck("STUDENT", "ADMIN", "TEACHER"), chatStream);
router.post("/sessions", auth, roleCheck("STUDENT", "ADMIN", "TEACHER"), startChatSession);
router.post("/messages", auth, roleCheck("STUDENT", "ADMIN", "TEACHER"), sendMessage);
router.get("/sessions/:sessionId/messages", auth, roleCheck("STUDENT", "ADMIN", "TEACHER"), getChatHistory);

module.exports = router;
