const express = require("express");
const auth = require("../middleware/auth");
const roleCheck = require("../middleware/roleCheck");
const { startChatSession, sendMessage, getChatHistory } = require("../controllers/aiTutorController");

const router = express.Router();

router.post("/sessions", auth, roleCheck("STUDENT", "ADMIN", "TEACHER"), startChatSession);
router.post("/messages", auth, roleCheck("STUDENT", "ADMIN", "TEACHER"), sendMessage);
router.get("/sessions/:sessionId/messages", auth, roleCheck("STUDENT", "ADMIN", "TEACHER"), getChatHistory);

module.exports = router;
