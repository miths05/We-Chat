const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 3000;

// Allowed Origins for CORS (Supports Multiple Frontend URLs)
const allowedOrigins = [
	process.env.FRONTEND_URL, // Primary Frontend
	"http://localhost:5173",  // Dev Port
	"http://localhost:5174"   // Alternate Dev Port
].filter(Boolean); // Remove undefined values

const corsOptions = {
	origin: allowedOrigins,
	methods: ["GET", "POST", "DELETE"],
	allowedHeaders: ["Content-Type", "Authorization"],
	credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database Connection Function
async function connectDB() {
	try {
		await mongoose.connect(process.env.MONGODB_URI, {
			useNewUrlParser: true,
			useUnifiedTopology: true,
		});
		console.log("✅ MongoDB Connected");
		checkDBStatus();
	} catch (err) {
		console.error("❌ MongoDB Connection Error:", err);
		setTimeout(connectDB, 5000); // Retry connection after 5 seconds
	}
}

// Function to check DB connection status dynamically
function checkDBStatus() {
	const statusMessages = {
		0: "🔴 Disconnected",
		1: "🟢 Connected",
		2: "🟡 Connecting...",
		3: "🟠 Disconnecting...",
	};
	console.log(`Database Status: ${statusMessages[mongoose.connection.readyState] || "❓ Unknown"}`);
}

// MongoDB Event Listeners
mongoose.connection.on("connected", () => console.log("🟢 MongoDB Connected"));
mongoose.connection.on("disconnected", () => console.log("🔴 MongoDB Disconnected - Retrying..."));
mongoose.connection.on("error", (err) => console.error("❌ MongoDB Error:", err));

// Connect to Database
connectDB();

// Root Route
app.get("/", (req, res) => {
	res.json({
		message: "Welcome to Chat Application!",
		frontend_urls: allowedOrigins,
		db_status: mongoose.connection.readyState === 1 ? "Connected" : "Disconnected",
	});
});

// Import and Use Routers
const authRouter = require("./routes/auth");
const userRouter = require("./routes/user");
const chatRouter = require("./routes/chat");
const messageRouter = require("./routes/message");

app.use("/api/auth", authRouter);
app.use("/api/user", userRouter);
app.use("/api/chat", chatRouter);
app.use("/api/message", messageRouter);

// Handle Invalid Routes
app.all("*", (req, res) => {
	res.status(404).json({ error: "Invalid Route" });
});

// Global Error Handler
app.use((err, req, res, next) => {
	console.error("❌ Error:", err);
	res.status(500).json({ message: err.message || "Something Went Wrong!" });
});

// Start the Server
const server = app.listen(PORT, () => {
	console.log(`🚀 Server running on port ${PORT}`);
});

// Socket.IO Setup
const { Server } = require("socket.io");
const io = new Server(server, {
	pingTimeout: 60000,
	transports: ["websocket"],
	cors: {
		origin: allowedOrigins,
		methods: ["GET", "POST"],
		credentials: true,
	},
});

// Socket.IO Connection
io.on("connection", (socket) => {
	console.log("🟢 Socket connected:", socket.id);

	// User Setup and Messaging Handlers
	const setupHandler = (userId) => {
		if (!socket.hasJoined) {
			socket.join(userId);
			socket.hasJoined = true;
			console.log(`User joined: ${userId}`);
			socket.emit("connected");
		}
	};

	const newMessageHandler = (newMessageReceived) => {
		let chat = newMessageReceived?.chat;
		chat?.users.forEach((user) => {
			if (user._id !== newMessageReceived.sender._id) {
				console.log(`Message received by: ${user._id}`);
				socket.in(user._id).emit("message received", newMessageReceived);
			}
		});
	};

	const joinChatHandler = (room) => {
		if (socket.currentRoom) socket.leave(socket.currentRoom);
		socket.join(room);
		socket.currentRoom = room;
		console.log(`User joined Room: ${room}`);
	};

	const typingHandler = (room) => socket.in(room).emit("typing");
	const stopTypingHandler = (room) => socket.in(room).emit("stop typing");

	const clearChatHandler = (chatId) => socket.in(chatId).emit("clear chat", chatId);
	const deleteChatHandler = (chat, authUserId) => {
		chat.users.forEach((user) => {
			if (authUserId !== user._id) {
				console.log(`Chat deleted: ${user._id}`);
				socket.in(user._id).emit("delete chat", chat._id);
			}
		});
	};

	const chatCreateChatHandler = (chat, authUserId) => {
		chat.users.forEach((user) => {
			if (authUserId !== user._id) {
				console.log(`Chat created: ${user._id}`);
				socket.in(user._id).emit("chat created", chat);
			}
		});
	};

	// Socket Event Listeners
	socket.on("setup", setupHandler);
	socket.on("new message", newMessageHandler);
	socket.on("join chat", joinChatHandler);
	socket.on("typing", typingHandler);
	socket.on("stop typing", stopTypingHandler);
	socket.on("clear chat", clearChatHandler);
	socket.on("delete chat", deleteChatHandler);
	socket.on("chat created", chatCreateChatHandler);

	socket.on("disconnect", () => {
		console.log("🔴 Socket disconnected:", socket.id);
	});
});
