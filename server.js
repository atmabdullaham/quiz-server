// backend/server.js
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import admin from "firebase-admin";
import mongoose from "mongoose";
import { filterQuizzesByBangladeshTime } from "./timezoneUtils.js";

dotenv.config();

const app = express();

if (!process.env.FIREBASE_ADMIN_CREDENTIALS) {
  throw new Error("Missing FIREBASE_ADMIN_CREDENTIALS in backend environment.");
}

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_CREDENTIALS);

if (!serviceAccount.private_key) {
  throw new Error("Invalid FIREBASE_ADMIN_CREDENTIALS: private_key is missing.");
}

serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
// Middleware
app.use(express.json());
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  ...((process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)),
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


// MongoDB Connection with Fallback Strategy
let mongodbUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/quiz-platform';

const connectMongoDB = async () => {
  try {
    await mongoose.connect(mongodbUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ MongoDB connected successfully');
    console.log(`📍 Database URI: ${mongodbUri.split('@')[1] || 'local'}`);
    return true;
  } catch (atlasErr) {
    console.error('⚠️  MongoDB Atlas connection failed:', atlasErr.message);
    
    if (mongodbUri.includes('mongodb+srv://')) {
      console.log('\n🔧 Troubleshooting MongoDB Atlas connection:');
      console.log('   1. Verify your IP is whitelisted in Atlas Network Access');
      console.log('   2. Check your internet connection');
      console.log('   3. Ensure credentials in .env are correct');
      console.log('\n📌 Attempting fallback to local MongoDB...\n');
      
      try {
        await mongoose.connect('mongodb://localhost:27017/quiz-platform', {
          useNewUrlParser: true,
          useUnifiedTopology: true,
          serverSelectionTimeoutMS: 3000,
        });
        console.log('✅ Connected to local MongoDB (development mode)');
        console.log('⚠️  Note: Use Atlas for production data persistence\n');
        return true;
      } catch (localErr) {
        console.error('\n❌ Local MongoDB not running. Starting options:');
        console.log('   Windows: Install MongoDB Community Edition or use Docker');
        console.log('   Command: mongod');
        console.log('\n   Or fix Atlas connection:\n');
        throw atlasErr;
      }
    } else {
      throw atlasErr;
    }
  }
};

connectMongoDB().catch(err => {
  console.error('\n🚨 Critical: Cannot connect to any database');
  console.error('Error:', err.message);
  console.error('\n💡 Quick fix: Install and start local MongoDB');
  process.exit(1);
});

// ✅ ROOT ROUTE - Health Check (Minimal - No Endpoint Disclosure for Security)
app.get('/', (req, res) => {
  res.json({
    message: '✅ Quiz Platform Backend API',
    status: 'online',
    version: '1.0.0'
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

// StudentProfile Schema - Stores student information separately
const studentProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Optional for public users
  email: { type: String, required: true }, // Email for uniqueness with phone
  studentName: { type: String, required: true }, // নাম
  schoolName: { type: String, required: true }, // শিক্ষা প্রতিষ্ঠান
  className: { type: String, required: true }, // ক্লাস/শ্রেণি/বর্ষ
  rollNumber: String, // রোল
  mobileNumber: { type: String, required: true }, // মোবাইল নম্বর
  address: String, // ঠিকানা
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

// Compound unique index: (mobileNumber + email) - prevents duplicate phone+email combos
studentProfileSchema.index({ mobileNumber: 1, email: 1 }, { unique: true });
// Index on userId for fast lookups (if user is authenticated)
studentProfileSchema.index({ userId: 1 }, { sparse: true, unique: true });
// Index on email for public user lookups
studentProfileSchema.index({ email: 1 });

const StudentProfile = mongoose.model('StudentProfile', studentProfileSchema);

// Quiz Schema
const quizSchema = new mongoose.Schema({
  title: { type: String, required: true },
  subtitle: { type: String, required: true },
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

// Submission Schema - UPDATED with student info and StudentProfile reference
const submissionSchema = new mongoose.Schema({
  quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Optional for public submissions
  studentProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true }, // Reference to StudentProfile (required)
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

// Compound index to ensure one submission per quiz per user (if userId exists)
submissionSchema.index({ quizId: 1, userId: 1 }, { sparse: true, unique: true });
// Index for public users via studentProfileId
submissionSchema.index({ quizId: 1, studentProfileId: 1 }, { sparse: true, unique: true });

const Submission = mongoose.model('Submission', submissionSchema);

// Published Result Schema
const publishedResultSchema = new mongoose.Schema({
  quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
  publishType: { type: String, enum: ['classwise', 'overall'], required: true },
  winners: [{
    studentProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
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
  displayLocation: { type: String, enum: ['home', 'quiz', 'result', 'all'], default: 'all' },
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

// Check if user has already submitted a quiz - using Phone + Email composite for public users
app.get('/api/quizzes/:id/check-submission', optionalAuth, async (req, res) => {
  try {
    const { mobileNumber, email } = req.query;
    
    let submission;
    let phoneConflict = null;
    
    if (req.user) {
      // Authenticated user - check by userId
      submission = await Submission.findOne({
        quizId: req.params.id,
        userId: req.user._id
      });
    } else if (mobileNumber && email) {
      // Public user - find StudentProfile by (phone + email), then check submission
      const studentProfile = await StudentProfile.findOne({ 
        mobileNumber: mobileNumber,
        email: email 
      });
      
      if (studentProfile) {
        submission = await Submission.findOne({
          quizId: req.params.id,
          studentProfileId: studentProfile._id
        });
      } else {
        // Check if phone exists with DIFFERENT email
        const phoneWithDifferentEmail = await StudentProfile.findOne({
          mobileNumber: mobileNumber,
          email: { $ne: email }
        });
        
        if (phoneWithDifferentEmail) {
          phoneConflict = {
            message: `This phone is registered to ${phoneWithDifferentEmail.email}`,
            registeredEmail: phoneWithDifferentEmail.email
          };
        }
      }
    }
    
    res.json({ 
      hasSubmitted: !!submission,
      submission: submission || null,
      phoneConflict: phoneConflict
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

// Submit quiz - UPDATED with Phone + Email composite key
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
    
    // Get email from authenticated user or request
    let email = req.user?.email;
    if (req.user) {
      // Authenticated user - must use their email
      email = req.user.email;
    } else {
      // Public user - get email from request
      if (!studentInfo.email) {
        return res.status(400).json({ message: 'Email is required for public submission' });
      }
      email = studentInfo.email;
    }
    
    // Require mobile number
    if (!studentInfo.mobileNumber) {
      return res.status(400).json({ message: 'Mobile number is required' });
    }
    
    // Check if already submitted - by userId for authenticated, by (phone + email) for public
    let existingSubmission;
    
    if (req.user) {
      // Authenticated user - check by userId
      existingSubmission = await Submission.findOne({
        quizId: req.params.id,
        userId: req.user._id
      });
    } else {
      // Public user - check by studentProfileId (after finding profile by phone+email)
      const publicProfile = await StudentProfile.findOne({
        mobileNumber: studentInfo.mobileNumber,
        email: email
      });
      
      if (publicProfile) {
        existingSubmission = await Submission.findOne({
          quizId: req.params.id,
          studentProfileId: publicProfile._id
        });
      }
    }
    
    if (existingSubmission) {
      return res.status(400).json({ message: 'You have already submitted this quiz' });
    }
    
    // Create or update StudentProfile using (phone + email) composite key
    let studentProfileId = null;
    let studentProfile;
    
    if (req.user) {
      // Authenticated user - find by userId, ensuring email matches
      studentProfile = await StudentProfile.findOne({ userId: req.user._id });
      
      if (studentProfile) {
        // Check if they're trying to change phone to one that's already taken by someone else
        if (studentInfo.mobileNumber !== studentProfile.mobileNumber) {
          const phoneExists = await StudentProfile.findOne({
            mobileNumber: studentInfo.mobileNumber,
            email: email,
            _id: { $ne: studentProfile._id }
          });
          
          if (phoneExists) {
            return res.status(409).json({
              message: 'This phone number is already registered with a different profile',
              error: 'DUPLICATE_PHONE_EMAIL'
            });
          }
        }
        
        // Update existing profile
        studentProfile.studentName = studentInfo.studentName;
        studentProfile.schoolName = studentInfo.schoolName;
        studentProfile.className = studentInfo.className;
        studentProfile.rollNumber = studentInfo.rollNumber || studentProfile.rollNumber;
        studentProfile.mobileNumber = studentInfo.mobileNumber;
        studentProfile.email = email;
        studentProfile.address = studentInfo.address || studentProfile.address;
        studentProfile.updatedAt = new Date();
        await studentProfile.save();
      } else {
        // Create new profile
        studentProfile = new StudentProfile({
          userId: req.user._id,
          email: email,
          studentName: studentInfo.studentName,
          schoolName: studentInfo.schoolName,
          className: studentInfo.className,
          rollNumber: studentInfo.rollNumber || '',
          mobileNumber: studentInfo.mobileNumber,
          address: studentInfo.address || ''
        });
        await studentProfile.save();
      }
    } else {
      // Public user - find by (mobileNumber + email) composite
      studentProfile = await StudentProfile.findOne({
        mobileNumber: studentInfo.mobileNumber,
        email: email
      });
      
      if (studentProfile) {
        // Update existing profile (same person coming back)
        studentProfile.studentName = studentInfo.studentName;
        studentProfile.schoolName = studentInfo.schoolName;
        studentProfile.className = studentInfo.className;
        studentProfile.address = studentInfo.address || studentProfile.address;
        studentProfile.updatedAt = new Date();
        await studentProfile.save();
      } else {
        // Check if this phone exists with DIFFERENT email
        const phoneWithDifferentEmail = await StudentProfile.findOne({
          mobileNumber: studentInfo.mobileNumber,
          email: { $ne: email }
        });
        
        if (phoneWithDifferentEmail) {
          return res.status(409).json({
            message: `This phone number is registered to ${phoneWithDifferentEmail.email}. Please use the correct email.`,
            registeredEmail: phoneWithDifferentEmail.email,
            error: 'DUPLICATE_PHONE_DIFFERENT_EMAIL'
          });
        }
        
        // Create new profile
        studentProfile = new StudentProfile({
          email: email,
          studentName: studentInfo.studentName,
          schoolName: studentInfo.schoolName,
          className: studentInfo.className,
          rollNumber: studentInfo.rollNumber || '',
          mobileNumber: studentInfo.mobileNumber,
          address: studentInfo.address || ''
        });
        await studentProfile.save();
      }
    }
    
    studentProfileId = studentProfile._id;
    
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
      studentProfileId: studentProfileId,
      answers: processedAnswers,
      score,
      totalQuestions: quiz.questions.length,
      timeTaken
    });
    
    res.status(201).json(submission);
  } catch (error) {
    console.error('Error submitting quiz:', error);
    res.status(400).json({ message: error.message });
  }
});

// Get leaderboard for a quiz - Populated from StudentProfile
app.get('/api/quizzes/:id/leaderboard', async (req, res) => {
  try {
    const submissions = await Submission.find({ quizId: req.params.id })
      .populate('studentProfileId', 'studentName schoolName className rollNumber mobileNumber address')
      .sort({ score: -1, timeTaken: 1 })
      .limit(100);
    
    const leaderboard = submissions.map((sub, index) => ({
      rank: index + 1,
      studentName: sub.studentProfileId?.studentName || '',
      schoolName: sub.studentProfileId?.schoolName || '',
      className: sub.studentProfileId?.className || '',
      rollNumber: sub.studentProfileId?.rollNumber || '',
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
    }).populate('quizId').populate('studentProfileId', 'studentName schoolName className rollNumber');
    
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
      // Public user - find StudentProfile first, then find submission
      const studentProfile = await StudentProfile.findOne({ mobileNumber });
      if (studentProfile) {
        submission = await Submission.findOne({
          quizId: quizId,
          studentProfileId: studentProfile._id
        });
      }
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

    // Populate studentProfile and return complete submission data
    await submission.populate('studentProfileId', 'studentName schoolName className rollNumber mobileNumber address');
    
    const profile = submission.studentProfileId;
    res.json({
      _id: submission._id,
      quizId: submission.quizId,
      studentProfileId: submission.studentProfileId._id,
      score: submission.score,
      totalQuestions: submission.totalQuestions,
      timeTaken: submission.timeTaken,
      submittedAt: submission.submittedAt,
      studentName: profile?.studentName || '',
      schoolName: profile?.schoolName || '',
      className: profile?.className || '',
      rollNumber: profile?.rollNumber || '',
      mobileNumber: profile?.mobileNumber || '',
      address: profile?.address || '',
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
    const submissions = await Submission.find({ quizId: req.params.id })
      .populate('studentProfileId', 'studentName schoolName className mobileNumber');
    
    const submissionsWithProfile = submissions.map(sub => ({
      ...sub.toObject(),
      studentName: sub.studentProfileId?.studentName || '',
      schoolName: sub.studentProfileId?.schoolName || '',
      className: sub.studentProfileId?.className || '',
      mobileNumber: sub.studentProfileId?.mobileNumber || ''
    }));
    
    const stats = {
      totalParticipants: submissions.length,
      averageScore: submissions.reduce((acc, sub) => acc + sub.score, 0) / submissions.length || 0,
      highestScore: Math.max(...submissions.map(sub => sub.score), 0),
      lowestScore: submissions.length > 0 ? Math.min(...submissions.map(sub => sub.score)) : 0,
      submissions: submissionsWithProfile.sort((a, b) => b.score - a.score)
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
    const submissions = await Submission.find({ quizId: id })
      .populate('studentProfileId', 'studentName schoolName className rollNumber mobileNumber address')
      .sort({ score: -1 });

    if (publishType === 'classwise') {
      // Group by class and get top 3 from each
      const grouped = {};
      submissions.forEach(sub => {
        const className = sub.studentProfileId?.className || 'Unknown';
        if (!grouped[className]) {
          grouped[className] = [];
        }
        if (grouped[className].length < 3) {
          grouped[className].push(sub);
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

    const enrichedWinners = selectedWinners.map((winner, index) => ({
      studentProfileId: winner.studentProfileId || winner._id,
      score: winner.score,
      position: index + 1
    }));

    // Check if result already published
    const existingResult = await PublishedResult.findOne({ quizId: id });
    if (existingResult) {
      // Update existing result
      existingResult.publishType = publishType;
      existingResult.winners = enrichedWinners;
      existingResult.publishedAt = new Date();
      await existingResult.save();
      return res.json(existingResult);
    }

    // Create new published result
    const result = new PublishedResult({
      quizId: id,
      publishType,
      winners: enrichedWinners,
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
    const result = await PublishedResult.findOne({ quizId })
      .populate('quizId', 'title subtitle')
      .populate('winners.studentProfileId', 'studentName className schoolName');
    
    if (!result) {
      return res.status(404).json({ message: 'Result not published yet' });
    }
    
    // Enrich winners with profile data
    if (result.winners && Array.isArray(result.winners)) {
      result.winners = result.winners.map((winner) => ({
        ...winner.toObject ? winner.toObject() : winner,
        studentName: winner.studentProfileId?.studentName,
        className: winner.studentProfileId?.className,
        schoolName: winner.studentProfileId?.schoolName,
      }));
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
    let results = await PublishedResult.find()
      .populate('quizId', 'title subtitle')
      .populate('winners.studentProfileId', 'studentName className schoolName')
      .sort({ publishedAt: -1 });
    
    // Enrich winners with profile data
    results = results.map((result) => {
      const resultObj = result.toObject();
      if (resultObj.winners && Array.isArray(resultObj.winners)) {
        resultObj.winners = resultObj.winners.map((winner) => ({
          ...winner,
          studentName: winner.studentProfileId?.studentName,
          className: winner.studentProfileId?.className,
          schoolName: winner.studentProfileId?.schoolName,
        }));
      }
      return resultObj;
    });
    
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
// GET /api/student-profile - Fetch student profile by userId (authenticated user only)
app.get('/api/student-profile', authenticateUser, async (req, res) => {
  try {
    // Find student profile by userId
    const studentProfile = await StudentProfile.findOne({ userId: req.user._id });

    if (!studentProfile) {
      // Return empty profile if doesn't exist
      return res.json({
        _id: null,
        studentName: '',
        schoolName: '',
        className: '',
        rollNumber: '',
        mobileNumber: '',
        address: ''
      });
    }

    res.json({
      _id: studentProfile._id,
      studentName: studentProfile.studentName || '',
      schoolName: studentProfile.schoolName || '',
      className: studentProfile.className || '',
      rollNumber: studentProfile.rollNumber || '',
      mobileNumber: studentProfile.mobileNumber || '',
      address: studentProfile.address || '',
      updatedAt: studentProfile.updatedAt
    });
  } catch (error) {
    console.error('Error fetching student profile:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch student profile' });
  }
});

// PUT /api/student-profile - Update student profile (authenticated user only) - Phone + Email composite
app.put('/api/student-profile', authenticateUser, async (req, res) => {
  try {
    const { studentName, schoolName, className, rollNumber, mobileNumber, address } = req.body;
    const email = req.user.email;

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

    // Find or create student profile
    let studentProfile = await StudentProfile.findOne({ userId: req.user._id });
    
    if (!studentProfile) {
      // Check if this (phone + email) combo already exists
      const existingCombo = await StudentProfile.findOne({
        mobileNumber: mobileNumber,
        email: email
      });
      
      if (existingCombo) {
        // Shouldn't happen, but if it does, use existing
        return res.status(400).json({
          message: 'This phone and email combination is already registered'
        });
      }

      // Create new profile
      studentProfile = new StudentProfile({
        userId: req.user._id,
        email: email,
        studentName,
        schoolName,
        className: classNum.toString(),
        rollNumber,
        mobileNumber,
        address
      });
    } else {
      // Update existing profile
      // Check if changing phone to one that exists with different email
      if (mobileNumber !== studentProfile.mobileNumber) {
        const phoneExists = await StudentProfile.findOne({
          mobileNumber: mobileNumber,
          email: email,
          _id: { $ne: studentProfile._id }
        });
        
        if (phoneExists) {
          return res.status(409).json({
            message: 'This phone number is already registered to another profile with the same email',
            error: 'DUPLICATE_PHONE_EMAIL'
          });
        }
      }

      studentProfile.studentName = studentName;
      studentProfile.schoolName = schoolName;
      studentProfile.className = classNum.toString();
      studentProfile.rollNumber = rollNumber;
      studentProfile.mobileNumber = mobileNumber;
      studentProfile.email = email;
      studentProfile.address = address;
      studentProfile.updatedAt = new Date();
    }
    
    await studentProfile.save();

    res.json({ 
      message: 'Student profile updated successfully',
      _id: studentProfile._id,
      email: studentProfile.email,
      studentName: studentProfile.studentName,
      schoolName: studentProfile.schoolName,
      className: studentProfile.className,
      rollNumber: studentProfile.rollNumber,
      mobileNumber: studentProfile.mobileNumber,
      address: studentProfile.address,
      updatedAt: studentProfile.updatedAt
    });
  } catch (error) {
    console.error('Error updating student profile:', error);
    if (error.code === 11000) {
      // Duplicate key error
      res.status(409).json({ 
        message: 'This phone number + email combination is already registered',
        error: 'DUPLICATE_PHONE_EMAIL'
      });
    } else {
      res.status(500).json({ message: error.message || 'Failed to update student profile' });
    }
  }
});

// GET /api/student-profile/:mobileNumber/:email - Get student profile by phone + email composite (public users)
app.get('/api/student-profile/:mobileNumber/:email', async (req, res) => {
  try {
    const { mobileNumber, email } = req.params;

    // Find student profile by (mobileNumber + email) composite
    const studentProfile = await StudentProfile.findOne({ 
      mobileNumber: mobileNumber,
      email: email
    });

    if (!studentProfile) {
      // Return empty profile if doesn't exist (public user)
      return res.json({
        _id: null,
        email: email,
        studentName: '',
        schoolName: '',
        className: '',
        rollNumber: '',
        mobileNumber: mobileNumber,
        address: ''
      });
    }

    res.json({
      _id: studentProfile._id,
      email: studentProfile.email,
      studentName: studentProfile.studentName || '',
      schoolName: studentProfile.schoolName || '',
      className: studentProfile.className || '',
      rollNumber: studentProfile.rollNumber || '',
      mobileNumber: studentProfile.mobileNumber || '',
      address: studentProfile.address || '',
      updatedAt: studentProfile.updatedAt
    });
  } catch (error) {
    console.error('Error fetching student profile:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch student profile' });
  }
});

// GET /api/student-profile/:mobileNumber - Get student profile by mobile number (keep for backward compat but checks all emails)
app.get('/api/student-profile/:mobileNumber', async (req, res) => {
  try {
    const { mobileNumber } = req.params;

    // Find student profile by mobile number (will return first match)
    const studentProfile = await StudentProfile.findOne({ mobileNumber });

    if (!studentProfile) {
      // Return empty profile if doesn't exist (public user)
      return res.json({
        _id: null,
        studentName: '',
        schoolName: '',
        className: '',
        rollNumber: '',
        mobileNumber: mobileNumber,
        address: ''
      });
    }

    res.json({
      _id: studentProfile._id,
      studentName: studentProfile.studentName || '',
      schoolName: studentProfile.schoolName || '',
      className: studentProfile.className || '',
      rollNumber: studentProfile.rollNumber || '',
      mobileNumber: studentProfile.mobileNumber || '',
      address: studentProfile.address || '',
      updatedAt: studentProfile.updatedAt
    });
  } catch (error) {
    console.error('Error fetching student profile:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch student profile' });
  }
});

// Check if phone + email combination is available (public endpoint for frontend validation)
app.get('/api/check-phone-email', async (req, res) => {
  try {
    const { mobileNumber, email } = req.query;
    
    if (!mobileNumber || !email) {
      return res.status(400).json({ message: 'Phone and email are required' });
    }
    
    // Check for exact match (same email, same phone)
    const exactMatch = await StudentProfile.findOne({
      mobileNumber: mobileNumber,
      email: email
    });
    
    // Check for phone with different email
    const phoneWithDifferentEmail = await StudentProfile.findOne({
      mobileNumber: mobileNumber,
      email: { $ne: email }
    });
    
    res.json({
      available: !exactMatch,
      phoneExists: !!phoneWithDifferentEmail,
      message: exactMatch 
        ? 'This phone and email combination already exists'
        : phoneWithDifferentEmail
        ? `This phone is registered to ${phoneWithDifferentEmail.email}. Use your email to register.`
        : 'Available',
      registeredEmail: phoneWithDifferentEmail?.email || null
    });
  } catch (error) {
    console.error('Error checking phone+email availability:', error);
    res.status(500).json({ message: error.message || 'Failed to check availability' });
  }
});

// Admin Student Management Routes
// GET /api/admin/students - Get all students with optional class filter (admin only)
app.get('/api/admin/students', authenticateUser, isAdmin, async (req, res) => {
  try {
    const { className, page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build filter
    const filter = {};
    if (className && className.trim()) {
      filter.className = className.trim();
    }

    // Get total count
    const totalStudents = await StudentProfile.countDocuments(filter);

    // Get paginated results
    const students = await StudentProfile.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .select('_id studentName schoolName className rollNumber mobileNumber address createdAt');

    // Get unique classes for filtering
    const allClasses = await StudentProfile.distinct('className');

    res.json({
      students,
      totalStudents,
      totalPages: Math.ceil(totalStudents / limitNum),
      currentPage: pageNum,
      classes: allClasses.sort()
    });
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch students' });
  }
});

// DELETE /api/admin/students/:id - Delete a student profile (admin only)
app.delete('/api/admin/students/:id', authenticateUser, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const studentProfile = await StudentProfile.findByIdAndDelete(id);

    if (!studentProfile) {
      return res.status(404).json({ message: 'Student profile not found' });
    }

    res.json({ 
      message: 'Student profile deleted successfully',
      deletedStudent: studentProfile.studentName
    });
  } catch (error) {
    console.error('Error deleting student:', error);
    res.status(500).json({ message: error.message || 'Failed to delete student' });
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