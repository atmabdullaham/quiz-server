// backend/server.js
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import admin from "firebase-admin";
import mongoose from "mongoose";
import { filterQuizzesByBangladeshTime } from "./timezoneUtils.js";

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
  'http://localhost:5174',
  'https://quiz-platform-3d14e.web.app',
  'https://quiz-server-kappa.vercel.app'
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

// ✅ ROOT ROUTE - Health Check
app.get('/', (req, res) => {
  res.json({
    message: '✅ Quiz Platform Backend API is Running',
    status: 'online',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: '/auth/register, /auth/user',
      quizzes: '/api/quizzes, /api/quizzes/:id',
      submissions: '/api/submissions',
      leaderboard: '/api/quizzes/:id/leaderboard',
      admin: '/api/admin/*'
    }
  });
});

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

// Published Result Schema
const publishedResultSchema = new mongoose.Schema({
  quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
  publishType: { type: String, enum: ['classwise', 'overall'], required: true },
  winners: [{
    studentName: String,
    schoolName: String,
    className: String,
    rollNumber: String,
    score: Number,
    position: Number // 1, 2, 3, etc.
  }],
  publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  publishedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

const PublishedResult = mongoose.model('PublishedResult', publishedResultSchema);

// Notice Schema
const noticeSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  displayLocation: { type: String, enum: ['quiz', 'result', 'all'], default: 'all' },
  isActive: { type: Boolean, default: true },
  displayOrder: { type: Number, default: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Notice = mongoose.model('Notice', noticeSchema);

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

// Optional Auth Middleware - allows both authenticated and public users
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
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
    }
    // If no token, req.user remains undefined (public user)
    next();
  } catch (error) {
    console.error('Optional auth error:', error);
    // Continue as public user on error
    next();
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
    // Get all non-draft quizzes (admin will filter by status)
    const query = {
      status: { $ne: 'draft' }
    };
    
    const allQuizzes = await Quiz.find(query)
      .select('-questions.correctAnswer')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 });
    
    // Filter based on Bangladesh timezone
    const quizzes = filterQuizzesByBangladeshTime(allQuizzes);
    
    res.json(quizzes);
  } catch (error) {
    console.error('Error fetching quizzes:', error);
    res.status(500).json({ message: error.message });
  }
});

// Check if user has already submitted a quiz
app.get('/api/quizzes/:id/check-submission', optionalAuth, async (req, res) => {
  try {
    const { mobileNumber } = req.query;
    
    let submission;
    
    if (req.user) {
      // Authenticated user - check by userId
      submission = await Submission.findOne({
        quizId: req.params.id,
        userId: req.user._id
      });
    } else if (mobileNumber) {
      // Public user - check by mobile number
      submission = await Submission.findOne({
        quizId: req.params.id,
        mobileNumber: mobileNumber
      });
    }
    
    res.json({ 
      hasSubmitted: !!submission,
      submission: submission || null
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get quiz by ID (for taking quiz)
app.get('/api/quizzes/:id', optionalAuth, async (req, res) => {
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
app.post('/api/quizzes/:id/submit', optionalAuth, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }
    
    const { answers, timeTaken, studentInfo } = req.body;
    
    // Validate student info
    if (!studentInfo || !studentInfo.studentName || !studentInfo.schoolName || !studentInfo.className) {
      return res.status(400).json({ message: 'Student information is required' });
    }
    
    // Check if already submitted
    let existingSubmission;
    
    if (req.user) {
      // Authenticated user - check by userId
      existingSubmission = await Submission.findOne({
        quizId: req.params.id,
        userId: req.user._id
      });
    } else {
      // Public user - check by mobile number
      if (!studentInfo.mobileNumber) {
        return res.status(400).json({ message: 'Mobile number is required for public submission' });
      }
      existingSubmission = await Submission.findOne({
        quizId: req.params.id,
        mobileNumber: studentInfo.mobileNumber
      });
    }
    
    if (existingSubmission) {
      return res.status(400).json({ message: 'You have already submitted this quiz' });
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
      userId: req.user ? req.user._id : null,
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

// Get user's submission for a quiz (authenticated users only)
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

// Get user's submission with complete answer details - works for both authenticated and public users
app.get('/api/quizzes/:id/my-submission', optionalAuth, async (req, res) => {
  try {
    const { mobileNumber } = req.query;
    const quizId = req.params.id;

    // Get the quiz first to access question details
    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    let submission;

    if (req.user) {
      // Authenticated user - find by userId
      submission = await Submission.findOne({
        quizId: quizId,
        userId: req.user._id
      });
    } else if (mobileNumber) {
      // Public user - find by mobile number
      submission = await Submission.findOne({
        quizId: quizId,
        mobileNumber: mobileNumber
      });
    } else {
      return res.status(400).json({ message: 'Mobile number required for public users' });
    }

    if (!submission) {
      return res.status(404).json({ message: 'No submission found for this quiz' });
    }

    // Enrich answers with question text and options
    const enrichedAnswers = submission.answers.map((answer, index) => {
      const question = quiz.questions[index];
      return {
        questionId: answer.questionId,
        questionText: question?.question || '',
        selectedOption: question?.options?.[answer.selectedOption] || 'No answer',
        correctOption: question?.options?.[question?.correctAnswer] || '',
        isCorrect: answer.isCorrect,
        selectedOptionIndex: answer.selectedOption
      };
    });

    // Return complete submission data
    res.json({
      _id: submission._id,
      quizId: submission.quizId,
      score: submission.score,
      totalQuestions: submission.totalQuestions,
      timeTaken: submission.timeTaken,
      submittedAt: submission.submittedAt,
      studentName: submission.studentName,
      schoolName: submission.schoolName,
      className: submission.className,
      rollNumber: submission.rollNumber,
      mobileNumber: submission.mobileNumber,
      address: submission.address,
      answers: enrichedAnswers
    });
  } catch (error) {
    console.error('Error fetching submission:', error);
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

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Result Publishing Routes

// Get submissions for result publishing (classwise or overall)
app.get('/api/admin/quizzes/:id/prepare-publish/:publishType', authenticateUser, isAdmin, async (req, res) => {
  try {
    const { id, publishType } = req.params;
    const submissions = await Submission.find({ quizId: id }).sort({ score: -1 });

    if (publishType === 'classwise') {
      // Group by class and get top 3 from each
      const grouped = {};
      submissions.forEach(sub => {
        if (!grouped[sub.className]) {
          grouped[sub.className] = [];
        }
        if (grouped[sub.className].length < 3) {
          grouped[sub.className].push(sub);
        }
      });
      res.json(grouped);
    } else if (publishType === 'overall') {
      // Return top 15 overall
      res.json(submissions.slice(0, 15));
    } else {
      res.status(400).json({ message: 'Invalid publish type' });
    }
  } catch (error) {
    console.error('Error preparing publish:', error);
    res.status(500).json({ message: error.message || 'Failed to prepare results' });
  }
});

// Publish results
app.post('/api/admin/quizzes/:id/publish-results', authenticateUser, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { publishType, selectedWinners } = req.body;

    // Get quiz info
    const quiz = await Quiz.findById(id);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    // Check if result already published
    const existingResult = await PublishedResult.findOne({ quizId: id });
    if (existingResult) {
      // Update existing result
      existingResult.publishType = publishType;
      existingResult.winners = selectedWinners;
      existingResult.publishedAt = new Date();
      await existingResult.save();
      return res.json(existingResult);
    }

    // Create new published result
    const result = new PublishedResult({
      quizId: id,
      publishType,
      winners: selectedWinners,
      publishedBy: req.user._id,
      publishedAt: new Date()
    });

    await result.save();
    res.json(result);
  } catch (error) {
    console.error('Error publishing result:', error);
    res.status(500).json({ message: error.message || 'Failed to publish result' });
  }
});

// Get published results for a quiz (public route)
app.get('/api/published-results/:quizId', async (req, res) => {
  try {
    const { quizId } = req.params;
    const result = await PublishedResult.findOne({ quizId }).populate('quizId', 'title');
    
    if (!result) {
      return res.status(404).json({ message: 'Result not published yet' });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching published result:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch result' });
  }
});

// Get all published results
app.get('/api/published-results', async (req, res) => {
  try {
    const results = await PublishedResult.find()
      .populate('quizId', 'title')
      .sort({ publishedAt: -1 });
    res.json(results || []);
  } catch (error) {
    console.error('Error fetching published results:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch results' });
  }
});

// Notice Routes

// Get all notices (admin)
app.get('/api/admin/notices', authenticateUser, isAdmin, async (req, res) => {
  try {
    const notices = await Notice.find()
      .populate('createdBy', 'name')
      .sort({ displayOrder: 1, createdAt: -1 });
    res.json(notices || []);
  } catch (error) {
    console.error('Error fetching notices:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch notices' });
  }
});

// Get active notices for quiz/result pages (public)
app.get('/api/notices/:displayLocation', async (req, res) => {
  try {
    const { displayLocation } = req.params;
    const notices = await Notice.find({
      isActive: true,
      displayLocation: { $in: [displayLocation, 'all'] }
    })
      .sort({ displayOrder: 1, createdAt: -1 });
    res.json(notices || []);
  } catch (error) {
    console.error('Error fetching notices:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch notices' });
  }
});

// Create notice (admin)
app.post('/api/admin/notices', authenticateUser, isAdmin, async (req, res) => {
  try {
    const { title, content, displayLocation } = req.body;

    if (!title || !content || !displayLocation) {
      return res.status(400).json({ message: 'Title, content, and displayLocation are required' });
    }

    const notice = await Notice.create({
      title,
      content,
      displayLocation,
      createdBy: req.user._id,
      displayOrder: 0
    });

    await notice.populate('createdBy', 'name');
    res.status(201).json(notice);
  } catch (error) {
    console.error('Error creating notice:', error);
    res.status(500).json({ message: error.message || 'Failed to create notice' });
  }
});

// Update notice (admin)
app.put('/api/admin/notices/:id', authenticateUser, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, displayLocation, isActive, displayOrder } = req.body;

    const notice = await Notice.findByIdAndUpdate(
      id,
      {
        title,
        content,
        displayLocation,
        isActive,
        displayOrder,
        updatedAt: new Date()
      },
      { new: true }
    ).populate('createdBy', 'name');

    if (!notice) {
      return res.status(404).json({ message: 'Notice not found' });
    }

    res.json(notice);
  } catch (error) {
    console.error('Error updating notice:', error);
    res.status(500).json({ message: error.message || 'Failed to update notice' });
  }
});

// Delete notice (admin)
app.delete('/api/admin/notices/:id', authenticateUser, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const notice = await Notice.findByIdAndDelete(id);

    if (!notice) {
      return res.status(404).json({ message: 'Notice not found' });
    }

    res.json({ message: 'Notice deleted successfully' });
  } catch (error) {
    console.error('Error deleting notice:', error);
    res.status(500).json({ message: error.message || 'Failed to delete notice' });
  }
});

// Delete published result (admin)
app.delete('/api/admin/published-results/:id', authenticateUser, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await PublishedResult.findByIdAndDelete(id);

    if (!result) {
      return res.status(404).json({ message: 'Published result not found' });
    }

    res.json({ message: 'Published result deleted successfully' });
  } catch (error) {
    console.error('Error deleting published result:', error);
    res.status(500).json({ message: error.message || 'Failed to delete published result' });
  }
});

// Student Profile Routes - SECURITY: Only authenticated user can view/update their own profile
// GET /api/student-profile - Fetch student profile by email (authenticated user only)
app.get('/api/student-profile', authenticateUser, async (req, res) => {
  try {
    const userEmail = req.user.email;

    // Find the latest submission for this user (contains student info)
    const submission = await Submission.findOne({ userId: req.user._id })
      .sort({ submittedAt: -1 });

    if (!submission) {
      return res.json({
        studentName: '',
        schoolName: '',
        className: '',
        rollNumber: '',
        mobileNumber: '',
        address: ''
      });
    }

    res.json({
      studentName: submission.studentName || '',
      schoolName: submission.schoolName || '',
      className: submission.className || '',
      rollNumber: submission.rollNumber || '',
      mobileNumber: submission.mobileNumber || '',
      address: submission.address || ''
    });
  } catch (error) {
    console.error('Error fetching student profile:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch student profile' });
  }
});

// PUT /api/student-profile - Update student profile (authenticated user only, email verification)
app.put('/api/student-profile', authenticateUser, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const { studentName, schoolName, className, rollNumber, mobileNumber, address } = req.body;

    // SECURITY: Verify that the authenticated user's email matches the request
    // This ensures no one can update another user's profile via API manipulation
    if (req.user.email !== userEmail) {
      return res.status(403).json({ 
        message: 'Unauthorized: Cannot update another user\'s profile' 
      });
    }

    // Validation
    if (!studentName || !schoolName || !className || !rollNumber || !mobileNumber || !address) {
      return res.status(400).json({ 
        message: 'All fields are required' 
      });
    }

    // Validate Bangladeshi phone number
    const banglaPhoneRegex = /^(01[3-9][0-9]{8}|01[3-9][0-9]{8})$/;
    if (!banglaPhoneRegex.test(mobileNumber)) {
      return res.status(400).json({ 
        message: 'Invalid Bangladeshi phone number' 
      });
    }

    // Validate roll number (should be numeric)
    if (!/^\d+$/.test(rollNumber)) {
      return res.status(400).json({ 
        message: 'Roll number must be numeric' 
      });
    }

    // Validate class (should be 4-12)
    const classNum = parseInt(className);
    if (isNaN(classNum) || classNum < 4 || classNum > 12) {
      return res.status(400).json({ 
        message: 'Class must be between 4 and 12' 
      });
    }

    res.json({ 
      message: 'Student profile updated successfully. Will be applied to next quiz submission.',
      studentName,
      schoolName,
      className: classNum.toString(),
      rollNumber,
      mobileNumber,
      address
    });
  } catch (error) {
    console.error('Error updating student profile:', error);
    res.status(500).json({ message: error.message || 'Failed to update student profile' });
  }
});

// 404 Handler - Catch all undefined routes
app.use((req, res) => {
  res.status(404).json({
    message: 'Endpoint not found',
    path: req.path,
    method: req.method,
    availableEndpoints: {
      root: 'GET /',
      auth: ['POST /auth/register', 'GET /auth/user'],
      quizzes: ['GET /api/quizzes', 'GET /api/quizzes/:id', 'POST /api/admin/quizzes'],
      submissions: ['POST /api/submissions', 'GET /api/submissions/:id'],
      leaderboard: 'GET /api/quizzes/:id/leaderboard'
    }
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});