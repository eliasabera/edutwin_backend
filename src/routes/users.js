const express = require("express");
const auth = require("../middleware/auth");
const roleCheck = require("../middleware/roleCheck");
const { getUsers, getMe, getUserById, updateUser, deleteUser } = require("../controllers/userController");

const router = express.Router();

router.get("/me", auth, getMe);
router.get("/", auth, roleCheck("ADMIN", "TEACHER"), getUsers);
router.get("/:userId", auth, roleCheck("ADMIN", "TEACHER"), getUserById);
router.put("/:userId", auth, roleCheck("ADMIN"), updateUser);
router.delete("/:userId", auth, roleCheck("ADMIN"), deleteUser);

module.exports = router;
