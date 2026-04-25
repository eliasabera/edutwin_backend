const mongoose = require("mongoose");
const { User, AdminProfile } = require("../models");

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const toAdminResponse = (user, profile) => ({
  user: {
    id: user._id,
    email: user.email,
    role: user.role,
    created_at: user.created_at,
  },
  profile,
});

const getAdmins = async (_req, res) => {
  try {
    const admins = await User.find({ role: "ADMIN" })
      .select("_id email role created_at")
      .sort({ created_at: -1 });

    const adminIds = admins.map((admin) => admin._id);
    const profiles = await AdminProfile.find({ user_id: { $in: adminIds } });
    const profileMap = new Map(profiles.map((profile) => [String(profile.user_id), profile]));

    const data = admins.map((admin) => ({
      user: {
        id: admin._id,
        email: admin.email,
        role: admin.role,
        created_at: admin.created_at,
      },
      profile: profileMap.get(String(admin._id)) || null,
    }));

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch admins",
      error: error.message,
    });
  }
};

const getAdminByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidId(userId)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }

    const user = await User.findOne({ _id: userId, role: "ADMIN" }).select("_id email role created_at");
    if (!user) {
      return res.status(404).json({ success: false, message: "Admin user not found" });
    }

    const profile = await AdminProfile.findOne({ user_id: user._id });

    return res.status(200).json({
      success: true,
      data: toAdminResponse(user, profile),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch admin",
      error: error.message,
    });
  }
};

const getMyAdminProfile = async (req, res) => {
  try {
    if (!req.user?.id || !isValidId(req.user.id)) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findOne({ _id: req.user.id, role: "ADMIN" }).select("_id email role created_at");
    if (!user) {
      return res.status(404).json({ success: false, message: "Admin user not found" });
    }

    const profile = await AdminProfile.findOne({ user_id: user._id });

    return res.status(200).json({
      success: true,
      data: toAdminResponse(user, profile),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch admin profile",
      error: error.message,
    });
  }
};

const updateMyAdminProfile = async (req, res) => {
  try {
    if (!req.user?.id || !isValidId(req.user.id)) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findOne({ _id: req.user.id, role: "ADMIN" }).select("_id email role created_at");
    if (!user) {
      return res.status(404).json({ success: false, message: "Admin user not found" });
    }

    const profile = await AdminProfile.findOne({ user_id: user._id });
    if (!profile) {
      return res.status(404).json({ success: false, message: "Admin profile not found" });
    }

    const updates = {};
    if (typeof req.body.full_name === "string" && req.body.full_name.trim()) {
      updates.full_name = req.body.full_name.trim();
    }

    if (typeof req.body.phone_number === "string") {
      const normalizedPhone = req.body.phone_number.trim();
      updates.phone_number = normalizedPhone || null;
    } else if (req.body.phone_number === null) {
      updates.phone_number = null;
    }

    if (typeof req.body.school_id === "string") {
      const schoolId = req.body.school_id.trim();
      updates.school_id = schoolId && isValidId(schoolId) ? schoolId : null;
    } else if (req.body.school_id === null) {
      updates.school_id = null;
    }

    if (Object.keys(updates).length > 0) {
      await AdminProfile.updateOne({ _id: profile._id }, { $set: updates });
    }

    const refreshedProfile = await AdminProfile.findById(profile._id);

    return res.status(200).json({
      success: true,
      message: "Admin profile updated",
      data: toAdminResponse(user, refreshedProfile),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to update admin profile",
      error: error.message,
    });
  }
};

module.exports = {
  getAdmins,
  getAdminByUserId,
  getMyAdminProfile,
  updateMyAdminProfile,
};
