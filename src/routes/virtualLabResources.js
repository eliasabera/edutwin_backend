const express = require("express");
const auth = require("../middleware/auth");
const roleCheck = require("../middleware/roleCheck");
const {
  createVirtualLabResource,
  getVirtualLabResources,
  getVirtualLabResourceById,
  updateVirtualLabResource,
  deleteVirtualLabResource,
  syncVirtualLabResourcesFromSite,
} = require("../controllers/virtualLabResourceController");

const router = express.Router();

router.get("/", getVirtualLabResources);
router.get("/:resourceId", getVirtualLabResourceById);
router.post("/sync-site-catalog", auth, roleCheck("ADMIN", "TEACHER"), syncVirtualLabResourcesFromSite);

router.post("/", auth, roleCheck("ADMIN", "TEACHER"), createVirtualLabResource);
router.put("/:resourceId", auth, roleCheck("ADMIN", "TEACHER"), updateVirtualLabResource);
router.delete("/:resourceId", auth, roleCheck("ADMIN"), deleteVirtualLabResource);

module.exports = router;
