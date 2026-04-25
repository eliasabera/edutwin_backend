const express = require("express");
const auth = require("../middleware/auth");
const roleCheck = require("../middleware/roleCheck");
const {
  getAdmins,
  getAdminByUserId,
  getMyAdminProfile,
  updateMyAdminProfile,
} = require("../controllers/adminController");

const router = express.Router();

router.get("/me", auth, roleCheck("ADMIN"), getMyAdminProfile);
router.patch("/me", auth, roleCheck("ADMIN"), updateMyAdminProfile);
router.put("/me", auth, roleCheck("ADMIN"), updateMyAdminProfile);
router.get("/", auth, roleCheck("ADMIN"), getAdmins);
router.get("/:userId", auth, roleCheck("ADMIN"), getAdminByUserId);

module.exports = router;
