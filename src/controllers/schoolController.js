const mongoose = require("mongoose");
const { School, StudentProfile, Subscription } = require("../models");

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const normalizeOptionalString = (value) => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || null;
};

const buildSchoolStats = async (schoolIds) => {
  if (!schoolIds.length) {
    return new Map();
  }

  const profiles = await StudentProfile.find({
    school_id: { $in: schoolIds },
  })
    .select("school_id user_id grade_level section")
    .lean();

  const userIds = [
    ...new Set(
      profiles
        .map((profile) => profile.user_id)
        .filter((userId) => !!userId)
        .map((userId) => String(userId)),
    ),
  ];

  const activeSubscriptions = userIds.length
    ? await Subscription.find({
        user_id: { $in: userIds },
        status: "active",
        current_period_end: { $gte: new Date() },
      })
        .select("user_id")
        .lean()
    : [];

  const activeUserIds = new Set(
    activeSubscriptions.map((subscription) => String(subscription.user_id)),
  );

  const statsMap = new Map();

  profiles.forEach((profile) => {
    const schoolId = String(profile.school_id);
    const current = statsMap.get(schoolId) || {
      totalStudents: 0,
      activeSubscribers: 0,
      grades: new Set(),
      sections: new Set(),
    };

    current.totalStudents += 1;

    if (activeUserIds.has(String(profile.user_id))) {
      current.activeSubscribers += 1;
    }

    if (Number.isFinite(profile.grade_level)) {
      current.grades.add(profile.grade_level);
    }

    if (typeof profile.section === "string" && profile.section.trim()) {
      current.sections.add(profile.section.trim());
    }

    statsMap.set(schoolId, current);
  });

  return statsMap;
};

const toSchoolStatus = (school, stats) => {
  if (school.is_active === false) return "INACTIVE";
  if ((stats?.activeSubscribers || 0) > 0) return "ACTIVE";
  return "NO_ACTIVE_SUBSCRIPTIONS";
};

const createSchool = async (req, res) => {
  try {
    const { name, email, phone, address, description, is_active } = req.body;
    if (!name)
      return res
        .status(400)
        .json({ success: false, message: "name is required" });

    const schoolPayload = {
      name: String(name).trim(),
    };

    const normalizedEmail = normalizeOptionalString(email);
    if (normalizedEmail !== undefined) {
      schoolPayload.email = normalizedEmail
        ? normalizedEmail.toLowerCase()
        : null;
    }

    const normalizedPhone = normalizeOptionalString(phone);
    if (normalizedPhone !== undefined) {
      schoolPayload.phone = normalizedPhone;
    }

    const normalizedAddress = normalizeOptionalString(address);
    if (normalizedAddress !== undefined) {
      schoolPayload.address = normalizedAddress;
    }

    const normalizedDescription = normalizeOptionalString(description);
    if (normalizedDescription !== undefined) {
      schoolPayload.description = normalizedDescription;
    }

    if (typeof is_active === "boolean") {
      schoolPayload.is_active = is_active;
    }

    const school = await School.create(schoolPayload);
    return res
      .status(201)
      .json({ success: true, message: "School created", data: school });
  } catch (error) {
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to create school",
        error: error.message,
      });
  }
};

const getSchools = async (_req, res) => {
  try {
    const schools = await School.find().sort({ name: 1 }).lean();

    const schoolIds = schools.map((school) => school._id);
    const statsMap = await buildSchoolStats(schoolIds);

    const data = schools.map((school) => {
      const stats = statsMap.get(String(school._id)) || null;
      return {
        ...school,
        total_students: stats?.totalStudents || 0,
        active_subscribers: stats?.activeSubscribers || 0,
        total_grades: stats?.grades?.size || 0,
        total_sections: stats?.sections?.size || 0,
        status: toSchoolStatus(school, stats),
      };
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to fetch schools",
        error: error.message,
      });
  }
};

const getSchoolById = async (req, res) => {
  try {
    const { schoolId } = req.params;
    if (!isValidId(schoolId))
      return res
        .status(400)
        .json({ success: false, message: "Invalid school id" });

    const school = await School.findById(schoolId).lean();
    if (!school)
      return res
        .status(404)
        .json({ success: false, message: "School not found" });

    const statsMap = await buildSchoolStats([school._id]);
    const stats = statsMap.get(String(school._id)) || null;
    const data = {
      ...school,
      total_students: stats?.totalStudents || 0,
      active_subscribers: stats?.activeSubscribers || 0,
      total_grades: stats?.grades?.size || 0,
      total_sections: stats?.sections?.size || 0,
      status: toSchoolStatus(school, stats),
    };

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to fetch school",
        error: error.message,
      });
  }
};

const updateSchool = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const { name, email, phone, address, description, is_active } = req.body;
    if (!isValidId(schoolId))
      return res
        .status(400)
        .json({ success: false, message: "Invalid school id" });

    const updatePayload = {};
    if (typeof name === "string" && name.trim()) {
      updatePayload.name = name.trim();
    }

    const normalizedEmail = normalizeOptionalString(email);
    if (normalizedEmail !== undefined) {
      updatePayload.email = normalizedEmail
        ? normalizedEmail.toLowerCase()
        : null;
    }

    const normalizedPhone = normalizeOptionalString(phone);
    if (normalizedPhone !== undefined) {
      updatePayload.phone = normalizedPhone;
    }

    const normalizedAddress = normalizeOptionalString(address);
    if (normalizedAddress !== undefined) {
      updatePayload.address = normalizedAddress;
    }

    const normalizedDescription = normalizeOptionalString(description);
    if (normalizedDescription !== undefined) {
      updatePayload.description = normalizedDescription;
    }

    if (typeof is_active === "boolean") {
      updatePayload.is_active = is_active;
    }

    const school = await School.findByIdAndUpdate(schoolId, updatePayload, {
      returnDocument: "after",
      runValidators: true,
    });
    if (!school)
      return res
        .status(404)
        .json({ success: false, message: "School not found" });

    return res
      .status(200)
      .json({ success: true, message: "School updated", data: school });
  } catch (error) {
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to update school",
        error: error.message,
      });
  }
};

const deleteSchool = async (req, res) => {
  try {
    const { schoolId } = req.params;
    if (!isValidId(schoolId))
      return res
        .status(400)
        .json({ success: false, message: "Invalid school id" });

    const school = await School.findByIdAndDelete(schoolId);
    if (!school)
      return res
        .status(404)
        .json({ success: false, message: "School not found" });

    return res.status(200).json({ success: true, message: "School deleted" });
  } catch (error) {
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to delete school",
        error: error.message,
      });
  }
};

module.exports = {
  createSchool,
  getSchools,
  getSchoolById,
  updateSchool,
  deleteSchool,
};
