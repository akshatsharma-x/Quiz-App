const ErrorResponse = require('../utils/errorResponse');
const Quiz = require('../models/Quiz');
const User = require('../models/User');

// @desc    Get quizzes for logged-in student (Smart Filtering)
// @route   GET /api/v1/student/my-quizzes
// @access  Private (Student)
exports.getSmartQuizzes = async (req, res, next) => {
  try {
    // 1. Identify the authenticated student via the JWT payload (req.user)
    const student = await User.findById(req.user.id);
    
    if (!student) {
      return next(new ErrorResponse('Student not found in database', 404));
    }

    // 2. Extract their stored academic identity
    const { program, branch, batchYear, semester, section } = student;

    if (!program || !branch || !batchYear || !semester || !section) {
      return res.status(200).json({
        success: true,
        profileIncomplete: true,
        message: 'Student profile incomplete. Please complete profile setup.',
        data: []
      });
    }

    // 3. Construct the highly optimized Mongoose Query
    // Logic: For each parameter, the quiz must either target the student's specific value OR be set to 'All'.
    const query = {
      isActive: true, // Only fetch active quizzes
      
      // Smart filters using $in
      targetProgram: { $in: [program, 'All'] },
      targetBranch: { $in: [branch, 'All'] },
      targetBatchYear: { $in: [batchYear, 'All'] },
      targetSemester: { $in: [semester, 'All'] },
      targetSection: { $in: [section, 'All'] },
      
      // Invigilator Wow-Factor: Strict Time Constraint
      // The current server time must be strictly BEFORE the quiz's endTime.
      endTime: { $gt: new Date() }
    };

    // 4. Execute the query
    // We sort by startTime ascending, so the soonest quizzes appear at the top.
    const quizzes = await Quiz.find(query).sort({ startTime: 1 });

    res.status(200).json({
      success: true,
      count: quizzes.length,
      studentCohort: { program, branch, batchYear, semester, section },
      data: quizzes
    });

  } catch (error) {
    // Fallback error handler
    console.error(error);
    return next(new ErrorResponse('Server error while executing smart query', 500));
  }
};

// @desc    Update Student Profile with Academic Identity
// @route   PUT /api/v1/student/profile
// @access  Private
exports.updateStudentProfile = async (req, res, next) => {
  try {
    const { program, branch, batchYear, semester, section } = req.body;

    // Update the authenticated user's schema with permanent academic parameters
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { program, branch, batchYear, semester, section },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      data: updatedUser
    });
  } catch (error) {
    next(error);
  }
};
