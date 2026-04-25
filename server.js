require("dotenv").config();
const { app, connectDatabase } = require("./src/app");
const seedDevAdmin = require("./src/scripts/seedDevAdmin");
const seedDevTeacher = require("./src/scripts/seedDevTeacher");

const PORT = Number(process.env.PORT) || 5000;

const startServer = async () => {
	try {
		await connectDatabase();
		const seededAdmin = await seedDevAdmin();
		const seededTeacher = await seedDevTeacher();

		if (seededAdmin) {
			console.log(`Dev admin ready: ${seededAdmin.email}`);
		}

		if (seededTeacher) {
			console.log(`Dev teacher ready: ${seededTeacher.email}`);
		}

		app.listen(PORT, () => {
			console.log(`Server running on port ${PORT}`);
		});
	} catch (error) {
		console.error("Failed to start server:", error.message);
		process.exit(1);
	}
};

startServer();
