const express = require("express");
const auth = require("../middleware/auth");
const roleCheck = require("../middleware/roleCheck");
const {
	createTextbook,
	getTextbooks,
	getTextbookById,
	updateTextbook,
	deleteTextbook,
	addInteractiveMetadata,
	getTextbookCatalog,
	syncTextbookCatalog,
	resolveTextbook,
} = require("../controllers/textbookController");

const router = express.Router();

router.get("/", auth, getTextbooks);
router.get("/catalog", auth, getTextbookCatalog);
router.get("/resolve", auth, resolveTextbook);
router.post("/sync-catalog", auth, roleCheck("ADMIN", "TEACHER"), syncTextbookCatalog);
router.get("/:textbookId", auth, getTextbookById);
router.post("/", auth, roleCheck("ADMIN", "TEACHER"), createTextbook);
router.put("/:textbookId", auth, roleCheck("ADMIN", "TEACHER"), updateTextbook);
router.delete("/:textbookId", auth, roleCheck("ADMIN", "TEACHER"), deleteTextbook);
router.post("/:textbookId/metadata", auth, roleCheck("ADMIN", "TEACHER"), addInteractiveMetadata);

module.exports = router;
