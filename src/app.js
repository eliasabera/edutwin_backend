const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const schoolRoutes = require("./routes/schools");
const classRoutes = require("./routes/classes");
const textbookRoutes = require("./routes/textbooks");
const quizRoutes = require("./routes/quizzes");
const analyticsRoutes = require("./routes/analytics");
const gamificationRoutes = require("./routes/gamification");
const aiRoutes = require("./routes/ai");
const paymentRoutes = require("./routes/payments");
const virtualLabResourceRoutes = require("./routes/virtualLabResources");
const connectMongoDatabase = require("./config/database");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
	res.status(200).json({ success: true, message: "API is running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/schools", schoolRoutes);
app.use("/api/classes", classRoutes);
app.use("/api/textbooks", textbookRoutes);
app.use("/api/quizzes", quizRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/gamification", gamificationRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/virtual-lab-resources", virtualLabResourceRoutes);
app.use(notFound);
app.use(errorHandler);

const connectDatabase = async () => {
	await connectMongoDatabase();
};

module.exports = {
	app,
	connectDatabase,
};
