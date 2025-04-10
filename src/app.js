require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const bcrypt = require("bcrypt");
const nodemailer = require('nodemailer')

const app = express()
app.use(express.json())
app.use(morgan('dev'))
app.use(cors({
    origin: [
        'http://localhost:3000',
        'https://quizmaniaa.vercel.app',
        'https://quiz-maniaa.vercel.app',
        'https://quizzmaniaa.vercel.app'
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

        // Reset Password Expire Collection 
        const expireCollection = database.collection("expire")

        // Create quiz API
        app.post('/generate-quiz', async (req, res) => {
            try {
                const { user, quizCriteria } = req.body;

                // **Improved Prompting for Strict JSON Response**

                const prompt = `
                    Generate a ${quizCriteria.difficulty} level quiz on "${quizCriteria.topic}" with ${quizCriteria.quizType} questions.
                    - Number of Questions: ${quizCriteria.quantity}
                    - Return ONLY a valid JSON array. No extra text.
                    - Each question should have:
                        - "type": (Multiple Choice / True or False)
                        - "question": (Text of the question)
                        - "options": (An array of choices, required only for "Multiple Choice" and "True/False" question types. For "True/False" questions, the allowed options are only ["True", "False"] but for multiple choice there should be no true or false as  options)
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
                // const demo = response.response

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
                    user,
                    quizCriteria,
                    parsedQuizData,
                }

                const result = await quizzesCollection.insertOne(updatedData)

                // Send the response
                res.json({
                    status: true,
                    message: "✅ Successfully generated quiz from AI",
                    result,
                    user,
                    quizCriteria,
                    quizzes: parsedQuizData
                });

            } catch (err) {
                console.error("❌ Error generating quiz:", err);
                res.status(500).json({ status: false, message: err.message });
            }
        });

        // get the quiz set that user just created API
        app.get('/get-quiz-set/:id', async (req, res) => {
            const id = req.params.id;
            const result = await quizzesCollection.findOne({ _id: new ObjectId(id) });
            res.json(result);
        })

        // checking the quiz answer API
        app.post('/answer/checking', async (req, res) => {
            try {
                const { id, answers } = req.body;
                let quizSet = await quizzesCollection.findOne({ _id: new ObjectId(id) });

                if (!quizSet) {
                    return res.json({ status: false, message: "Quiz not found" });
                }

                const totalQuizInSet = quizSet.parsedQuizData.length;
                let correctQuizAnswer = 0; // ✅ Initialize properly

                const updatePromises = answers.map((answer, index) => {
                    const quizQuestion = quizSet.parsedQuizData[index];

                    if (quizQuestion.question === answer.question && quizQuestion.answer === answer.userAnswer) {
                        correctQuizAnswer++; // ✅ Synchronously update count
                    }

                    return quizzesCollection.updateOne(
                        { _id: new ObjectId(id), "parsedQuizData.question": quizQuestion.question },
                        { $set: { "parsedQuizData.$.userAnswer": answer.userAnswer, "parsedQuizData.$.status": answer.userAnswer === quizQuestion.answer ? "correct" : "wrong" } }
                    );
                });

                await Promise.all(updatePromises); // ✅ Wait for all updates

                // ✅ Update correct & incorrect answer counts in the database
                await quizzesCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { correctQuizAnswer, wrongQuizAnswer: totalQuizInSet - correctQuizAnswer, status: "solved" } }
                );

                // override quizSet 
                quizSet = await quizzesCollection.findOne({ _id: new ObjectId(id) });

                res.json({
                    status: true,
                    totalQuizInSet,
                    quizSet,
                    correctQuizAnswer, // ✅ Now this should not be NaN
                    wrongQuizAnswer: totalQuizInSet - correctQuizAnswer, // ✅ Ensure correct value
                });

            } catch (err) {
                console.error("❌ Error checking quiz:", err);
                res.status(500).json({ status: false, message: err.message });
            }
        });

        // stored user into the mongodb API 
        app.post('/signup', async (req, res) => {
            try {
                const { password, ...user } = req.body;
                const existingUser = await usersCollection.findOne({ email: user?.email });

                if (existingUser) {
                    return res.json({
                        status: false,
                        message: 'User already exists, use another email address',
                        data: result
                    });
                }

                const hashedPass = await bcrypt.hash(password, 10)

                const withRole = {
                    ...user, password: hashedPass, role: "user", failedAttempts: 0, block: false
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
        app.post('/signin/:email', async (req, res) => {
            const email = req.params.email

            const { password, ...userInfo } = req.body

            let user = await usersCollection.findOne({ email })
            if (!user) {
                res.json({ status: false, message: "User not found" })
                return
            }

            if (user?.block) {
                res.json({ status: false, message: "This Email has been blocked, Please contact with admin!" })
                return
            }

            const match = await bcrypt.compare(password, user?.password)

            if (!match) {
                if (user?.failedAttempts == 4) {
                    await usersCollection.updateOne({ email: email }, {
                        $set: {
                            block: true
                        }
                    })
                    res.json({ status: false, message: "Your Email Has been blocked Please contact with admin!" })
                    return
                }
                else {
                    const updateFailedAttempts = {
                        $inc: {
                            failedAttempts: 1
                        }
                    }
                    await usersCollection.updateOne({ email: email }, updateFailedAttempts)
                    user = await usersCollection.findOne({ email: email })
                    res.json({ status: false, message: `Incorrect Password, Left ${5 - user?.failedAttempts} Attempts`, failedAttempts: user?.failedAttempts })
                    return
                }
            }

            await usersCollection.updateOne({ email: email }, {
                $set: {
                    failedAttempts: 0
                }
            })

            const updatedData = {
                $set: {
                    lastLoginTime: userInfo?.lastLoginTime
                }
            };

            await usersCollection.updateOne({ email: user?.email }, updatedData);
            res.json({
                status: true,
                userInfo: user,
                message: "Login Successfully"
            })
        })

        // get user for auth js API
        app.get('/signin/:email', async (req, res) => {
            const email = req.params.email
            const userExist = await usersCollection.findOne({ email: email })
            if (!userExist) {
                res.json({ status: false, message: "User Not Found" })
                return
            }
            res.json({
                status: true,
                userInfo: userExist
            })
        })

        // reset password API 
        app.get('/reset-password/:email', async (req, res) => {
            const email = req.params.email
            const userExist = await usersCollection.findOne({ email: email })
            if (!userExist) {
                res.json({ status: false, message: "User Not Found!" })
                return
            }

            const expireUserExist = await expireCollection.findOne({ email: email })

            if (!expireUserExist) {
                await expireCollection.insertOne({
                    email: email,
                    expiresAt: new Date(Date.now() + 1000 * 60 * 5), // 5 min
                })
            }

            if (expireUserExist) {
                await expireCollection.updateOne({ email: email }, {
                    $set: {
                        expiresAt: new Date(Date.now() + 1000 * 60 * 5), // 5 min
                    }
                })
            }

            const html = `
                <p>Hi, ${userExist.username},</p>
                <p>Here's your password recovery link</p>
                <a href="https://quizzmaniaa.vercel.app/auth/reset-password?secretcode=${userExist?._id}">Reset password here</a>
                <p>Best regards, QuizMania </p>
            `;


            const transporter = nodemailer.createTransport({
                service: "gmail",
                auth: {
                    user: process.env.GOOGLE_ACCOUNT_USER,
                    pass: process.env.GOOGLE_ACCOUNT_PASS,
                },
            })

            const info = await transporter.sendMail({
                from: `"QuizMania" <noreply@quizmania.com>`,
                to: email,
                subject: `Reset your QuizMania password`,
                html: html,
            })


            res.json({
                status: true,
                message: "Email send successfully, Check inbox or spam of email",
                email: email,
                info: info,
            });
        })

        // reset password request confirmation API 
        app.patch('/reset-password/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const { password } = req.body;

                const user = await usersCollection.findOne({ _id: new ObjectId(id) });

                const expireUser = await expireCollection.findOne({ email: user?.email })

                const now = new Date();
                const expiresAt = new Date(expireUser?.expiresAt)

                const fiveMinutesInMs = 1000 * 60 * 5;

                if (now.getTime() - expiresAt.getTime() > fiveMinutesInMs) {
                    res.json({
                        expired: true,
                    })
                    return
                }

                if (!user) {
                    return res.status(404).json({
                        status: false,
                        message: "User not found"
                    });
                }

                const hashedPass = await bcrypt.hash(password, 10);

                const updateDoc = {
                    $set: { password: hashedPass }
                };

                await usersCollection.updateOne({ _id: new ObjectId(id) }, updateDoc);

                res.json({
                    status: true,
                    message: "Password successfully changed"
                });

            } catch (error) {
                console.error("Reset password error:", error);
                res.status(500).json({
                    status: false,
                    message: "Internal server error"
                });
            }
        });

        app.get('/user/stats/:email', async (req, res) => {
            const email = req.params.email
            const totalQuiz = await quizzesCollection.find({ user: email }).toArray()
            const solvedQuiz = await quizzesCollection.find({ user: email, status: "solved" }).toArray()
            const totalCorrect = solvedQuiz.reduce((sum, quiz) => sum + quiz.correctQuizAnswer, 0);
            const totalPossible = solvedQuiz.reduce((sum, quiz) => sum + quiz.parsedQuizData.length, 0);
            const percentage = (totalCorrect / totalPossible) * 100;


            res.json({
                status: true,
                totalQuiz,
                solvedQuiz,
                averageMark: parseInt(percentage)+"%"
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




// pass bhul > failedAttempt + 1
// pass bhul > failedAttempt + 1
// pass bhul > failedAttempt + 1
// pass bhul > failedAttempt + 1
// pass bhul > failedAttempt + 1

// block: true failedAttempt == 5


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