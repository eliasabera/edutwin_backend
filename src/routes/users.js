const express = require("express");
const multer = require("multer");
const auth = require("../middleware/auth");
const roleCheck = require("../middleware/roleCheck");
const {
  getUsers,
  getMe,
  updateMe,
  getUserById,
  updateUser,
  deleteUser,
} = require("../controllers/userController");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

router.get("/me", auth, getMe);
router.patch("/me", auth, upload.single("student_photo"), updateMe);
router.put("/me", auth, upload.single("student_photo"), updateMe);
router.get("/", auth, roleCheck("ADMIN", "TEACHER"), getUsers);
router.get("/:userId", auth, roleCheck("ADMIN", "TEACHER"), getUserById);
router.put("/:userId", auth, roleCheck("ADMIN"), updateUser);
router.delete("/:userId", auth, roleCheck("ADMIN"), deleteUser);

module.exports = router;
