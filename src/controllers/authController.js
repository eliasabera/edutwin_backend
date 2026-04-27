const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const {
  User,
  StudentProfile,
  TeacherProfile,
  AdminProfile,
} = require("../models");

const ALLOWED_ROLES = ["STUDENT", "TEACHER", "ADMIN"];

const normalizeSchoolId = (schoolId) => {
  if (!schoolId) return null;
  const candidate = String(schoolId).trim();
  return mongoose.Types.ObjectId.isValid(candidate) ? candidate : null;
};

const signToken = (user) => {
  const secret = process.env.JWT_SECRET || "dev_jwt_secret_change_me";
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
    },
    secret,
    { expiresIn: "7d" },
  );
};

const register = async (req, res) => {
  try {
    const {
      email,
      password,
      role,
      full_name,
      phone_number,
      language,
      grade_level,
      school_id,
      section,
      has_accepted_terms_policy,
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "email and password are required",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedRole = role ? String(role).trim().toUpperCase() : "STUDENT";

    if (!ALLOWED_ROLES.includes(normalizedRole)) {
      return res.status(400).json({
        success: false,
        message: "invalid role",
      });
    }

    if (normalizedRole === "STUDENT") {
      if (
        !full_name ||
        !language ||
        grade_level === undefined ||
        grade_level === null
      ) {
        return res.status(400).json({
          success: false,
          message:
            "full_name, language and grade_level are required for student registration",
        });
      }
    }

    if (
      (normalizedRole === "TEACHER" || normalizedRole === "ADMIN") &&
      !full_name
    ) {
      return res.status(400).json({
        success: false,
        message: "full_name is required for teacher/admin registration",
      });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "email already in use",
      });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const user = await User.create({
      email: normalizedEmail,
      password_hash,
      role: normalizedRole,
      has_accepted_terms_policy: has_accepted_terms_policy === true,
      terms_policy_accepted_at:
        has_accepted_terms_policy === true ? new Date() : null,
    });

    let profile = null;

    try {
      if (normalizedRole === "STUDENT") {
        const resolvedSchoolId = normalizeSchoolId(school_id);
        profile = await StudentProfile.create({
          user_id: user._id,
          full_name: String(full_name).trim(),
          phone_number: phone_number || null,
          language: String(language).trim(),
          grade_level: Number(grade_level),
          school_id: resolvedSchoolId,
          section: section || null,
        });
      }

      if (normalizedRole === "TEACHER") {
        profile = await TeacherProfile.create({
          user_id: user._id,
          full_name: String(full_name).trim(),
          school_id: school_id || null,
        });
      }

      if (normalizedRole === "ADMIN") {
        const resolvedSchoolId = normalizeSchoolId(school_id);
        profile = await AdminProfile.create({
          user_id: user._id,
          full_name: String(full_name).trim(),
          phone_number: phone_number || null,
          school_id: resolvedSchoolId,
        });
      }
    } catch (profileError) {
      await AdminProfile.deleteOne({ user_id: user._id });
      await TeacherProfile.deleteOne({ user_id: user._id });
      await StudentProfile.deleteOne({ user_id: user._id });
      await User.findByIdAndDelete(user._id);
      throw profileError;
    }

    const token = signToken(user);

    return res.status(201).json({
      success: true,
      message: "user registered successfully",
      data: {
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          has_accepted_terms_policy: !!user.has_accepted_terms_policy,
          terms_policy_accepted_at: user.terms_policy_accepted_at || null,
        },
        profile: profile ? profile.toObject() : null,
        token,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "failed to register user",
      error: error.message,
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "email and password are required",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "invalid credentials",
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "invalid credentials",
      });
    }

    const token = signToken(user);

    return res.status(200).json({
      success: true,
      message: "login successful",
      data: {
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          has_accepted_terms_policy: !!user.has_accepted_terms_policy,
          terms_policy_accepted_at: user.terms_policy_accepted_at || null,
        },
        token,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "failed to login",
      error: error.message,
    });
  }
};

module.exports = {
  register,
  login,
};
