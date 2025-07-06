const express = require("express")
const User = require("../models/User")
const { protect } = require("../middleware/auth")

const router = express.Router()

// @route   GET /api/users/search
// @desc    Search users by name or email
// @access  Private
router.get("/search", protect, async (req, res) => {
  try {
    const { q } = req.query

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ message: "Search query must be at least 2 characters" })
    }

    const users = await User.find({
      $and: [
        { _id: { $ne: req.user.id } }, // Exclude current user
        {
          $or: [{ name: { $regex: q, $options: "i" } }, { email: { $regex: q, $options: "i" } }],
        },
      ],
    })
      .select("name email")
      .limit(10)

    res.json({
      success: true,
      users,
    })
  } catch (error) {
    console.error("Search users error:", error)
    res.status(500).json({ message: "Server error" })
  }
})

// @route   GET /api/users/profile/:id
// @desc    Get user profile
// @access  Private
router.get("/profile/:id", protect, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password")

    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      },
    })
  } catch (error) {
    console.error("Get user profile error:", error)
    res.status(500).json({ message: "Server error" })
  }
})

module.exports = router
