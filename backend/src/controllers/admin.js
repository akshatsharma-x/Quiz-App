const { Parser } = require('json2csv');
const ErrorResponse = require('../utils/errorResponse');
const Result = require('../models/Result');
const Quiz = require('../models/Quiz');

// @desc    Export quiz results to CSV
// @route   GET /api/v1/admin/results/:quizId/csv
// @access  Private/Admin
exports.exportResultsCsv = async (req, res, next) => {
  try {
    const { quizId } = req.params;

    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return next(new ErrorResponse(`Quiz not found with id of ${quizId}`, 404));
    }

    const results = await Result.find({ quiz: quizId }).populate({
      path: 'user',
      select: 'name email batch'
    });

    if (!results || results.length === 0) {
      return next(new ErrorResponse(`No results found for quiz ${quizId}`, 404));
    }

    // Transform data for CSV with advanced LMS metrics
    const csvData = results.map(result => ({
      Student_Name: result.user.name,
      Student_Email: result.user.email,
      Cohort_Batch: result.user.batch || 'N/A',
      Score: result.score,
      Total_Possible: result.totalPossibleScore,
      Percentage: ((result.score / result.totalPossibleScore) * 100).toFixed(2) + '%',
      Time_Spent_Seconds: result.timeSpentSeconds || 'N/A',
      Legacy_Tab_Switches: result.tabSwitches,
      New_Audit_Events: result.auditLog ? result.auditLog.length : 0,
      Is_Flagged_For_Cheating: result.isFlagged ? 'YES' : 'NO',
      Submitted_At: result.submittedAt.toISOString()
    }));

    const fields = [
      'Student_Name', 
      'Student_Email', 
      'Cohort_Batch',
      'Score', 
      'Total_Possible', 
      'Percentage', 
      'Time_Spent_Seconds',
      'Legacy_Tab_Switches', 
      'New_Audit_Events',
      'Is_Flagged_For_Cheating',
      'Submitted_At'
    ];
    
    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(csvData);

    res.header('Content-Type', 'text/csv');
    res.attachment(`${quiz.title.replace(/\s+/g, '_')}_Results.csv`);
    return res.send(csv);

  } catch (error) {
    next(error);
  }
};
