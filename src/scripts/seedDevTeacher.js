const bcrypt = require("bcryptjs");
const { User, TeacherProfile } = require("../models");

const DEFAULT_TEACHER_EMAIL = process.env.TEACHER_TEST_EMAIL || "teacher@gmail.com";
const DEFAULT_TEACHER_PASSWORD = process.env.TEACHER_TEST_PASSWORD || "12345678";
const DEFAULT_TEACHER_NAME = process.env.TEACHER_TEST_FULL_NAME || "EduTwin Test Teacher";

async function seedDevTeacher() {
	if (process.env.NODE_ENV === "production") {
		return null;
	}

	const email = String(DEFAULT_TEACHER_EMAIL).trim().toLowerCase();
	const existingUser = await User.findOne({ email });

	if (existingUser) {
		if (existingUser.role !== "TEACHER") {
			throw new Error(`Existing user with email ${email} is not a TEACHER account`);
		}

		const existingProfile = await TeacherProfile.findOne({ user_id: existingUser._id });
		if (!existingProfile) {
			await TeacherProfile.create({
				user_id: existingUser._id,
				full_name: DEFAULT_TEACHER_NAME,
				school_id: null,
			});
		}

		return { email, password: DEFAULT_TEACHER_PASSWORD, created: false };
	}

	const password_hash = await bcrypt.hash(DEFAULT_TEACHER_PASSWORD, 10);
	const teacherUser = await User.create({
		email,
		password_hash,
		role: "TEACHER",
	});

	await TeacherProfile.create({
		user_id: teacherUser._id,
		full_name: DEFAULT_TEACHER_NAME,
		school_id: null,
	});

	return { email, password: DEFAULT_TEACHER_PASSWORD, created: true };
}

module.exports = seedDevTeacher;
