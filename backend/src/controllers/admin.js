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
      select: 'name email'
    });

    if (!results || results.length === 0) {
      return next(new ErrorResponse(`No results found for quiz ${quizId}`, 404));
    }

    // Transform data for CSV
    const csvData = results.map(result => ({
      Student_Name: result.user.name,
      Student_Email: result.user.email,
      Score: result.score,
      Total_Possible: result.totalPossibleScore,
      Percentage: ((result.score / result.totalPossibleScore) * 100).toFixed(2) + '%',
      Tab_Switches: result.tabSwitches,
      Time_Spent_Seconds: result.timeSpentSeconds || 'N/A',
      Submitted_At: result.submittedAt.toISOString()
    }));

    const fields = [
      'Student_Name', 
      'Student_Email', 
      'Score', 
      'Total_Possible', 
      'Percentage', 
      'Tab_Switches', 
      'Time_Spent_Seconds', 
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
