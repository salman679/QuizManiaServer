require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const bcrypt = require("bcrypt");

const app = express()
app.use(express.json())
app.use(morgan('dev'))
app.use(cors({
    origin: [
        'http://localhost:3000',
        'https://quizmania-chi.vercel.app'
    ],
    credentials: true
}))
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

        // Users Collection 
        const usersCollection = database.collection("users")

        // Create quiz API
        app.post('/generate-quiz', async (req, res) => {
            try {
                const { user, quizCriteria } = req.body;
                console.log(req.body)
                // *Improved Prompting for Strict JSON Response*

                const prompt = `
                    Generate a ${quizCriteria.difficulty} level quiz on "${quizCriteria.topic}" with ${quizCriteria.quizType} questions.
                    - Number of Questions: ${quizCriteria.quantity}
                    - Return ONLY a valid JSON array. No extra text.
                    - Each question should have:
                        - "type": ${quizCriteria.quizType}
                        - "question": (Text of the question based on ${quizCriteria.topic})
                        - "options": (Array of choices, only for multiple-choice and for true/false give array of choices of True and False)
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

                console.log("🔹 Raw AI Response:", quizData);

                // *Extract JSON if wrapped in extra text*
                const jsonMatch = quizData.match(/json([\s\S]*?)/);
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
                    user: user
                }

                const result = await quizzesCollection.insertOne(updatedData)

                // Send the response
                res.json({
                    status: true,
                    message: "✅ Successfully generated quiz from AI",
                    quizCriteria,
                    quizzes: parsedQuizData,
                    result
                });

            } catch (err) {
                console.error("❌ Error generating quiz:", err);
                res.status(500).json({ status: false, message: err.message });
            }
        });

        // get the quiz set that user just created 
        app.get('/get-quiz-set/:id', async (req, res) => {
            const id = req.params.id;
            const result = await quizzesCollection.findOne({ _id: new ObjectId(id) });
            res.json(result);
        })

        // checking the quiz answer 
        app.post('/answer/checking', async (req, res) => {
            const { id, answers } = req.body;
            const quiz = await quizzesCollection.findOne({ _id: new ObjectId(id) });
            let score = 0;
            quiz.parsedQuizData.forEach((question, index) => {
                if (question.answer === answers[index]) {
                    score++;
                }
            })
            res.json({ score });
        })

        // stored user into the mongodb API 
        app.post('/register', async (req, res) => {
            try {
                const user = req.body;
                const existingUser = await usersCollection.findOne({ email: user?.email });

                if (existingUser) {
                    const updatedData = {
                        $set: {
                            lastLoginTime: user?.lastLoginTime
                        }
                    };
                    const result = await usersCollection.updateOne({ email: user?.email }, updatedData);

                    return res.json({
                        status: false,
                        message: 'User already exists, lastSignInTime updated',
                        data: result
                    });
                }
                const withRole = {
                    ...user, role: "user"
                }
                const insertResult = await usersCollection.insertOne(withRole);
                res.json({
                    status: true,
                    message: 'User added successfully',
                    data: insertResult
                });


            } catch (error) {
                console.error('Error adding/updating user:', error);
                res.status(500).json({
                    status: false,
                    message: 'Failed to add or update userr',
                    error: error.message
                });
            }
        });

        // get a user from the mongodb by email API 
        app.get('/user/:email', async (req, res) => {
            const email = req.params.email
            const user = await usersCollection.findOne({ email })
            if (!user) {
                res.json({ status: false, message: "User not found" })
            }
            res.json({
                status: true,
                userInfo: user
            })
        })

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




// "text": "```json\n[\n  {\n    \"type\": \"Multiple Choice\",\n    \"question\": \"What keyword is used to define a function in Python?\",\n    \"options\": [\"def\", \"function\", \"define\", \"func\"],\n    \"answer\": \"def\"\n  },\n  {\n    \"type\": \"Multiple Choice\",\n    \"question\": \"Which of the following is NOT a built-in data type in Python?\",\n    \"options\": [\"Integer\", \"String\", \"Float\", \"Character\"],\n    \"answer\": \"Character\"\n  }\n]\n```"


// "quizzes": [
//         {
//             "type": "Multiple Choice",
//             "question": "What keyword is used to define a function in Python?",
//             "options": [
//                 "def",
//                 "function",
//                 "define",
//                 "func"
//             ],
//             "answer": "def"
//         },
//         {
//             "type": "Multiple Choice",
//             "question": "Which of the following is NOT a built-in data type in Python?",
//             "options": [
//                 "Integer",
//                 "String",
//                 "Float",
//                 "Character"
//             ],
//             "answer": "Character"
//         }
//     ]