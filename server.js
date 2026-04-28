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

// ⚠️ FIX: Drop old broken indexes and recreate correct ones (E11000 duplicate key fix)
async function cleanupOldIndexes() {
  try {
    const submissionCollection = mongoose.connection.collection('submissions');
    
    // List all indexes to see what we have
    const allIndexes = await submissionCollection.getIndexes();
    console.log('📋 Current indexes:', Object.keys(allIndexes));
    
    // Try to drop problematic old indexes
    const oldIndexesToDrop = [
      'quizId_1_mobileNumber_1',
      'quizId_1_studentProfileId_1',  // ← Main culprit causing E11000 error
      'quizId_1',
      'userId_1'
    ];
    
    for (const indexName of oldIndexesToDrop) {
      try {
        if (allIndexes[indexName]) {
          await submissionCollection.dropIndex(indexName);
          console.log(`✅ Dropped old index: ${indexName}`);
        }
      } catch (err) {
        if (!err.message.includes('index not found')) {
          console.error(`⚠️  Error dropping ${indexName}:`, err.message);
        }
      }
    }
    
    // Recreate the correct index
    try {
      await submissionCollection.createIndex(
        { quizId: 1, userId: 1 },
        { unique: true, name: 'quizId_1_userId_1' }
      );
      console.log('✅ Created correct unique index: (quizId, userId)');
    } catch (err) {
      if (!err.message.includes('already exists')) {
        console.error('⚠️  Error creating index:', err.message);
      }
    }
  } catch (err) {
    console.error('⚠️  Could not cleanup indexes:', err.message);
  }
}

// Run cleanup after connection is established
setTimeout(cleanupOldIndexes, 2000);

// ✅ ROOT ROUTE - Health Check (Minimal - No Endpoint Disclosure for Security)
app.get('/', (req, res) => {
  res.json({
    message: '✅ Quiz Platform Backend API',
    status: 'online',
    version: '1.0.0'
  });
});

// User Schema - VERSION 2 (Consolidated with profile + statistics)
const userSchema = new mongoose.Schema({
  firebaseUid: { type: String, required: true, unique: true },
  email: String,
  name: String,
  picture: String,
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  
  // VERSION 2: Profile data (migrated from StudentProfile)
  profile: {
    studentName: String,
    schoolName: String,
    className: String,
    rollNumber: String,
    mobileNumber: String,        // NOT unique per decision (can be shared)
    address: String,
    createdAt: Date,
    updatedAt: { type: Date, default: Date.now }
  },
  
  // VERSION 2: Statistics tracking
  studentStatistics: {
    totalQuizzesAttempted: { type: Number, default: 0 },
    totalPoints: { type: Number, default: 0 },
    quizzesWon: { type: Number, default: 0 },
    lastQuizTakenAt: Date,
    lastPointsUpdatedAt: Date
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// VERSION 2: Add indexes for new profile fields
userSchema.index({ 'profile.mobileNumber': 1 });      // NOT unique (decision 1)
userSchema.index({ 'profile.className': 1 });
userSchema.index({ 'profile.rollNumber': 1 });

const User = mongoose.model('User', userSchema);

// VERSION 2: StudentProfile deprecated - consolidated into User.profile
// Kept commented for reference during transition
/*
const studentProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  studentName: { type: String, required: true }, // নাম
  schoolName: { type: String, required: true }, // শিক্ষা প্রতিষ্ঠান
  className: { type: String, required: true }, // ক্লাস/শ্রেণি/বর্ষ
  rollNumber: String, // রোল
  mobileNumber: { type: String, required: true }, // মোবাইল নম্বর
  address: String, // ঠিকানা
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

// Index on userId for fast lookups
studentProfileSchema.index({ userId: 1 }, { unique: true });
// Index on mobileNumber for public user lookups
studentProfileSchema.index({ mobileNumber: 1 });

const StudentProfile = mongoose.model('StudentProfile', studentProfileSchema);
*/
const StudentProfile = null; // Placeholder for compatibility

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

// Submission Schema - VERSION 2 (Only userId, studentProfileId deprecated)
const submissionSchema = new mongoose.Schema({
  quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // VERSION 2: Now required
  
  // Quiz data
  userAnswers: [{
    questionIndex: Number,
    selectedOption: Number,
    isCorrect: Boolean
  }],
  score: { type: Number, default: 0 },
  totalQuestions: Number,
  submittedAt: { type: Date, default: Date.now },
  timeTaken: Number,
  
  // VERSION 2: New fields
  answersLocked: { type: Boolean, default: true },   // Unlock when result published
  isDuplicateFlag: { type: Boolean, default: false } // Flagged by class+roll+phone
});

// VERSION 2: Unique index on userId + quizId (decision 2: no retakes)
submissionSchema.index({ quizId: 1, userId: 1 }, { unique: true });

const Submission = mongoose.model('Submission', submissionSchema);

// Published Result Schema - VERSION 2 (Updated for new structure)
const publishedResultSchema = new mongoose.Schema({
  quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
  
  // VERSION 2: Simple boolean flag for answer unlock
  isPublished: { type: Boolean, default: true },
  
  // VERSION 2: List of top winners (userId only)
  topWinners: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    score: Number,
    position: Number // 1, 2, 3, etc.
  }],
  
  // VERSION 2: Metadata about publishing
  resultMetadata: {
    totalSubmissions: Number,
    uniqueParticipants: Number,
    duplicateFlagsFiltered: Number,
    topScoreAchieved: Number,
    topCountConfigured: Number // How many top winners (decision 3: admin decides)
  },
  
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

// Check if user has already submitted a quiz - VERSION 2 (Authenticated users only)
app.get('/api/quizzes/:id/check-submission', authenticateUser, async (req, res) => {
  try {
    // VERSION 2: Only support authenticated users
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

// ============================================
// USER PROFILE ENDPOINTS - VERSION 2
// ============================================

// Get current user's profile and statistics
app.get('/api/user/profile', authenticateUser, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('profile studentStatistics email name picture role createdAt');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({
      _id: user._id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      role: user.role,
      profile: user.profile || {},
      statistics: user.studentStatistics || {
        totalQuizzesAttempted: 0,
        totalPoints: 0,
        quizzesWon: 0,
        lastQuizTakenAt: null
      },
      createdAt: user.createdAt
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update current user's profile
app.put('/api/user/profile', authenticateUser, async (req, res) => {
  try {
    const { studentName, schoolName, className, rollNumber, mobileNumber, address } = req.body;
    
    // VERSION 2: Validate required fields
    if (!studentName || !schoolName || !className) {
      return res.status(400).json({ 
        message: 'Required fields missing: studentName, schoolName, className' 
      });
    }
    
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          'profile.studentName': studentName,
          'profile.schoolName': schoolName,
          'profile.className': className,
          'profile.rollNumber': rollNumber || '',
          'profile.mobileNumber': mobileNumber || '',
          'profile.address': address || '',
          'profile.updatedAt': new Date()
        }
      },
      { new: true }
    ).select('profile email name');
    
    res.json({
      message: 'Profile updated successfully',
      profile: updatedUser.profile
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get current user's statistics
app.get('/api/user/statistics', authenticateUser, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('studentStatistics');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({
      statistics: user.studentStatistics || {
        totalQuizzesAttempted: 0,
        totalPoints: 0,
        quizzesWon: 0,
        lastQuizTakenAt: null,
        lastPointsUpdatedAt: null
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Submit quiz - VERSION 2 (Consolidated profile, statistics updates, answer locking)
app.post('/api/quizzes/:id/submit', authenticateUser, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }
    
    const { answers, timeTaken, profileData } = req.body;
    
    // VERSION 2: Validate profile data
    if (profileData) {
      const { studentName, schoolName, className } = profileData;
      if (!studentName || !schoolName || !className) {
        return res.status(400).json({ message: 'Profile data incomplete (studentName, schoolName, className required)' });
      }
    }
    
    // VERSION 2: DECISION 2 - Check duplicate by userId + quizId (one attempt per quiz)
    // BUGFIX: More defensive check with better logging
    let existingSubmission;
    try {
      existingSubmission = await Submission.findOne({
        quizId: req.params.id,
        userId: req.user._id
      });
    } catch (dbError) {
      console.error('❌ Database error checking submission:', dbError.message);
      return res.status(500).json({ message: 'Database error during submission check' });
    }
    
    if (existingSubmission) {
      console.warn(`⚠️  Submission already exists: User ${req.user._id}, Quiz ${req.params.id}, Submitted at ${existingSubmission.submittedAt}`);
      return res.status(400).json({ 
        message: 'You have already submitted this quiz. No retakes allowed per quiz policy.',
        details: `Your submission was recorded at ${new Date(existingSubmission.submittedAt).toLocaleString()}`
      });
    }
    
    // VERSION 2: If profileData provided, update User.profile
    if (profileData) {
      try {
        await User.findByIdAndUpdate(
          req.user._id,
          {
            $set: {
              'profile.studentName': profileData.studentName,
              'profile.schoolName': profileData.schoolName,
              'profile.className': profileData.className,
              'profile.rollNumber': profileData.rollNumber || '',
              'profile.mobileNumber': profileData.mobileNumber || '',
              'profile.address': profileData.address || '',
              'profile.updatedAt': new Date()
            }
          },
          { new: true }
        );
      } catch (updateError) {
        console.warn('⚠️  Profile update failed (non-critical):', updateError.message);
        // Continue anyway, profile update is not critical for submission
      }
    }
    
    // VERSION 2: DECISION 4 - Check duplicate by class+roll+phone (BLOCK if match)
    const userProfile = await User.findById(req.user._id).select('profile');
    
    if (userProfile?.profile?.className && userProfile?.profile?.rollNumber && userProfile?.profile?.mobileNumber) {
      // Find ANY submission for this quiz with SAME class+roll+phone (but different userId)
      const duplicateSubmission = await Submission.findOne({
        quizId: new mongoose.Types.ObjectId(req.params.id)
      }).populate('userId', 'profile');
      
      // Check if found submission belongs to a different user with same profile info
      if (duplicateSubmission?.userId?.profile) {
        const otherProfile = duplicateSubmission.userId.profile;
        const isDifferentUser = duplicateSubmission.userId._id.toString() !== req.user._id.toString();
        
        // BUGFIX: Only block if it's a DIFFERENT user with same class+roll+phone
        if (
          isDifferentUser &&
          otherProfile.className === userProfile.profile.className &&
          otherProfile.rollNumber === userProfile.profile.rollNumber &&
          otherProfile.mobileNumber === userProfile.profile.mobileNumber
        ) {
          console.warn(`⚠️  Duplicate detected: Quiz ${req.params.id}, User ${req.user._id}, Class/Roll/Phone match with ${duplicateSubmission.userId._id}`);
          return res.status(400).json({
            message: 'Duplicate submission detected',
            details: 'A submission with same class, roll, and phone number already exists for this quiz'
          });
        }
      }
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
        questionIndex: index,
        selectedOption: answer.selectedOption,
        isCorrect
      };
    });
    
    try {
      // VERSION 2: Create submission with new fields
      const submission = await Submission.create({
        quizId: req.params.id,
        userId: req.user._id,
        userAnswers: processedAnswers,
        score,
        totalQuestions: quiz.questions.length,
        timeTaken,
        answersLocked: true,      // VERSION 2: Locked until result published
        isDuplicateFlag: false    // VERSION 2: No secondary duplicate found
      });
      
      console.log(`✅ Submission created: User ${req.user._id}, Quiz ${req.params.id}, Score ${score}`);
      
      // VERSION 2: DECISION 5 - Update statistics immediately (sequential, no transaction)
      try {
        await User.findByIdAndUpdate(
          req.user._id,
          {
            $inc: {
              'studentStatistics.totalQuizzesAttempted': 1,
              'studentStatistics.totalPoints': score
            },
            $set: {
              'studentStatistics.lastQuizTakenAt': new Date(),
              'studentStatistics.lastPointsUpdatedAt': new Date()
            }
          }
        );
      } catch (statsError) {
        // Log error but don't fail submission (decision 5: accept partial updates)
        console.error('⚠️  Warning: Statistics update failed, but submission created:', statsError.message);
      }
      
      // Return submission without correctAnswers (locked)
      res.status(201).json({
        _id: submission._id,
        quizId: submission.quizId,
        score: submission.score,
        totalQuestions: submission.totalQuestions,
        timeTaken: submission.timeTaken,
        submittedAt: submission.submittedAt,
        message: 'Submission successful! Correct answers will be shown after result publication.',
        answersLocked: true
      });
      
    } catch (submitError) {
      // Handle duplicate key error from database (shouldn't happen due to above check, but as safety net)
      if (submitError.code === 11000) {
        console.error('❌ E11000 Duplicate key error on submission create:', submitError.message);
        return res.status(400).json({ 
          message: 'Submission already exists (database duplicate key)',
          details: 'This may be due to a network issue or race condition. Please refresh and try again.'
        });
      }
      throw submitError;
    }
    
  } catch (error) {
    console.error('❌ Submission error:', error.message);
    res.status(400).json({ message: error.message || 'Failed to submit quiz' });
  }
});

// Get leaderboard for a quiz - VERSION 2 (Using User.profile instead of StudentProfile)
app.get('/api/quizzes/:id/leaderboard', async (req, res) => {
  try {
    const submissions = await Submission.find({ 
      quizId: req.params.id,
      isDuplicateFlag: false  // VERSION 2: Exclude flagged duplicates
    })
      .populate('userId', 'profile')
      .sort({ score: -1, timeTaken: 1 })
      .limit(100);
    
    const leaderboard = submissions.map((sub, index) => ({
      rank: index + 1,
      studentName: sub.userId?.profile?.studentName || 'Unknown',
      schoolName: sub.userId?.profile?.schoolName || 'Unknown',
      className: sub.userId?.profile?.className || 'Unknown',
      rollNumber: sub.userId?.profile?.rollNumber || '',
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

// Get user's submission for a quiz (authenticated users only) - VERSION 2
app.get('/api/quizzes/:id/submission', authenticateUser, async (req, res) => {
  try {
    const submission = await Submission.findOne({
      quizId: req.params.id,
      userId: req.user._id
    }).populate('quizId').populate('userId', 'profile');
    
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }
    
    // VERSION 2: If answers are locked, don't send correct answer info
    const responseData = {
      _id: submission._id,
      quizId: submission.quizId,
      userId: submission.userId,
      score: submission.score,
      totalQuestions: submission.totalQuestions,
      timeTaken: submission.timeTaken,
      submittedAt: submission.submittedAt,
      answersLocked: submission.answersLocked
    };
    
    // Only include user answers if unlocked (after result published)
    if (!submission.answersLocked) {
      responseData.userAnswers = submission.userAnswers;
    }
    
    res.json(responseData);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get user's submission with complete answer details - VERSION 2 (Auth only)
app.get('/api/quizzes/:id/my-submission', authenticateUser, async (req, res) => {
  try {
    const quizId = req.params.id;

    // Get the quiz first to access question details
    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    // VERSION 2: Get submission for authenticated user
    const submission = await Submission.findOne({
      quizId: quizId,
      userId: req.user._id
    });

    if (!submission) {
      return res.status(404).json({ message: 'No submission found for this quiz' });
    }

    // VERSION 2: If answers locked, don't return detailed answers
    if (submission.answersLocked) {
      return res.json({
        _id: submission._id,
        quizId: submission.quizId,
        score: submission.score,
        totalQuestions: submission.totalQuestions,
        timeTaken: submission.timeTaken,
        submittedAt: submission.submittedAt,
        answersLocked: true,
        message: 'Answers are locked until result is published'
      });
    }

    // VERSION 2: Return enriched answers with question details
    const enrichedAnswers = submission.userAnswers.map((answer, index) => {
      const question = quiz.questions[index];
      return {
        questionIndex: answer.questionIndex,
        questionText: question?.question || '',
        selectedOption: question?.options?.[answer.selectedOption] || 'No answer',
        correctOption: question?.options?.[question?.correctAnswer] || '',
        isCorrect: answer.isCorrect,
        selectedOptionIndex: answer.selectedOption
      };
    });

    // Populate user and return complete submission data
    await submission.populate('userId', 'profile');
    
    const profile = submission.userId.profile;
    res.json({
      _id: submission._id,
      quizId: submission.quizId,
      userId: submission.userId._id,
      score: submission.score,
      totalQuestions: submission.totalQuestions,
      timeTaken: submission.timeTaken,
      submittedAt: submission.submittedAt,
      answersLocked: submission.answersLocked,
      studentName: profile?.studentName || '',
      schoolName: profile?.schoolName || '',
      className: profile?.className || '',
      rollNumber: profile?.rollNumber || '',
      mobileNumber: profile?.mobileNumber || '',
      address: profile?.address || '',
      userAnswers: enrichedAnswers
    });
  } catch (error) {
    console.error('❌ Error fetching submission:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// Admin: Get quiz statistics - VERSION 2 (Using User.profile instead of StudentProfile)
app.get('/api/admin/quizzes/:id/stats', authenticateUser, isAdmin, async (req, res) => {
  try {
    const submissions = await Submission.find({ quizId: req.params.id })
      .populate('userId', 'profile');
    
    const submissionsWithProfile = submissions.map(sub => ({
      ...sub.toObject(),
      studentName: sub.userId?.profile?.studentName || '',
      schoolName: sub.userId?.profile?.schoolName || '',
      className: sub.userId?.profile?.className || '',
      mobileNumber: sub.userId?.profile?.mobileNumber || ''
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

// Get submissions for result publishing (classwise or overall) - VERSION 2 (Using User.profile)
app.get('/api/admin/quizzes/:id/prepare-publish/:publishType', authenticateUser, isAdmin, async (req, res) => {
  try {
    const { id, publishType } = req.params;
    const submissions = await Submission.find({ quizId: id })
      .populate('userId', 'profile')
      .sort({ score: -1 });

    if (publishType === 'classwise') {
      // Group by class and get top 3 from each
      const grouped = {};
      submissions.forEach(sub => {
        const className = sub.userId?.profile?.className || 'Unknown';
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
    const { topWinners, topCount } = req.body;  // VERSION 2: admin selects winners

    // Get quiz info
    const quiz = await Quiz.findById(id);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    // VERSION 2: Validate winners list - must be userId references with scores
    if (!Array.isArray(topWinners) || topWinners.length === 0) {
      return res.status(400).json({ message: 'At least one winner required' });
    }

    // Check if result already published
    let existingResult = await PublishedResult.findOne({ quizId: id });
    if (existingResult) {
      // VERSION 2: Remove old winner statistics and unlock old answers
      if (existingResult.topWinners && Array.isArray(existingResult.topWinners)) {
        for (const winner of existingResult.topWinners) {
          await User.findByIdAndUpdate(
            winner.userId,
            { $inc: { 'studentStatistics.quizzesWon': -1 } }
          );
        }
      }
    }

    // VERSION 2: Unlock all answers for this quiz
    await Submission.updateMany(
      { quizId: id },
      { $set: { answersLocked: false } }
    );

    // VERSION 2: Get total submission stats
    const allSubmissions = await Submission.find({ quizId: id });
    const uniqueParticipants = new Set(allSubmissions.map(s => s.userId.toString())).size;
    const topScoreAchieved = Math.max(...allSubmissions.map(s => s.score), 0);

    // VERSION 2: Prepare enriched winners with scores and positions
    const enrichedWinners = topWinners.map((winner, index) => ({
      userId: winner.userId || winner._id,
      score: winner.score,
      position: index + 1
    }));

    // VERSION 2: Update winner statistics (decision 5: no transaction, sequential)
    for (const winner of enrichedWinners) {
      try {
        await User.findByIdAndUpdate(
          winner.userId,
          { $inc: { 'studentStatistics.quizzesWon': 1 } }
        );
      } catch (statsError) {
        console.error('⚠️  Warning: Failed to update winner stats for user:', winner.userId);
      }
    }

    if (existingResult) {
      // Update existing result
      existingResult.topWinners = enrichedWinners;
      existingResult.topCountConfigured = topCount || enrichedWinners.length;
      existingResult.resultMetadata.totalSubmissions = allSubmissions.length;
      existingResult.resultMetadata.uniqueParticipants = uniqueParticipants;
      existingResult.resultMetadata.topScoreAchieved = topScoreAchieved;
      existingResult.publishedAt = new Date();
      await existingResult.save();
      
      return res.json({
        message: 'Result updated and published successfully',
        result: existingResult
      });
    }

    // Create new published result
    const result = new PublishedResult({
      quizId: id,
      isPublished: true,
      topWinners: enrichedWinners,
      resultMetadata: {
        totalSubmissions: allSubmissions.length,
        uniqueParticipants: uniqueParticipants,
        duplicateFlagsFiltered: 0,
        topScoreAchieved: topScoreAchieved,
        topCountConfigured: topCount || enrichedWinners.length
      },
      publishedBy: req.user._id
    });

    await result.save();
    
    res.json({
      message: 'Result published successfully',
      result: result
    });
    
  } catch (error) {
    console.error('❌ Error publishing result:', error.message);
    res.status(500).json({ message: error.message || 'Failed to publish result' });
  }
});

// Get published results for a quiz (public route) - VERSION 2
app.get('/api/published-results/:quizId', async (req, res) => {
  try {
    const { quizId } = req.params;
    const result = await PublishedResult.findOne({ quizId })
      .populate('quizId', 'title subtitle')
      .populate('topWinners.userId', 'profile name email');
    
    if (!result) {
      return res.status(404).json({ message: 'Result not published yet' });
    }
    
    // VERSION 2: Enrich winners with profile data
    if (result.topWinners && Array.isArray(result.topWinners)) {
      result.topWinners = result.topWinners.map((winner) => ({
        ...winner.toObject ? winner.toObject() : winner,
        studentName: winner.userId?.profile?.studentName,
        className: winner.userId?.profile?.className,
        schoolName: winner.userId?.profile?.schoolName,
        rollNumber: winner.userId?.profile?.rollNumber
      }));
    }
    
    res.json(result);
  } catch (error) {
    console.error('❌ Error fetching published result:', error.message);
    res.status(500).json({ message: error.message || 'Failed to fetch result' });
  }
});

// Get all published results - VERSION 2 (Using User.profile in winners)
app.get('/api/published-results', async (req, res) => {
  try {
    let results = await PublishedResult.find()
      .populate('quizId', 'title subtitle')
      .sort({ publishedAt: -1 });
    
    // Enrich winners with profile data from User collection
    results = await Promise.all(
      results.map(async (result) => {
        const resultObj = result.toObject();
        if (resultObj.topWinners && Array.isArray(resultObj.topWinners)) {
          resultObj.topWinners = await Promise.all(
            resultObj.topWinners.map(async (winner) => {
              const user = await User.findById(winner.userId).select('profile');
              return {
                ...winner,
                studentName: user?.profile?.studentName,
                className: user?.profile?.className,
                schoolName: user?.profile?.schoolName,
              };
            })
          );
        }
        return resultObj;
      })
    );
    
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
// V2: Old /api/student-profile endpoints removed - use /api/user/profile instead
// These endpoints are deprecated and only exist for reference in version history

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