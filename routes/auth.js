const express = require("express")
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")
const crypto = require("crypto")
const nodemailer = require("nodemailer")
const { body, validationResult } = require("express-validator")
const User = require("../models/User")
const { protect } = require("../middleware/auth")

const router = express.Router()

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  })
}

// Email transporter setup
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
})

// @route   POST /api/auth/register
// @desc    Register user
// @access  Public
router.post(
  "/register",
  [
    body("name").trim().isLength({ min: 2 }).withMessage("Name must be at least 2 characters"),
    body("email").isEmail().withMessage("Please enter a valid email"),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation failed",
          errors: errors.array(),
        })
      }

      const { name, email, password } = req.body

      // Check if user exists
      const existingUser = await User.findOne({ email })
      if (existingUser) {
        return res.status(400).json({ message: "User already exists with this email" })
      }

      // Create user
      const user = await User.create({
        name,
        email,
        password,
      })

      // Generate token
      const token = generateToken(user._id)

      res.status(201).json({
        success: true,
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
        },
      })
    } catch (error) {
      console.error("Registration error:", error)
      res.status(500).json({ message: "Server error during registration" })
    }
  },
)

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post(
  "/login",
  [
    body("email").isEmail().withMessage("Please enter a valid email"),
    body("password").exists().withMessage("Password is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation failed",
          errors: errors.array(),
        })
      }

      const { email, password } = req.body

      // Check if user exists
      const user = await User.findOne({ email })
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" })
      }

      // Check password
      const isMatch = await user.matchPassword(password)
      if (!isMatch) {
        return res.status(401).json({ message: "Invalid credentials" })
      }

      // Generate token
      const token = generateToken(user._id)

      res.json({
        success: true,
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
        },
      })
    } catch (error) {
      console.error("Login error:", error)
      res.status(500).json({ message: "Server error during login" })
    }
  },
)

// @route   POST /api/auth/forgot-password
// @desc    Send password reset email
// @access  Public
router.post(
  "/forgot-password",
  [body("email").isEmail().withMessage("Please enter a valid email")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { email } = req.body;
      const user = await User.findOne({ email });

      if (!user) {
        return res.status(404).json({ message: "User not found with this email" });
      }

      // Generate reset token
      const resetToken = crypto.randomBytes(20).toString("hex");

      // Hash token and set fields
      user.resetPasswordToken = crypto.createHash("sha256").update(resetToken).digest("hex");
      user.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutes

      await user.save();

      // Reset link
      const resetUrl = `${process.env.FRONTEND_BASE_URL}/reset-password/${resetToken}`;

      // HTML Template
      const htmlTemplate = `
        <div style="max-width: 600px; margin: auto; font-family: Arial, sans-serif; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; box-shadow: 0 0 10px rgba(0,0,0,0.05);">
          <div style="background-color: #2563eb; color: white; padding: 20px; text-align: center;">
            <h2 style="margin: 0;">Reset Your Password</h2>
          </div>
          <div style="padding: 30px;">
            <p>Hi ${user.name || "there"},</p>
            <p>We received a request to reset your password. Click the button below to create a new password:</p>
            <div style="text-align: center; margin: 20px 0;">
              <a href="${resetUrl}" style="background-color: #2563eb; color: white; padding: 12px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Reset Password</a>
            </div>
            <p style="color: #555;">This link will expire in 10 minutes. If you didn’t request this, you can safely ignore this email.</p>
            <hr style="margin: 30px 0;">
            <p style="font-size: 12px; color: #888;">If the button doesn’t work, copy and paste the following URL into your browser:</p>
            <p style="font-size: 12px; color: #888;"><a href="${resetUrl}" style="color: #2563eb;">${resetUrl}</a></p>
          </div>
          <div style="background-color: #f9f9f9; color: #999; text-align: center; padding: 20px; font-size: 12px;">
            &copy; ${new Date().getFullYear()} DocCircle. All rights reserved.
          </div>
        </div>
      `;

      try {
        await transporter.sendMail({
          from: process.env.EMAIL_FROM,
          to: user.email,
          subject: "Reset Your Password - DocCircle",
          html: htmlTemplate,
        });

        res.json({ success: true, message: "Password reset email sent successfully" });
      } catch (error) {
        console.error("Email send error:", error);
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;
        await user.save();
        return res.status(500).json({ message: "Failed to send email" });
      }
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// @route   PUT /api/auth/reset-password/:resettoken
// @desc    Reset password
// @access  Public
router.put(
  "/reset-password/:resettoken",
  [body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters")],
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation failed",
          errors: errors.array(),
        })
      }

      // Get hashed token
      const resetPasswordToken = crypto.createHash("sha256").update(req.params.resettoken).digest("hex")

      const user = await User.findOne({
        resetPasswordToken,
        resetPasswordExpire: { $gt: Date.now() },
      })

      if (!user) {
        return res.status(400).json({ message: "Invalid or expired token" })
      }

      // Set new password
      user.password = req.body.password
      user.resetPasswordToken = undefined
      user.resetPasswordExpire = undefined

      await user.save()

      // Generate token
      const token = generateToken(user._id)

      res.json({
        success: true,
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
        },
      })
    } catch (error) {
      console.error("Reset password error:", error)
      res.status(500).json({ message: "Server error" })
    }
  },
)

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get("/me", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password")
    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    })
  } catch (error) {
    console.error("Get user error:", error)
    res.status(500).json({ message: "Server error" })
  }
})

module.exports = router
