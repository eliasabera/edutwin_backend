const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { User, StudentProfile, TeacherProfile } = require("../models");

const ALLOWED_ROLES = ["STUDENT", "TEACHER", "ADMIN"];

const signToken = (user) => {
	const secret = process.env.JWT_SECRET || "dev_jwt_secret_change_me";
	return jwt.sign(
		{
			id: user._id,
			email: user.email,
			role: user.role,
		},
		secret,
		{ expiresIn: "7d" }
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
			if (!full_name || !language || grade_level === undefined || grade_level === null) {
				return res.status(400).json({
					success: false,
					message: "full_name, language and grade_level are required for student registration",
				});
			}
		}

		if (normalizedRole === "TEACHER" && !full_name) {
			return res.status(400).json({
				success: false,
				message: "full_name is required for teacher registration",
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
		});

		let profile = null;

		try {
			if (normalizedRole === "STUDENT") {
				profile = await StudentProfile.create({
					user_id: user._id,
					full_name: String(full_name).trim(),
					phone_number: phone_number || null,
					language: String(language).trim(),
					grade_level: Number(grade_level),
					school_id: school_id || null,
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
		} catch (profileError) {
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
