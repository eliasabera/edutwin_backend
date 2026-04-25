const express = require("express");
const multer = require("multer");
const auth = require("../middleware/auth");
const { uploadStudentPhoto } = require("../controllers/uploadController");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

router.post("/student-photo", auth, upload.single("photo"), uploadStudentPhoto);

module.exports = router;
