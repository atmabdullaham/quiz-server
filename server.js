// backend/server.js
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import admin from "firebase-admin";
import mongoose from "mongoose";

dotenv.config();

const app = express();

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_CREDENTIALS);
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
// Middleware
app.use(express.json());
const allowedOrigins = [
  'http://localhost:5173',
  'https://quiz-platform-3d14e.web.app'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));


// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/quiz-platform', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// User Schema
const userSchema = new mongoose.Schema({
  firebaseUid: { type: String, required: true, unique: true },
  email: String,
  name: String,
  picture: String,
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Quiz Schema
const quizSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  timeLimit: { type: Number, required: true },
  status: { type: String, enum: ['draft', 'scheduled', 'active', 'ended'], default: 'draft' },
  startDate: Date,
  endDate: Date,
  questions: [{
    question: { type: String, required: true },
    options: [{ type: String, required: true }],
    correctAnswer: { type: Number, required: true },
    points: { type: Number, default: 1 }
  }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

const Quiz = mongoose.model('Quiz', quizSchema);

// Submission Schema - UPDATED with student info
const submissionSchema = new mongoose.Schema({
  quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Student Information (Bangla fields)
  studentName: { type: String, required: true }, // নাম
  schoolName: { type: String, required: true }, // শিক্ষা প্রতিষ্ঠান
  className: { type: String, required: true }, // ক্লাস/শ্রেণি/বর্ষ
  rollNumber: String, // রোল
  mobileNumber: String, // মোবাইল নম্বর
  address: String, // ঠিকানা
  // Quiz data
  answers: [{
    questionId: String,
    selectedOption: Number,
    isCorrect: Boolean
  }],
  score: { type: Number, default: 0 },
  totalQuestions: Number,
  submittedAt: { type: Date, default: Date.now },
  timeTaken: Number
});

// Compound index to ensure one submission per user per quiz
submissionSchema.index({ quizId: 1, userId: 1 }, { unique: true });

const Submission = mongoose.model('Submission', submissionSchema);

// Firebase Auth Middleware
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    // Find or create user in database
    let user = await User.findOne({ firebaseUid: decodedToken.uid });
    
    if (!user) {
      user = await User.create({
        firebaseUid: decodedToken.uid,
        email: decodedToken.email,
        name: decodedToken.name || decodedToken.email.split('@')[0],
        picture: decodedToken.picture || null
      });
    }
    
    req.user = user;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ message: 'Unauthorized: Invalid token' });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  res.status(403).json({ message: 'Forbidden: Admin access required' });
};

// Routes

// Auth Routes
app.post('/auth/register', async (req, res) => {
  try {
    const { firebaseUid, email, name, picture } = req.body;
    
    let user = await User.findOne({ firebaseUid });
    
    if (!user) {
      user = await User.create({
        firebaseUid,
        email,
        name: name || email.split('@')[0],
        picture: picture || null
      });
    }
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/auth/user', authenticateUser, (req, res) => {
  res.json(req.user);
});

// Quiz Routes

// Get all quizzes (public - only active/scheduled)
app.get('/api/quizzes', async (req, res) => {
  try {
    const now = new Date();
    
    const query = {
      $or: [
        { 
          status: 'active',
          $or: [
            { startDate: { $exists: false } },
            { startDate: { $lte: now } }
          ],
          $or: [
            { endDate: { $exists: false } },
            { endDate: { $gte: now } }
          ]
        },
        { 
          status: 'scheduled',
          startDate: { $exists: true, $gt: now }
        }
      ]
    };
    
    const quizzes = await Quiz.find(query)
      .select('-questions.correctAnswer')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 });
    
    res.json(quizzes);
  } catch (error) {
    console.error('Error fetching quizzes:', error);
    res.status(500).json({ message: error.message });
  }
});

// Check if user has already submitted a quiz
app.get('/api/quizzes/:id/check-submission', authenticateUser, async (req, res) => {
  try {
    const submission = await Submission.findOne({
      quizId: req.params.id,
      userId: req.user._id
    });
    
    res.json({ 
      hasSubmitted: !!submission,
      submission: submission || null
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get quiz by ID (for taking quiz)
app.get('/api/quizzes/:id', authenticateUser, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id).select('-questions.correctAnswer');
    
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }
    
    res.json(quiz);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Admin: Get all quizzes
app.get('/api/admin/quizzes', authenticateUser, isAdmin, async (req, res) => {
  try {
    const quizzes = await Quiz.find().populate('createdBy', 'name').sort({ createdAt: -1 });
    res.json(quizzes);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Admin: Create quiz
app.post('/api/admin/quizzes', authenticateUser, isAdmin, async (req, res) => {
  try {
    const quiz = await Quiz.create({
      ...req.body,
      createdBy: req.user._id
    });
    res.status(201).json(quiz);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Admin: Update quiz
app.put('/api/admin/quizzes/:id', authenticateUser, isAdmin, async (req, res) => {
  try {
    const quiz = await Quiz.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(quiz);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Admin: Delete quiz
app.delete('/api/admin/quizzes/:id', authenticateUser, isAdmin, async (req, res) => {
  try {
    await Quiz.findByIdAndDelete(req.params.id);
    res.json({ message: 'Quiz deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Submit quiz - UPDATED with student info
app.post('/api/quizzes/:id/submit', authenticateUser, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }
    
    // Check if already submitted
    const existingSubmission = await Submission.findOne({
      quizId: req.params.id,
      userId: req.user._id
    });
    
    if (existingSubmission) {
      return res.status(400).json({ message: 'You have already submitted this quiz' });
    }
    
    const { answers, timeTaken, studentInfo } = req.body;
    
    // Validate student info
    if (!studentInfo || !studentInfo.studentName || !studentInfo.schoolName || !studentInfo.className) {
      return res.status(400).json({ message: 'Student information is required' });
    }
    
    // Calculate score
    let score = 0;
    const processedAnswers = answers.map((answer, index) => {
      const question = quiz.questions[index];
      const isCorrect = question && answer.selectedOption === question.correctAnswer;
      
      if (isCorrect) {
        score += question.points || 1;
      }
      return {
        questionId: question._id,
        selectedOption: answer.selectedOption,
        isCorrect
      };
    });
    
    const submission = await Submission.create({
      quizId: req.params.id,
      userId: req.user._id,
      studentName: studentInfo.studentName,
      schoolName: studentInfo.schoolName,
      className: studentInfo.className,
      rollNumber: studentInfo.rollNumber || '',
      mobileNumber: studentInfo.mobileNumber || '',
      address: studentInfo.address || '',
      answers: processedAnswers,
      score,
      totalQuestions: quiz.questions.length,
      timeTaken
    });
    
    res.status(201).json(submission);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get leaderboard for a quiz - UPDATED to show student info
app.get('/api/quizzes/:id/leaderboard', async (req, res) => {
  try {
    const submissions = await Submission.find({ quizId: req.params.id })
      .sort({ score: -1, timeTaken: 1 })
      .limit(100);
    
    const leaderboard = submissions.map((sub, index) => ({
      rank: index + 1,
      studentName: sub.studentName,
      schoolName: sub.schoolName,
      className: sub.className,
      rollNumber: sub.rollNumber,
      score: sub.score,
      totalQuestions: sub.totalQuestions,
      timeTaken: sub.timeTaken,
      submittedAt: sub.submittedAt
    }));
    
    res.json(leaderboard);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get user's submission for a quiz
app.get('/api/quizzes/:id/submission', authenticateUser, async (req, res) => {
  try {
    const submission = await Submission.findOne({
      quizId: req.params.id,
      userId: req.user._id
    }).populate('quizId');
    
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }
    
    res.json(submission);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Admin: Get quiz statistics
app.get('/api/admin/quizzes/:id/stats', authenticateUser, isAdmin, async (req, res) => {
  try {
    const submissions = await Submission.find({ quizId: req.params.id });
    
    const stats = {
      totalParticipants: submissions.length,
      averageScore: submissions.reduce((acc, sub) => acc + sub.score, 0) / submissions.length || 0,
      highestScore: Math.max(...submissions.map(sub => sub.score), 0),
      lowestScore: submissions.length > 0 ? Math.min(...submissions.map(sub => sub.score)) : 0,
      submissions: submissions.sort((a, b) => b.score - a.score)
    };
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Admin: Make user admin (for initial setup)
app.post('/api/admin/make-admin', authenticateUser, async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOneAndUpdate(
      { email },
      { role: 'admin' },
      { new: true }
    );
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});