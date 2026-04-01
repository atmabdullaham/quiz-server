/**
 * Backend Timezone Utilities
 * Bangladesh Standard Time (BST): UTC+6, No DST
 * 
 * These utilities help convert between UTC (database storage) and Bangladesh time
 * for proper quiz scheduling and comparisons on the backend.
 */

const BANGLADESH_UTC_OFFSET = 6; // UTC+6

/**
 * Get current Bangladesh time as a Date object
 * @returns {Date} Current time in Bangladesh timezone
 */
export function getBangladeshTimeNow() {
  const now = new Date();
  const utcTime = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const bangladeshTime = new Date(utcTime + BANGLADESH_UTC_OFFSET * 60 * 60 * 1000);
  return bangladeshTime;
}

/**
 * Convert UTC ISO string to Bangladesh Date object
 * @param {string|Date} utcDate - UTC date/time
 * @returns {Date} Date object representing Bangladesh time
 */
export function convertUTCToBangladesh(utcDate) {
  if (!utcDate) return null;
  const date = new Date(utcDate);
  const utcTime = date.getTime();
  const bangladeshTime = new Date(utcTime + BANGLADESH_UTC_OFFSET * 60 * 60 * 1000);
  return bangladeshTime;
}

/**
 * Build MongoDB query to get quizzes with status based on Bangladesh time
 * Returns a query object that properly accounts for Bangladesh timezone
 * 
 * @returns {Object} MongoDB query for active/scheduled quizzes
 */
export function getQuizQueryByBangladeshTime() {
  const now = getBangladeshTimeNow();
  
  // Calculate the UTC equivalents to use in MongoDB query
  const startThreshold = new Date(now.getTime() - BANGLADESH_UTC_OFFSET * 60 * 60 * 1000);
  const endThreshold = new Date(now.getTime() - BANGLADESH_UTC_OFFSET * 60 * 60 * 1000);
  
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
  
  return query;
}

/**
 * Filter quizzes array based on Bangladesh time after fetching from DB
 * This is safer than relying on MongoDB timezone-aware queries
 * 
 * @param {Array} quizzes - Array of quiz documents from MongoDB
 * @returns {Array} Filtered quizzes based on Bangladesh time
 */
export function filterQuizzesByBangladeshTime(quizzes) {
  const now = getBangladeshTimeNow();
  
  return quizzes.filter(quiz => {
    const start = quiz.startDate ? convertUTCToBangladesh(quiz.startDate) : null;
    const end = quiz.endDate ? convertUTCToBangladesh(quiz.endDate) : null;
    
    // Include if draft
    if (quiz.status === 'draft') return false;
    
    // Include if scheduled and hasn't started yet
    if (quiz.status === 'scheduled' && start && start > now) return true;
    
    // Include if active and within time range
    if (quiz.status === 'active' && start && end) {
      if (start <= now && end >= now) return true;
    }
    
    // Include scheduled that has started (now active)
    if (quiz.status === 'scheduled' && start && end) {
      if (start <= now && end >= now) return true;
    }
    
    return false;
  });
}

/**
 * Get quiz status string based on Bangladesh time
 * @param {Object} quiz - Quiz document
 * @returns {string} Status: 'draft', 'scheduled', 'active', or 'ended'
 */
export function getQuizStatusByBangladeshTime(quiz) {
  if (quiz.status === 'draft') return 'draft';
  
  const now = getBangladeshTimeNow();
  const start = quiz.startDate ? convertUTCToBangladesh(quiz.startDate) : null;
  const end = quiz.endDate ? convertUTCToBangladesh(quiz.endDate) : null;
  
  if (start && start > now) return 'scheduled';
  if (start && end && start <= now && end >= now) return 'active';
  if (end && end < now) return 'ended';
  
  return 'draft';
}

export default {
  BANGLADESH_UTC_OFFSET,
  getBangladeshTimeNow,
  convertUTCToBangladesh,
  getQuizQueryByBangladeshTime,
  filterQuizzesByBangladeshTime,
  getQuizStatusByBangladeshTime
};
