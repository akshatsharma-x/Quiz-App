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

// @desc    Create embeddable external quiz (Google/MS Form)
// @route   POST /api/v1/admin/quizzes/external
// @access  Private/Admin
exports.createExternalQuiz = async (req, res, next) => {
  try {
    const { title, googleFormUrl, targetBatch, scheduledTime } = req.body;

    const quiz = await Quiz.create({
      title,
      type: 'google_form',
      googleFormUrl,
      assignedBatches: targetBatch ? [targetBatch] : ['All'],
      startTime: scheduledTime || Date.now(),
      endTime: scheduledTime ? new Date(new Date(scheduledTime).getTime() + 24*60*60*1000) : new Date(Date.now() + 24*60*60*1000), // Default 24h active if not specified
      createdBy: req.user.id
    });

    res.status(201).json({ success: true, data: quiz });
  } catch (error) {
    next(error);
  }
};

const fs = require('fs');
const csv = require('csv-parser');
const QuestionBank = require('../models/QuestionBank');

// @desc    Bulk import questions from CSV via Dropzone
// @route   POST /api/v1/admin/questions/bulk
// @access  Private/Admin
exports.bulkImportQuestions = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Please upload a CSV file' });
    }

    const results = [];
    const questionsToInsert = [];

    // Parse CSV Stream to Memory
    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', async () => {
        // Prepare data for high-performance insertMany
        results.forEach(row => {
          // Expected Columns: QuestionText, Option1, Option2, Option3, Option4, CorrectAnswer, Explanation, Tags
          const options = [row.Option1, row.Option2, row.Option3, row.Option4].filter(opt => opt && opt.trim() !== '');
          
          if (row.QuestionText && options.length >= 2 && row.CorrectAnswer) {
            questionsToInsert.push({
              questionText: row.QuestionText,
              options: options,
              correctAnswer: row.CorrectAnswer,
              explanation: row.Explanation || '',
              tags: row.Tags ? row.Tags.split(',').map(tag => tag.trim()) : [],
              createdBy: req.user.id
            });
          }
        });

        // Clean up temporary Multer file
        fs.unlinkSync(req.file.path);

        if (questionsToInsert.length === 0) {
          return res.status(400).json({ success: false, error: 'No valid questions found in CSV. Check column headers.' });
        }

        // Extremely fast bulk insertion natively into MongoDB
        const inserted = await QuestionBank.insertMany(questionsToInsert);

        res.status(201).json({ 
          success: true, 
          message: `Successfully imported ${inserted.length} questions into the bank.`,
          count: inserted.length
        });
      })
      .on('error', (err) => {
        fs.unlinkSync(req.file.path);
        next(err);
      });

  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    next(error);
  }
};
