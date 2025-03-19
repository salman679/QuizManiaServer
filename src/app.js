require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const bcrypt = require("bcrypt");

const app = express();
app.use(express.json());
app.use(morgan('dev'));
app.use(cors({
    origin: [
        'http://localhost:3000',
        'https://quizmania-chi.vercel.app'
    ],
    credentials: true
}));
app.use(cookieParser());

// MongoDB connection
const uri = `mongodb+srv://${process.env.USER_NAME}:${process.env.PASSWORD}@cluster0.4ayta.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Gemini API client
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY); 

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        console.log("✅ Successfully connected to MongoDB!");

        // Database
        const database = client.db('QuizMania')

        // Quizzes Collection
        const quizzesCollection = database.collection("quizzes")

        // Create quiz API
        app.post('/generate-quiz', async (req, res) => {
            try {
                const { topic, difficulty, quantity, quizType } = req.body;

                // **Improved Prompting for Strict JSON Response**
                
                const prompt = `
                    Generate a ${difficulty} level quiz on "${topic}" with ${quizType} questions.
                    - Number of Questions: ${quantity}
                    - Return ONLY a valid JSON array. No extra text.
                    - Each question should have:
                        - "type": (Multiple Choice / True or False / Fill in the Blanks)
                        - "question": (Text of the question)
                        - "options": (Array of choices, only for multiple-choice)
                        - "answer": (Correct answer)
                    
                    Example Output:
                    [
                        {
                            "type": "Multiple Choice",
                            "question": "What is the capital of France?",
                            "options": ["Berlin", "Paris", "Madrid", "Rome"],
                            "answer": "Paris"
                        }
                    ]
                    Do not include explanations, code blocks, or markdown. Just return raw JSON data.
                `;

                // Call Gemini API to generate content
                const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

                const response = await model.generateContent([prompt]);
                
                const quizData = response.response.candidates[0].content.parts[0].text;

                // console.log("🔹 Raw AI Response:", quizData);

                // **Extract JSON if wrapped in extra text**
                const jsonMatch = quizData.match(/```json([\s\S]*?)```/);
                const cleanJson = jsonMatch ? jsonMatch[1].trim() : quizData;

                // Parse the quiz data
                let parsedQuizData;
                try {
                    parsedQuizData = JSON.parse(cleanJson);
                } catch (error) {
                    console.error("❌ JSON Parsing Error:", error);
                    throw new Error("Invalid JSON format received from AI.");
                }

                const updatedData = {
                    parsedQuizData,
                    user : "jaber"
                }

                quizzesCollection.insertOne(updatedData)

                // Send the response
                res.json({
                    status: true,
                    message: "✅ Successfully generated quiz from AI",
                    quantity,
                    difficulty,
                    quizType,
                    topic,
                    quizzes: parsedQuizData
                });

            } catch (err) {
                console.error("❌ Error generating quiz:", err);
                res.status(500).json({ status: false, message: err.message });
            }
        });

    } catch (error) {
        console.error("❌ MongoDB Connection Error:", error);
    }
}
run().catch(console.dir);

// Root route
app.get('/', (req, res) => {
    res.json({ message: "🚀 Yoo Server is running well!!" });
});

module.exports = app;
