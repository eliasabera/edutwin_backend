require("dotenv").config();
const { app, connectDatabase } = require("./src/app");

const PORT = Number(process.env.PORT) || 5000;

const startServer = async () => {
	try {
		await connectDatabase();

		app.listen(PORT, () => {
			console.log(`Server running on port ${PORT}`);
		});
	} catch (error) {
		console.error("Failed to start server:", error.message);
		process.exit(1);
	}
};

startServer();
