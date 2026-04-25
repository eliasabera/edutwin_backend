const mongoose = require("mongoose");
const path = require("path");
const {
  User,
  StudentProfile,
  TeacherProfile,
  AdminProfile,
  TwinProfile,
  Subscription,
} = require("../models");
const { uploadImageBuffer } = require("../services/cloudinaryService");

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const getSubscriptionSnapshot = async (userId) => {
  const now = new Date();
  const activeSubscription = await Subscription.findOne({
    user_id: userId,
    status: "active",
    current_period_end: { $gte: now },
  })
    .sort({ current_period_end: -1 })
    .select("plan_type status current_period_end");

  if (!activeSubscription) {
    return {
      is_subscribed: false,
      subscription_plan: null,
      subscription_status: null,
      subscription_period_end: null,
    };
  }

  return {
    is_subscribed: true,
    subscription_plan: activeSubscription.plan_type || null,
    subscription_status: activeSubscription.status || "active",
    subscription_period_end: activeSubscription.current_period_end || null,
  };
};

const getUsers = async (_req, res) => {
  try {
    const users = await User.find()
      .select("_id email role created_at")
      .sort({ created_at: -1 });
    return res.status(200).json({ success: true, data: users });
  } catch (error) {
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to fetch users",
        error: error.message,
      });
  }
};

const getUserById = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidId(userId))
      return res
        .status(400)
        .json({ success: false, message: "Invalid user id" });

    const user = await User.findById(userId).select(
      "_id email role created_at",
    );
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const profile =
      user.role === "STUDENT"
        ? await StudentProfile.findOne({ user_id: user._id })
        : user.role === "TEACHER"
          ? await TeacherProfile.findOne({ user_id: user._id })
          : user.role === "ADMIN"
            ? await AdminProfile.findOne({ user_id: user._id })
          : null;

    return res.status(200).json({ success: true, data: { user, profile } });
  } catch (error) {
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to fetch user",
        error: error.message,
      });
  }
};

const getMe = async (req, res) => {
  try {
    if (!req.user?.id || !isValidId(req.user.id)) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findById(req.user.id).select(
      "_id email role created_at has_accepted_terms_policy terms_policy_accepted_at",
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const subscriptionSnapshot = await getSubscriptionSnapshot(user._id);
    let profile = null;

    if (user.role === "STUDENT") {
      const studentProfile = await StudentProfile.findOne({
        user_id: user._id,
      });
      const twinProfile = studentProfile
        ? await TwinProfile.findOne({ student_id: studentProfile._id })
        : null;

      profile = {
        id: studentProfile?._id || null,
        user_id: user._id,
        full_name: studentProfile?.full_name || null,
        phone_number: studentProfile?.phone_number || null,
        language: studentProfile?.language || "en",
        grade_level: studentProfile?.grade_level ?? null,
        grade: studentProfile?.grade_level ?? null,
        student_photo_url: studentProfile?.student_photo_url || null,
        school_id: studentProfile?.school_id || null,
        section: studentProfile?.section || null,
        mastery_score: twinProfile?.mastery_percentage ?? 0,
        performance_band: twinProfile?.performance_band || "medium",
        twin_name: twinProfile?.twin_name || "EduTwin",
        twin_photo_url: twinProfile?.twin_photo_url || null,
        support_subjects: Array.isArray(twinProfile?.support_subjects)
          ? twinProfile.support_subjects
          : [],
        strong_subjects: Array.isArray(twinProfile?.strong_subjects)
          ? twinProfile.strong_subjects
          : [],
        subject_scores:
          twinProfile?.subject_scores &&
          typeof twinProfile.subject_scores === "object"
            ? twinProfile.subject_scores
            : {},
        diagnostic_completed: !!studentProfile,
        xp: twinProfile?.xp ?? 0,
        lab_bonus_unlock: !!twinProfile?.lab_bonus_unlock,
        streak: twinProfile?.streak ?? 0,
        last_active: twinProfile?.last_active || null,
        is_subscribed: subscriptionSnapshot.is_subscribed,
        subscription_plan: subscriptionSnapshot.subscription_plan,
        subscription_status: subscriptionSnapshot.subscription_status,
        subscription_period_end: subscriptionSnapshot.subscription_period_end,
      };
    } else if (user.role === "TEACHER") {
      profile = await TeacherProfile.findOne({ user_id: user._id });
    } else if (user.role === "ADMIN") {
      profile = await AdminProfile.findOne({ user_id: user._id });
    }

    return res.status(200).json({
      success: true,
      data: {
        user,
        profile,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to fetch profile",
        error: error.message,
      });
  }
};

const updateMe = async (req, res) => {
  try {
    if (!req.user?.id || !isValidId(req.user.id)) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findById(req.user.id).select(
      "_id email role created_at has_accepted_terms_policy terms_policy_accepted_at",
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (typeof req.body.has_accepted_terms_policy === "boolean") {
      user.has_accepted_terms_policy = req.body.has_accepted_terms_policy;
      user.terms_policy_accepted_at = req.body.has_accepted_terms_policy
        ? new Date()
        : null;
      await user.save();
    }

    const subscriptionSnapshot = await getSubscriptionSnapshot(user._id);

    if (user.role === "STUDENT") {
      const studentProfile = await StudentProfile.findOne({
        user_id: user._id,
      });
      if (!studentProfile) {
        return res
          .status(404)
          .json({ success: false, message: "Student profile not found" });
      }

      const studentUpdates = {};
      if (typeof req.body.full_name === "string" && req.body.full_name.trim()) {
        studentUpdates.full_name = req.body.full_name.trim();
      }

      const preferredLanguage =
        typeof req.body.language === "string"
          ? req.body.language
          : typeof req.body.preferred_language === "string"
            ? req.body.preferred_language
            : null;
      if (preferredLanguage === "en" || preferredLanguage === "om") {
        studentUpdates.language = preferredLanguage;
      }

      if (
        typeof req.body.grade_level === "number" &&
        Number.isFinite(req.body.grade_level)
      ) {
        studentUpdates.grade_level = req.body.grade_level;
      } else if (typeof req.body.grade === "string" && req.body.grade.trim()) {
        const parsed = Number.parseInt(req.body.grade, 10);
        if (Number.isFinite(parsed)) {
          studentUpdates.grade_level = parsed;
        }
      }

      if (req.file?.buffer) {
        if (!ALLOWED_MIME_TYPES.has(req.file.mimetype)) {
          return res.status(400).json({
            success: false,
            message:
              "Unsupported file type. Use JPG, PNG, WEBP, HEIC, or HEIF.",
          });
        }

        const fileName = path
          .parse(req.file.originalname || "student-photo")
          .name.trim()
          .toLowerCase()
          .replace(/[^a-z0-9-_]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "") || "student-photo";

        const uploadResult = await uploadImageBuffer({
          buffer: req.file.buffer,
          publicId: `student-${user._id}-${fileName}`,
          folder: "edutwin/students",
          context: {
            user_id: user._id.toString(),
            student_profile_id: String(studentProfile._id),
          },
        });

        studentUpdates.student_photo_url = uploadResult.secure_url;
      } else if (typeof req.body.student_photo_url === "string") {
        const normalizedUrl = req.body.student_photo_url.trim();
        studentUpdates.student_photo_url = normalizedUrl || null;
      } else if (req.body.student_photo_url === null) {
        studentUpdates.student_photo_url = null;
      }

      if (Object.keys(studentUpdates).length > 0) {
        await StudentProfile.updateOne(
          { _id: studentProfile._id },
          { $set: studentUpdates },
        );
      }

      const twinUpdates = {};
      if (
        typeof req.body.mastery_score === "number" &&
        Number.isFinite(req.body.mastery_score)
      ) {
        twinUpdates.mastery_percentage = req.body.mastery_score;
      }
      if (
        typeof req.body.performance_band === "string" &&
        ["support", "medium", "top", "low"].includes(req.body.performance_band)
      ) {
        twinUpdates.performance_band = req.body.performance_band;
      }
      if (Array.isArray(req.body.support_subjects)) {
        twinUpdates.support_subjects = req.body.support_subjects;
      }
      if (Array.isArray(req.body.strong_subjects)) {
        twinUpdates.strong_subjects = req.body.strong_subjects;
      }
      if (typeof req.body.twin_name === "string") {
        const normalizedTwinName = req.body.twin_name.trim();
        twinUpdates.twin_name = normalizedTwinName || "EduTwin";
      }
      if (typeof req.body.twin_photo_url === "string") {
        const normalizedTwinPhoto = req.body.twin_photo_url.trim();
        twinUpdates.twin_photo_url = normalizedTwinPhoto || null;
      } else if (req.body.twin_photo_url === null) {
        twinUpdates.twin_photo_url = null;
      }
      if (typeof req.body.xp === "number" && Number.isFinite(req.body.xp)) {
        twinUpdates.xp = req.body.xp;
      }
      if (
        typeof req.body.streak === "number" &&
        Number.isFinite(req.body.streak)
      ) {
        twinUpdates.streak = req.body.streak;
      }
      if (
        typeof req.body.last_active === "string" &&
        req.body.last_active.trim()
      ) {
        const parsedDate = new Date(req.body.last_active);
        if (!Number.isNaN(parsedDate.getTime())) {
          twinUpdates.last_active = parsedDate;
        }
      }

      if (Object.keys(twinUpdates).length > 0) {
        await TwinProfile.updateOne(
          { student_id: studentProfile._id },
          { $set: twinUpdates },
        );
      }

      const refreshedStudent = await StudentProfile.findById(
        studentProfile._id,
      );
      const refreshedTwin = await TwinProfile.findOne({
        student_id: studentProfile._id,
      });

      return res.status(200).json({
        success: true,
        message: "Profile updated",
        data: {
          user,
          student_photo_url: refreshedStudent?.student_photo_url || null,
          profile: {
            id: refreshedStudent?._id || null,
            user_id: user._id,
            full_name: refreshedStudent?.full_name || null,
            phone_number: refreshedStudent?.phone_number || null,
            language: refreshedStudent?.language || "en",
            grade_level: refreshedStudent?.grade_level ?? null,
            grade: refreshedStudent?.grade_level ?? null,
            student_photo_url: refreshedStudent?.student_photo_url || null,
            school_id: refreshedStudent?.school_id || null,
            section: refreshedStudent?.section || null,
            mastery_score: refreshedTwin?.mastery_percentage ?? 0,
            performance_band: refreshedTwin?.performance_band || "medium",
            twin_name: refreshedTwin?.twin_name || "EduTwin",
            twin_photo_url: refreshedTwin?.twin_photo_url || null,
            support_subjects: Array.isArray(refreshedTwin?.support_subjects)
              ? refreshedTwin.support_subjects
              : [],
            strong_subjects: Array.isArray(refreshedTwin?.strong_subjects)
              ? refreshedTwin.strong_subjects
              : [],
            subject_scores:
              refreshedTwin?.subject_scores &&
              typeof refreshedTwin.subject_scores === "object"
                ? refreshedTwin.subject_scores
                : {},
            diagnostic_completed: true,
            xp: refreshedTwin?.xp ?? 0,
            lab_bonus_unlock: !!refreshedTwin?.lab_bonus_unlock,
            streak: refreshedTwin?.streak ?? 0,
            last_active: refreshedTwin?.last_active || null,
            is_subscribed: subscriptionSnapshot.is_subscribed,
            subscription_plan: subscriptionSnapshot.subscription_plan,
            subscription_status: subscriptionSnapshot.subscription_status,
            subscription_period_end: subscriptionSnapshot.subscription_period_end,
          },
        },
      });
    }

    if (user.role === "TEACHER") {
      const teacherProfile = await TeacherProfile.findOne({
        user_id: user._id,
      });
      if (!teacherProfile) {
        return res
          .status(404)
          .json({ success: false, message: "Teacher profile not found" });
      }

      const teacherUpdates = {};
      if (typeof req.body.full_name === "string" && req.body.full_name.trim()) {
        teacherUpdates.full_name = req.body.full_name.trim();
      }
      if (Object.keys(teacherUpdates).length > 0) {
        await TeacherProfile.updateOne(
          { _id: teacherProfile._id },
          { $set: teacherUpdates },
        );
      }

      const refreshedTeacher = await TeacherProfile.findById(
        teacherProfile._id,
      );
      return res.status(200).json({
        success: true,
        message: "Profile updated",
        data: {
          user,
          profile: refreshedTeacher,
        },
      });
    }

    if (user.role === "ADMIN") {
      const adminProfile = await AdminProfile.findOne({
        user_id: user._id,
      });

      if (!adminProfile) {
        return res
          .status(404)
          .json({ success: false, message: "Admin profile not found" });
      }

      const adminUpdates = {};
      if (typeof req.body.full_name === "string" && req.body.full_name.trim()) {
        adminUpdates.full_name = req.body.full_name.trim();
      }
      if (typeof req.body.phone_number === "string") {
        const normalizedPhone = req.body.phone_number.trim();
        adminUpdates.phone_number = normalizedPhone || null;
      } else if (req.body.phone_number === null) {
        adminUpdates.phone_number = null;
      }

      if (typeof req.body.school_id === "string") {
        const schoolId = req.body.school_id.trim();
        adminUpdates.school_id = isValidId(schoolId) ? schoolId : null;
      } else if (req.body.school_id === null) {
        adminUpdates.school_id = null;
      }

      if (Object.keys(adminUpdates).length > 0) {
        await AdminProfile.updateOne(
          { _id: adminProfile._id },
          { $set: adminUpdates },
        );
      }

      const refreshedAdmin = await AdminProfile.findById(adminProfile._id);

      return res.status(200).json({
        success: true,
        message: "Profile updated",
        data: {
          user,
          profile: refreshedAdmin,
        },
      });
    }

    return res
      .status(400)
      .json({ success: false, message: "Unsupported role" });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to update profile",
      error: error.message,
    });
  }
};

const updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { email, role } = req.body;
    if (!isValidId(userId))
      return res
        .status(400)
        .json({ success: false, message: "Invalid user id" });

    const update = {};
    if (email) update.email = String(email).trim().toLowerCase();
    if (role) update.role = String(role).trim().toUpperCase();

    const user = await User.findByIdAndUpdate(userId, update, {
      returnDocument: "after",
      runValidators: true,
    }).select("_id email role created_at");
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    return res
      .status(200)
      .json({ success: true, message: "User updated", data: user });
  } catch (error) {
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to update user",
        error: error.message,
      });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidId(userId))
      return res
        .status(400)
        .json({ success: false, message: "Invalid user id" });

    const user = await User.findById(userId);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    await StudentProfile.deleteOne({ user_id: user._id });
    await TeacherProfile.deleteOne({ user_id: user._id });
    await AdminProfile.deleteOne({ user_id: user._id });
    await User.findByIdAndDelete(user._id);

    return res.status(200).json({ success: true, message: "User deleted" });
  } catch (error) {
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to delete user",
        error: error.message,
      });
  }
};

module.exports = {
  getUsers,
  getMe,
  updateMe,
  getUserById,
  updateUser,
  deleteUser,
};
